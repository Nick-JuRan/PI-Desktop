import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const settingsPath = process.env.FUSION_TEST_SETTINGS_PATH;
const sessionId = process.env.FUSION_TEST_SESSION_ID;

test("plugin entry reads a real semantic session page without rerunning its query", {
  skip: !(settingsPath && sessionId),
}, async () => {
  let settings;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch {
    assert.fail("live test settings could not be read or parsed; secret values are withheld");
  }
  assert.equal(typeof settings?.username, "string");
  assert.equal(typeof settings?.password, "string");

  const registeredTools = new Map();
  const requests = [];
  const pi = {
    plugin: {
      getSettings: async () => ({ ...settings }),
      setSettings: async (partial) => Object.assign(settings, partial),
      getDataPath: async () => "unused",
    },
    net: {
      fetch: async (input) => {
        const response = await fetch(input.url, {
          method: input.method,
          headers: input.headers,
          body: input.body,
          signal: input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined,
        });
        const bodyText = await response.text();
        requests.push({ path: new URL(input.url).pathname, status: response.status });
        return { status: response.status, bodyText };
      },
    },
    agent: {
      registerTool: async (tool) => { registeredTools.set(tool.name, tool); },
      unregisterTool: async (name) => { registeredTools.delete(name); },
    },
  };

  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = registeredTools.get("fusion_semantic_result_page");
    assert.equal(typeof tool?.execute, "function");
    const result = await tool.execute({ session_id: sessionId, page: 1 }, {});
    assert.equal(result?.ok, true, `live result-page read failed with code=${String(result?.error?.code ?? "unknown")}; details withheld`);
    assert.equal(result.semantic_sorted, true);
    assert.equal(result.page, 1);
    assert.ok(Number.isSafeInteger(result.totalPage) && result.totalPage >= 0);
    assert.ok(Array.isArray(result.records) && result.records.length <= 20);
    assert.ok(result.records.every((record) => Number.isSafeInteger(record.semanticSort)
      && record.semanticSort >= 1 && Number.isFinite(record.simVal)));
    if (result.records.length > 0) {
      assert.ok(result.records.some((record) => typeof record.abview === "string" && record.abview.trim().length > 0));
      assert.ok(result.records.some((record) => typeof record.clms === "string" && record.clms.trim().length > 0));
    }
    assert.ok(requests.some((request) =>
      request.path === "/api/neusipo-app-search/fusionResult/results" && request.status === 200));
    assert.ok(!requests.some((request) => request.path.endsWith("/new/action/executeSearch")));
  } finally {
    try { await plugin.onUnload(); } finally { delete globalThis.pi; }
  }
});

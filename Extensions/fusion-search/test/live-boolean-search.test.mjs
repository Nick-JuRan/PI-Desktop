import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const settingsPath = process.env.FUSION_TEST_SETTINGS_PATH;
const database = process.env.FUSION_TEST_DATABASE;
const query = process.env.FUSION_TEST_BOOLEAN_QUERY;

test("plugin entry uses its shared token manager for a semantic search and result page", {
  skip: !(settingsPath && database && query),
}, async () => {
  let settings;
  try {
    settings = JSON.parse(await readFile(settingsPath, "utf8"));
  } catch {
    assert.fail("live test settings could not be read or parsed; secret values are withheld");
  }
  assert.equal(typeof settings?.username, "string");
  assert.equal(typeof settings?.password, "string");
  assert.ok(["CNTXT", "CTTXT", "ENTXT", "ENTXTC", "VEN", "DWPI"].includes(database.trim().toUpperCase()));
  assert.ok(query.trim().length > 0);

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
        const url = new URL(input.url);
        requests.push({
          path: url.pathname,
          status: response.status,
          hasAuthorization: /^Bearer\s+\S+/iu.test(String(input.headers?.Authorization ?? "")),
        });
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
    const tool = registeredTools.get("fusion_boolean_search");
    assert.equal(typeof tool?.execute, "function", "the actual plugin entry registered the Boolean tool");
    const result = await tool.execute({ database, query }, {});
    assert.equal(result?.ok, true, `live Boolean search failed with code=${String(result?.error?.code ?? "unknown")}; details withheld`);
    assert.equal(typeof result.total_hits, "number");
    assert.ok(Number.isSafeInteger(result.total_hits) && result.total_hits >= 0);
    assert.equal(typeof result.session_id, "string");
    assert.ok(result.session_id.length > 0);
    assert.ok(["CNTXT", "ENTXT", "ENTXTC", "VEN", "DWPI"].includes(result.database));
    assert.ok(!Object.hasOwn(result, "records"));

    const pageTool = registeredTools.get("fusion_semantic_result_page");
    assert.equal(typeof pageTool?.execute, "function");
    const page = await pageTool.execute({ session_id: result.session_id, page: 1 }, {});
    assert.equal(page?.ok, true, `live result-page read failed with code=${String(page?.error?.code ?? "unknown")}; details withheld`);
    assert.equal(page.semantic_sorted, true);
    assert.equal(page.page, 1);
    assert.ok(Number.isSafeInteger(page.totalPage) && page.totalPage >= 0);
    assert.ok(Array.isArray(page.records));
    assert.ok(page.records.length <= 20);
    assert.ok(page.records.length > 0, "the controlled live query should exercise a non-empty page");
    assert.ok(page.records.every((record) => Number.isFinite(record.simVal)
      && Number.isSafeInteger(record.semanticSort)
      && record.semanticSort >= 1));
    assert.ok(page.records.some((record) => typeof record.abview === "string" && record.abview.trim().length > 0));
    assert.ok(page.records.some((record) => typeof record.clms === "string" && record.clms.trim().length > 0));

    const searchPaths = [
      "/api/neusipo-app-search/dbAll",
      "/api/neusipo-app-search/element/selectElement",
      "/api/neusipo-app-search/fusionSearch/new/valid/boolterm",
      "/api/neusipo-app-search/fusionSearch/new/action/executeSearch",
      "/api/neusipo-app-search/fusionSearch/new/forOverview",
      "/api/neusipo-app-search/fusionResult/results",
    ];
    for (const path of searchPaths) {
      assert.ok(requests.some((request) => request.path === path && request.status === 200 && request.hasAuthorization),
        `expected an authenticated successful request to ${path}`);
    }
  } finally {
    try { await plugin.onUnload(); } finally { delete globalThis.pi; }
  }
});

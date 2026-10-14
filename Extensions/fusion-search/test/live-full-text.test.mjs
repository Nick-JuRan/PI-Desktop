import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const settingsPath = process.env.FUSION_TEST_SETTINGS_PATH;
const sessionId = process.env.FUSION_TEST_SESSION_ID;
const pnId = process.env.FUSION_TEST_PNID;

/**
 * Reads page 1 of a real session first so the plugin remembers the record,
 * then reads one listed pnId in full. Settles the three facts the offline
 * suite cannot: whether the deployment accepts the quick-view Referer sent
 * through pi.net.fetch, whether it needs the ssid header, and whether the
 * configured database carries full text at all. Set FUSION_TEST_PNID to a
 * pnId listed on that page; leave it unset to read the first record.
 */
test("plugin entry reads a real patent's full text from a listed result", {
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
        requests.push({ path: new URL(input.url).pathname, status: response.status, ssid: Boolean(input.headers?.ssid) });
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
    const page = await registeredTools.get("fusion_semantic_result_page").execute({ session_id: sessionId, page: 1 }, {});
    assert.equal(page?.ok, true, `live result-page read failed with code=${String(page?.error?.code ?? "unknown")}; details withheld`);
    assert.ok(page.records.length > 0, "the session page must list at least one record");
    const target = pnId || page.records[0].pnId;

    const text = await registeredTools.get("fusion_full_text").execute({ pnId: target }, {});
    assert.equal(typeof text, "string", `live full-text read failed with code=${String(text?.error?.code ?? "unknown")}: ${String(text?.error?.message ?? "")}`);
    assert.ok(text.startsWith(target), "the first line names the record");
    assert.match(text, /\n权利要求\n/u);
    assert.match(text, /\n说明书\n/u);
    assert.match(text, /\[\d{4}\] /u, "description paragraphs carry provider numbers");
    assert.ok(!/<[a-z][^>]*>/iu.test(text), "no markup reaches the model");

    const fullTextRequests = requests.filter((request) => request.path === "/api/neusipo-app-view/fastFullText/queryFullText");
    assert.ok(fullTextRequests.length >= 1);
    assert.ok(fullTextRequests.every((request) => request.status === 200));
    assert.ok(fullTextRequests[0].ssid, "a listed record is read with the ssid header");
    assert.ok(!requests.some((request) => request.path.endsWith("/new/action/executeSearch")));
  } finally {
    try { await plugin.onUnload(); } finally { delete globalThis.pi; }
  }
});

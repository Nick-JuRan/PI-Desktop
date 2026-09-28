import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const fakeCnki = require("./helpers/fake-cnki.cjs");
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * A `pi`-shaped stub plus a fake CNKI installed at the `https.request`
 * boundary. The cookie comes from private settings so the entry never reaches
 * login.cnki.net here.
 */
function setupPi({ settings = { cookie: "manual=1" }, failRegisterName } = {}) {
  const registeredTools = new Map();
  const { calls: netCalls } = fakeCnki.install(fakeCnki.fixtureHandler(fixturesDir));
  const pi = {
    plugin: {
      getSettings: async () => ({ ...settings }),
      setSettings: async (partial) => Object.assign(settings, partial),
    },
    net: {
      fetch: async () => {
        throw new Error("pi.net.fetch must not be used for CNKI: Chromium replaces the Cookie header");
      },
    },
    agent: {
      registerTool: async (tool) => {
        if (tool.name === failRegisterName) throw new Error(`refused ${tool.name}`);
        registeredTools.set(tool.name, tool);
      },
      unregisterTool: async (name) => {
        registeredTools.delete(name);
      },
    },
  };
  return { pi, registeredTools, netCalls, cleanup: () => fakeCnki.uninstall() };
}

function loadEntry() {
  delete require.cache[require.resolve("../main.cjs")];
  return require("../main.cjs");
}

test("onLoad registers both CNKI tools from the manifest with their schemas and risk", async (t) => {
  const { pi, registeredTools, cleanup } = setupPi();
  t.after(cleanup);
  globalThis.pi = pi;
  const entry = loadEntry();
  await entry.onLoad();
  assert.deepEqual([...registeredTools.keys()], ["CNKI_ScanPaper", "CNKI_GetPaperMainBody"]);
  const scan = registeredTools.get("CNKI_ScanPaper");
  assert.equal(scan.risk, "medium");
  assert.deepEqual(scan.schema.required, ["value"]);
  assert.deepEqual(Object.keys(scan.schema.properties), ["value", "pageNum"]);
  assert.equal(scan.schema.properties.pageNum.default, 1);
  assert.equal("withFactors" in scan.schema.properties, false);
  const body = registeredTools.get("CNKI_GetPaperMainBody");
  assert.deepEqual(body.schema.required, ["HTML_READING_URL"]);
  assert.deepEqual(Object.keys(body.schema.properties), ["HTML_READING_URL"]);
  await entry.onUnload();
  assert.equal(registeredTools.size, 0);
  delete globalThis.pi;
});

test("the registered tools execute end to end against a fake CNKI behind https.request", async (t) => {
  const { pi, registeredTools, netCalls, cleanup } = setupPi();
  t.after(cleanup);
  globalThis.pi = pi;
  const entry = loadEntry();
  await entry.onLoad();
  const scan = registeredTools.get("CNKI_ScanPaper");
  const result = await scan.execute({ value: "格罗皮乌斯" }, { signal: undefined, log: () => {} });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result), ["ok", "pageNum", "totalPage", "totalHits", "papers"]);
  assert.equal(result.totalPage, 62);
  assert.equal(result.papers.length, 2);
  assert.deepEqual(Object.keys(result.papers[0]), ["Title", "Abstract", "HTML_READING_URL"]);
  assert.equal("Href" in result.papers[0], false);
  assert.equal(result.papers[0].HTML_READING_URL, "https://kns.cnki.net/kcms2/article/htmlreading?v=READ123&uniplatform=NZKPT");
  assert.equal(netCalls.length, 3, "one search + two abstract pages");
  assert.ok(netCalls.every((call) => call.headers.Cookie === "manual=1"), "the settings cookie is used without any login");
  assert.ok(netCalls.every((call) => new URL(call.url).hostname.endsWith(".cnki.net")), "only cnki.net hosts");

  const body = registeredTools.get("CNKI_GetPaperMainBody");
  const text = await body.execute({ HTML_READING_URL: "https://kns.cnki.net/nzkhtml/knsread/index?fileName=F&tableName=T&dbCode=D&invoice=I" }, { log: () => {} });
  assert.equal(typeof text, "string");
  assert.match(text, /^基于格罗皮乌斯的现代建筑教育研究\n\n1 引言/);

  const failure = await body.execute({}, { log: () => {} });
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, "INVALID_ARGUMENT");
  await entry.onUnload();
  delete globalThis.pi;
});

test("a registration failure rolls back the tools already registered", async (t) => {
  const { pi, registeredTools, cleanup } = setupPi({ failRegisterName: "CNKI_GetPaperMainBody" });
  t.after(cleanup);
  globalThis.pi = pi;
  const entry = loadEntry();
  await assert.rejects(entry.onLoad(), /refused CNKI_GetPaperMainBody/);
  assert.equal(registeredTools.size, 0);
  delete globalThis.pi;
});

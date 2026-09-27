import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/**
 * A `pi`-shaped stub. The cookie comes from private settings so the entry
 * never reaches login.cnki.net here; `net.fetch` answers by URL.
 */
function setupPi({ settings = { cookie: "manual=1" }, failRegisterName } = {}) {
  const registeredTools = new Map();
  const netCalls = [];
  const pi = {
    plugin: {
      getSettings: async () => ({ ...settings }),
      setSettings: async (partial) => Object.assign(settings, partial),
    },
    net: {
      fetch: async (input) => {
        netCalls.push(input);
        const { url } = input;
        if (url.startsWith("https://kns.cnki.net/kns8s/brief/grid")) return { status: 200, headers: {}, bodyText: fixture("search-page.html") };
        if (url.startsWith("https://kns.cnki.net/kcms2/article/abstract")) return { status: 200, headers: {}, bodyText: fixture("abstract-page.html") };
        if (url.startsWith("https://kns.cnki.net/nzkhtml/knsread/litNotes/getPaperInfo")) return { status: 200, headers: {}, bodyText: fixture("reader-response.json") };
        return { status: 404, headers: {}, bodyText: "not found" };
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
  return { pi, registeredTools, netCalls };
}

function loadEntry() {
  delete require.cache[require.resolve("../main.cjs")];
  return require("../main.cjs");
}

test("onLoad registers both CNKI tools from the manifest with their schemas and risk", async () => {
  const { pi, registeredTools } = setupPi();
  globalThis.pi = pi;
  const entry = loadEntry();
  await entry.onLoad();
  assert.deepEqual([...registeredTools.keys()], ["CNKI_ScanPaper", "CNKI_GetPaperMainBody"]);
  const scan = registeredTools.get("CNKI_ScanPaper");
  assert.equal(scan.risk, "medium");
  assert.deepEqual(scan.schema.required, ["value"]);
  assert.deepEqual(Object.keys(scan.schema.properties), ["value", "pageSize", "pageNum"]);
  assert.equal("withFactors" in scan.schema.properties, false);
  const body = registeredTools.get("CNKI_GetPaperMainBody");
  assert.deepEqual(body.schema.required, ["href"]);
  await entry.onUnload();
  assert.equal(registeredTools.size, 0);
  delete globalThis.pi;
});

test("the registered tools execute end to end against stubbed CNKI responses", async () => {
  const { pi, registeredTools, netCalls } = setupPi();
  globalThis.pi = pi;
  const entry = loadEntry();
  await entry.onLoad();
  const scan = registeredTools.get("CNKI_ScanPaper");
  const result = await scan.execute({ value: "格罗皮乌斯", pageSize: 2 }, { signal: undefined, log: () => {} });
  assert.equal(result.ok, true);
  assert.equal(result.returned, 2);
  assert.equal(result.papers[0].HTML_READING_URL, "https://kns.cnki.net/kcms2/article/htmlreading?v=READ123&uniplatform=NZKPT");
  assert.ok(netCalls.every((call) => call.headers.Cookie === "manual=1"), "the settings cookie is used without any login");

  const body = registeredTools.get("CNKI_GetPaperMainBody");
  const text = await body.execute({ href: "https://kns.cnki.net/nzkhtml/knsread/index?fileName=F&tableName=T&dbCode=D&invoice=I" }, { log: () => {} });
  assert.equal(typeof text, "string");
  assert.match(text, /^基于格罗皮乌斯的现代建筑教育研究\n\n1 引言/);

  const failure = await body.execute({}, { log: () => {} });
  assert.equal(failure.ok, false);
  assert.equal(failure.error.code, "INVALID_ARGUMENT");
  await entry.onUnload();
  delete globalThis.pi;
});

test("a registration failure rolls back the tools already registered", async () => {
  const { pi, registeredTools } = setupPi({ failRegisterName: "CNKI_GetPaperMainBody" });
  globalThis.pi = pi;
  const entry = loadEntry();
  await assert.rejects(entry.onLoad(), /refused CNKI_GetPaperMainBody/);
  assert.equal(registeredTools.size, 0);
  delete globalThis.pi;
});

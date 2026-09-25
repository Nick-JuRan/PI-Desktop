import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

function makeFakeJwt(expSecondsFromNow) {
  const exp = Math.floor(Date.now() / 1000) + expSecondsFromNow;
  return `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
}

function setupPi({ token, credentials = { username: "user1", password: "pw1" }, failRegisterName } = {}) {
  const registeredTools = new Map();
  let settingsReads = 0;
  const settings = { ...credentials, ...(token ? { token } : {}) };
  const netCalls = [];
  const pi = {
    plugin: {
      getSettings: async () => {
        settingsReads += 1;
        return { ...settings };
      },
      setSettings: async (partial) => Object.assign(settings, partial),
      getDataPath: async () => "unused",
    },
    net: {
      fetch: async (input) => {
        netCalls.push(input);
        const url = new URL(input.url);
        const isCreate = url.pathname.endsWith("/neusipo-app-search/element/addElement");
        const response = isCreate
          ? { status: 200, t: "ELEMENT-1", message: "SUCCESS" }
          : url.pathname.endsWith("/neusipo-app-search/fusionSearch/element/retrieval")
            ? {
              status: 200,
              t: {
                code: "200",
                data: {
                  records: [{ srcEle: [{ sec: "cn", eles: [{ wd: "claim term", wt: 4 }] }] }],
                },
              },
            }
            : url.pathname.endsWith("/neusipo-app-search/dbAll")
              ? { status: 200, t: { allList: [{ dbCode: "CNTXT", dbId: "DB201" }] } }
            : url.pathname.endsWith("/fusionSearch/new/valid/boolterm")
              ? { status: 200, t: true }
              : url.pathname.endsWith("/element/selectElement")
                ? { status: 200, t: { id: "SEMANTIC-ELEMENT-1" } }
                : url.pathname.endsWith("/fusionSearch/new/action/executeSearch")
                  ? { status: 200, t: "SEARCH-SESSION-1" }
                  : url.pathname.endsWith("/fusionSearch/new/forOverview")
                    ? { status: 200, t: {
                      ssId: "SEARCH-SESSION-1",
                      hitCounts: 123,
                      listCounts: 1,
                      semSortCounts: 1,
                      fromSource: "boolean-semantic",
                      resultList: [{ pnId: "CN1A", ti: "Title", simVal: 99, semanticSort: 1 }],
                    } }
                    : url.pathname.endsWith("/fusionResult/results")
                      ? { status: 200, t: {
                        ssId: "SEARCH-SESSION-1",
                        listCounts: 51,
                        page: 1,
                        resultList: [
                          {
                            ssId: "SEARCH-SESSION-1",
                            pnId: "CN1A",
                            ti: "Title",
                            simVal: 99,
                            semanticSort: 1,
                            abview: [{ indexCnName: "摘要", indexEnName: "AB", value: "<p>Abstract &amp; details</p>" }],
                            clms: [{ indexEnName: "CLMFIR", value: "<result>Claim text</result>" }],
                          },
                        ],
                      } }
                      : { status: 404, message: "unexpected endpoint" };
        return { status: 200, bodyText: JSON.stringify(response) };
      },
    },
    agent: {
      registerTool: async (tool) => {
        if (tool.name === failRegisterName) throw new Error("tool registration failed");
        registeredTools.set(tool.name, tool);
      },
      unregisterTool: async (name) => { registeredTools.delete(name); },
    },
  };
  return { pi, getRegisteredTool: (name = "fusion_semantic_baseline") => registeredTools.get(name), registeredTools, netCalls, settings, settingsReads: () => settingsReads };
}

test("the tool validates the action before touching credentials", async () => {
  const { pi, getRegisteredTool, settingsReads } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool();
    const result = await tool.execute({ action: "bogus" }, {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_INPUT");
    assert.equal(settingsReads(), 0, "an invalid action must not read settings");
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("the registered schema exposes two claim-scoped actions and supported case-number kinds", async () => {
  const { pi, getRegisteredTool } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool();
    assert.deepEqual(tool.schema.properties.action.enum, ["prepare", "update_terms"]);
    assert.deepEqual(tool.schema.properties.reference_kind.enum, [
      "application_number",
      "publication_number",
      "text",
    ]);
    assert.equal(tool.planSafeActions, undefined);
    assert.match(tool.description, /one explicitly specified patent claim/i);
    assert.match(tool.description, /not the application as a whole/i);
    assert.match(tool.schema.properties.reference_kind.description, /your own paraphrase/i);
    assert.match(tool.schema.properties.reference_kind.description, /Do not copy the claim verbatim/i);
    assert.match(tool.schema.properties.reference_kind.description, /No other case-number type is accepted/);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("the Boolean tool schema accepts displayed database codes and no provider IDs", async () => {
  const { pi, getRegisteredTool } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool("fusion_boolean_search");
    assert.deepEqual(tool.schema.required, ["database", "query"]);
    assert.deepEqual(tool.schema.properties.database.enum, ["CNTXT", "CTTXT", "ENTXT", "ENTXTC", "VEN", "DWPI"]);
    assert.equal(tool.schema.properties.dbId, undefined);
    assert.equal(tool.planSafeActions, undefined);
    assert.match(tool.description, /never automatically replayed/i);
    assert.deepEqual([...Object.keys(tool.schema.properties)].sort(), ["database", "query"]);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("the result-page tool accepts only session_id and page", async () => {
  const { pi, getRegisteredTool } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool("fusion_semantic_result_page");
    assert.deepEqual(tool.schema.required, ["session_id", "page"]);
    assert.deepEqual(Object.keys(tool.schema.properties).sort(), ["page", "session_id"]);
    assert.equal(tool.schema.properties.page.default, 1);
    assert.equal(tool.schema.properties.page.minimum, 1);
    assert.equal(tool.planSafeActions, undefined);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("plugin unload unregisters both tools", async () => {
  const { pi, registeredTools } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    assert.deepEqual([...registeredTools.keys()], ["fusion_semantic_baseline", "fusion_boolean_search", "fusion_semantic_result_page"]);
    await plugin.onUnload();
    assert.equal(registeredTools.size, 0);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("partial tool registration rolls back the already-registered contribution", async () => {
  const { pi, registeredTools } = setupPi({ failRegisterName: "fusion_boolean_search" });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await assert.rejects(plugin.onLoad(), /tool registration failed/);
    assert.equal(registeredTools.size, 0);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("Boolean search resolves dbId from the live catalog and returns only count and session ID", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool("fusion_boolean_search");
    const result = await tool.execute({ database: "CTTXT", query: "A01B1/00/IC" }, {});
    assert.deepEqual(result, {
      ok: true,
      database: "CNTXT",
      total_hits: 123,
      session_id: "SEARCH-SESSION-1",
    });
    assert.equal(netCalls.length, 5);
    assert.ok(netCalls.every((input) => input.headers.Authorization === `Bearer ${token}`));
    const requests = netCalls.map((input) => ({
      path: new URL(input.url).pathname,
      body: JSON.parse(input.body),
    }));
    assert.equal(requests[0].path, "/api/neusipo-app-search/dbAll");
    assert.deepEqual(requests[1].body, { dbIds: ["DB201"], boolterm: "A01B1/00/IC" });
    assert.equal(requests[2].path, "/api/neusipo-app-search/element/selectElement");
    assert.deepEqual(requests[2].body, {});
    assert.deepEqual(requests[3].body.dbs, ["DB201"]);
    assert.equal(requests[3].body.searchType, "boolean");
    assert.equal(requests[3].body.semanticParam.boolterm, "A01B1/00/IC");
    assert.equal(requests[3].body.semanticParam.eid, "SEMANTIC-ELEMENT-1");
    assert.deepEqual(requests[4].body.dbs, ["DB201"]);
    assert.equal(requests[4].body.ssId, "SEARCH-SESSION-1");
    assert.equal(requests[4].body.size, 20);
    assert.equal(requests[4].body.searchType, "boolean-semantic");
    assert.equal(requests[4].body.semanticParam.boolterm, "A01B1/00/IC");
    assert.ok(!JSON.stringify(result).includes("DB201"));
    assert.equal(result.records, undefined);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("a prepared semantic baseline is carried into the subsequent Boolean search", async () => {
  const { pi, getRegisteredTool, netCalls } = setupPi({ token: makeFakeJwt(7200) });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const semantic = getRegisteredTool("fusion_semantic_baseline");
    const boolean = getRegisteredTool("fusion_boolean_search");
    const prepared = await semantic.execute({
      action: "prepare",
      reference_kind: "application_number",
      reference: "202010123456.7",
    }, {});
    assert.equal(prepared.ok, true);
    const result = await boolean.execute({ database: "CNTXT", query: "A01B1/00/IC" }, {});
    assert.equal(result.ok, true);
    const requests = netCalls.map((input) => ({
      path: new URL(input.url).pathname,
      body: JSON.parse(input.body),
    }));
    assert.equal(requests.some((request) => request.path.endsWith("/element/selectElement")), false);
    const search = requests.find((request) => request.path.endsWith("/action/executeSearch"));
    assert.equal(search.body.semanticParam.eid, prepared.element_id);
    assert.equal(search.body.semanticParam.top, "400");
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("the semantic result-page tool returns ranked rows and computes totalPage from listCounts", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool("fusion_semantic_result_page");
    const result = await tool.execute({ session_id: "SEARCH-SESSION-1", page: 1 }, {});
    assert.deepEqual(result, {
      ok: true,
      semantic_sorted: true,
      records: [{
        pnId: "CN1A",
        ti: "Title",
        simVal: 99,
        semanticSort: 1,
        abview: "Abstract & details",
        clms: "Claim text",
      }],
      totalPage: 3,
      page: 1,
    });
    const request = netCalls.at(-1);
    assert.equal(request.url, "http://10.160.28.16/api/neusipo-app-search/fusionResult/results");
    assert.deepEqual(JSON.parse(request.body), {
      viewMode: "1",
      start: 0,
      size: 20,
      lang: "1",
      ssId: "SEARCH-SESSION-1",
      statDbs: [],
      showAbsFlag: "1",
      showDescImageFlag: "0",
      statParams: [],
      ifStat: 0,
      sortField: ["", ""],
    });
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("a tool call uses the stored token and sends it as the Authorization header", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool();
    const result = await tool.execute({
      action: "prepare",
      reference_kind: "application_number",
      reference: "202010123456.7",
    }, {});
    assert.equal(result.ok, true);
    assert.equal(result.action, "prepare");
    assert.deepEqual(result.terms, { chinese: [{ term: "claim term", weight: 4 }], english: [] });
    assert.equal(netCalls.length, 2);
    assert.ok(netCalls.every((input) => input.headers.Authorization === `Bearer ${token}`));
    assert.equal(netCalls[0].url, "http://10.160.28.16/api/neusipo-app-search/element/addElement");
    assert.equal(netCalls[1].url, "http://10.160.28.16/api/neusipo-app-search/fusionSearch/element/retrieval");
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("an expiring token with no credentials reports AUTH_CONFIG_MISSING, not a silent replay", async () => {
  const expiring = makeFakeJwt(60);
  const { pi, getRegisteredTool, netCalls } = setupPi({
    token: expiring,
    credentials: {},
  });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool();
    const result = await tool.execute({
      action: "prepare",
      reference_kind: "publication_number",
      reference: "CN123456A",
    }, {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "AUTH_CONFIG_MISSING");
    assert.equal(netCalls.length, 0, "no search request was sent with the expiring token");
    assert.match(result.error.message, /settings\.json/);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

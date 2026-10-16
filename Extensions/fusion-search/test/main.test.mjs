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
  // Two fixture sessions. The live results endpoint below behaves like the
  // provider: it serves whichever session was created last, whatever ssId is
  // asked for, echoing the requested ssId at the top level.
  const sessionRows = {
    "SEARCH-SESSION-1": [{
      ssId: "SEARCH-SESSION-1",
      pnId: "CN1A",
      anId: "CN2022000001.1",
      dbName: "CNTXT",
      ti: "Title",
      simVal: 99,
      semanticSort: 1,
      abview: [{ indexCnName: "摘要", indexEnName: "AB", value: "<p>Abstract &amp; details</p>" }],
      clms: [{ indexEnName: "CLMFIR", value: "<result>Claim text</result>" }],
    }],
    "SEARCH-SESSION-2": [{
      ssId: "SEARCH-SESSION-2",
      pnId: "CN2B",
      anId: "CN2022000002.2",
      dbName: "ENTXT",
      ti: "Second title",
      simVal: 61,
      semanticSort: 1,
      abview: [{ indexCnName: "摘要", value: "Second abstract" }],
      clms: [{ indexCnName: "主权利要求说明", value: "Second claim" }],
    }],
  };
  let lastCreatedSession = "SEARCH-SESSION-1";
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
        const body = input.body ? JSON.parse(input.body) : {};
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
                  ? (() => {
                    lastCreatedSession = String(body.semanticParam?.boolterm ?? "").includes("SECOND") ? "SEARCH-SESSION-2" : "SEARCH-SESSION-1";
                    return { status: 200, t: lastCreatedSession };
                  })()
                  : url.pathname.endsWith("/fusionSearch/new/forOverview")
                    ? { status: 200, t: {
                      ssId: body.ssId,
                      hitCounts: 123,
                      listCounts: 1,
                      semSortCounts: 1,
                      fromSource: "boolean-semantic",
                      resultList: sessionRows[body.ssId] ?? [],
                    } }
                    : url.pathname.endsWith("/fusionResult/results")
                      ? { status: 200, t: {
                        ssId: body.ssId,
                        listCounts: 51,
                        page: 1,
                        resultList: sessionRows[lastCreatedSession],
                      } }
                      : url.pathname.endsWith("/fastFullText/queryFullText")
                        ? { status: 200, t: { fullTextHtml: [
                          '<table>',
                          '<tr><td id="claim_title">权利要求</td></tr>',
                          '<tr><td id="claim_1">1.一种装置。</td></tr>',
                          '<tr><td id="description_title">说明书</td></tr>',
                          '<tr><td id="description_1">技术领域</td></tr>',
                          '<tr><td id="description_2">本发明涉及装置。</td></tr>',
                          '</table>',
                        ].join("") } }
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

test("the full-text tool accepts only pnId and is declared low risk", async () => {
  const { pi, getRegisteredTool } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const tool = getRegisteredTool("fusion_full_text");
    assert.deepEqual(tool.schema.required, ["pnId"]);
    assert.deepEqual(Object.keys(tool.schema.properties), ["pnId"]);
    assert.equal(tool.schema.additionalProperties, false);
    assert.equal(tool.risk, "low");
    assert.match(tool.description, /plain text/i);
    assert.match(tool.description, /nothing else is needed/i);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("plugin unload unregisters every tool", async () => {
  const { pi, registeredTools } = setupPi();
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    assert.deepEqual([...registeredTools.keys()], ["fusion_semantic_baseline", "fusion_boolean_search", "fusion_semantic_result_page", "fusion_full_text"]);
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
    assert.equal(requests[4].body.size, 400, "the overview is the session snapshot");
    assert.equal(requests[4].body.showAbsFlag, "1");
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

test("a listed record is read in full with the session, database and application number the plugin remembered", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const search = await getRegisteredTool("fusion_boolean_search").execute({ database: "CNTXT", query: "A01B1/00/IC" }, {});
    assert.equal(search.ok, true);
    const page = await getRegisteredTool("fusion_semantic_result_page").execute({ session_id: "SEARCH-SESSION-1", page: 1 }, {});
    assert.equal(page.ok, true);
    assert.equal(page.records[0].anId, undefined, "the result page projection is unchanged");

    const text = await getRegisteredTool("fusion_full_text").execute({ pnId: "CN1A" }, {});
    assert.equal(text, [
      "CN1A  Title",
      "",
      "权利要求",
      "1.一种装置。",
      "",
      "说明书",
      "技术领域",
      "[0002] 本发明涉及装置。",
    ].join("\n"));

    const request = netCalls.at(-1);
    assert.equal(request.url, "http://10.160.28.16/api/neusipo-app-view/fastFullText/queryFullText");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.Authorization, `Bearer ${token}`);
    assert.equal(request.headers.Referer, "http://10.160.28.16/quickView");
    assert.equal(request.headers.ssid, "SEARCH-SESSION-1");
    assert.deepEqual(JSON.parse(request.body), {
      anid: "CN2022000001.1",
      pnid: "CN1A",
      source: "GENERAL",
      patType: "PATENT",
      viewDb: "CNTXT",
    });
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("a pnId the plugin never listed is requested bare and still rendered", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const text = await getRegisteredTool("fusion_full_text").execute({ pnId: "CN7Z" }, {});
    assert.ok(text.startsWith("CN7Z\n\n权利要求\n"));
    const request = netCalls.at(-1);
    assert.equal(request.headers.ssid, undefined);
    assert.deepEqual(JSON.parse(request.body), { anid: "", pnid: "CN7Z", source: "GENERAL", patType: "PATENT", viewDb: "" });
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("unloading the plugin forgets listed records", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    await getRegisteredTool("fusion_semantic_result_page").execute({ session_id: "SEARCH-SESSION-1", page: 1 }, {});
    await plugin.onUnload();
    await plugin.onLoad();
    await getRegisteredTool("fusion_full_text").execute({ pnId: "CN1A" }, {});
    assert.equal(netCalls.at(-1).headers.ssid, undefined);
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("two sessions searched back to back each page their own frozen rows, with no network read", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    const search = getRegisteredTool("fusion_boolean_search");
    const first = await search.execute({ database: "CNTXT", query: "A01B1/00/IC" }, {});
    const second = await search.execute({ database: "CNTXT", query: "SECOND/BA" }, {});
    assert.equal(first.session_id, "SEARCH-SESSION-1");
    assert.equal(second.session_id, "SEARCH-SESSION-2");
    const requestsBefore = netCalls.length;

    const page = getRegisteredTool("fusion_semantic_result_page");
    const pageOne = await page.execute({ session_id: "SEARCH-SESSION-1", page: 1 }, {});
    const pageTwo = await page.execute({ session_id: "SEARCH-SESSION-2", page: 1 }, {});
    assert.deepEqual(pageOne, {
      ok: true,
      semantic_sorted: true,
      records: [{ pnId: "CN1A", ti: "Title", simVal: 99, semanticSort: 1, abview: "Abstract & details", clms: "Claim text" }],
      totalPage: 1,
      page: 1,
    });
    assert.equal(pageTwo.records[0].pnId, "CN2B");
    assert.equal(netCalls.length, requestsBefore, "frozen sessions are paged without a network request");

    // The live endpoint would have served session 2's rows for session 1 here.
    const text = await getRegisteredTool("fusion_full_text").execute({ pnId: "CN1A" }, {});
    const request = netCalls.at(-1);
    assert.equal(request.headers.ssid, "SEARCH-SESSION-1");
    assert.equal(JSON.parse(request.body).viewDb, "CNTXT");
    assert.ok(text.startsWith("CN1A  Title"));
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

test("a session the plugin never froze is still read live, and reloading the plugin forgets snapshots", async () => {
  const token = makeFakeJwt(7200);
  const { pi, getRegisteredTool, netCalls } = setupPi({ token });
  globalThis.pi = pi;
  const plugin = require("../main.cjs");
  try {
    await plugin.onLoad();
    await getRegisteredTool("fusion_boolean_search").execute({ database: "CNTXT", query: "A01B1/00/IC" }, {});
    await plugin.onUnload();
    await plugin.onLoad();
    const before = netCalls.length;
    const result = await getRegisteredTool("fusion_semantic_result_page").execute({ session_id: "SEARCH-SESSION-1", page: 1 }, {});
    assert.equal(result.ok, true);
    assert.equal(netCalls.length, before + 1, "after a reload the page is fetched from the provider");
    assert.equal(netCalls.at(-1).url, "http://10.160.28.16/api/neusipo-app-search/fusionResult/results");
  } finally {
    await plugin.onUnload();
    delete globalThis.pi;
  }
});

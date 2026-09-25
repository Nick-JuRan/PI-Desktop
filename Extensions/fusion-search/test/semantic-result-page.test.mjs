import assert from "node:assert/strict";
import test from "node:test";

import {
  createFusionResultPageApi,
  executeSemanticResultPage,
  FUSION_RESULT_PAGE_ENDPOINT,
  FUSION_RESULT_PAGE_SIZE,
} from "../src/semantic-result-page.mjs";

function makeRecord({ pnId = "CN1A", ti = "Title", simVal = 99, semanticSort = 1, ssId = "SESSION-1" } = {}) {
  return {
    ssId,
    pnId,
    ti,
    simVal,
    semanticSort,
    abview: [{ indexCnName: "摘要（公开）", value: "Abstract text" }],
    clms: [{ indexCnName: "主权利要求说明", value: "Claim text" }],
  };
}

function envelope(t) {
  return { status: 200, bodyText: JSON.stringify({ status: 200, t }) };
}

test("result-page tool projects semantic scores and requested patent detail fields", async () => {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(input);
    return envelope({
      ssId: "SESSION-1",
      listCounts: 51,
      page: 1,
      resultList: [
        makeRecord(),
        makeRecord({ pnId: "CN2A", ti: "Second", simVal: 92.5, semanticSort: 2 }),
      ],
    });
  };
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    authorization: "Bearer TOKEN",
    fetchImpl,
  });

  assert.deepEqual(result, {
    ok: true,
    semantic_sorted: true,
    records: [
      {
        pnId: "CN1A",
        ti: "Title",
        simVal: 99,
        semanticSort: 1,
        abview: "Abstract text",
        clms: "Claim text",
      },
      {
        pnId: "CN2A",
        ti: "Second",
        simVal: 92.5,
        semanticSort: 2,
        abview: "Abstract text",
        clms: "Claim text",
      },
    ],
    totalPage: 3,
    page: 1,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `http://10.160.28.16/api${FUSION_RESULT_PAGE_ENDPOINT}`);
  assert.equal(calls[0].headers.Authorization, "Bearer TOKEN");
  assert.deepEqual(JSON.parse(calls[0].body), {
    viewMode: "1",
    start: 0,
    size: FUSION_RESULT_PAGE_SIZE,
    lang: "1",
    ssId: "SESSION-1",
    statDbs: [],
    showAbsFlag: "1",
    showDescImageFlag: "0",
    statParams: [],
    ifStat: 0,
    sortField: ["", ""],
  });
});

test("page offset is (page - 1) * shared page size", async () => {
  let body;
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 3 },
    authorization: "Bearer TOKEN",
    fetchImpl: async (input) => {
      body = JSON.parse(input.body);
      return envelope({ ssId: "SESSION-1", listCounts: 121, page: 3, resultList: [makeRecord({ semanticSort: 41 })] });
    },
  });
  assert.equal(FUSION_RESULT_PAGE_SIZE, 20);
  assert.equal(body.start, 40);
  assert.equal(body.size, 20);
  assert.equal(result.totalPage, 7);
  assert.equal(result.page, 3);
});

test("invalid input is rejected before the network is touched", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return envelope({}); };
  for (const args of [
    { session_id: "", page: 1 },
    { session_id: "SESSION-1", page: 0 },
    { session_id: "SESSION-1", page: "1" },
    { session_id: "SESSION-1", page: 1, size: 20 },
  ]) {
    const result = await executeSemanticResultPage({ args, authorization: "Bearer TOKEN", fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_INPUT");
  }
  assert.equal(calls, 0);
});

test("unranked rows are refused instead of being labelled semantic results", async () => {
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    authorization: "Bearer TOKEN",
    fetchImpl: async () => envelope({
      ssId: "SESSION-1",
      listCounts: 1,
      resultList: [{ ssId: "SESSION-1", pnId: "CN1A", ti: "Unranked" }],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SEMANTIC_SORT_UNAVAILABLE");
});

test("rows with foreign session IDs are rejected", async () => {
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    authorization: "Bearer TOKEN",
    fetchImpl: async () => envelope({
      ssId: "SESSION-1",
      listCounts: 1,
      resultList: [makeRecord({ ssId: "FOREIGN-SESSION" })],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RESULT_SESSION_MISMATCH");
});

test("semantic rank order must be increasing within the requested page", async () => {
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    authorization: "Bearer TOKEN",
    fetchImpl: async () => envelope({
      ssId: "SESSION-1",
      listCounts: 2,
      resultList: [makeRecord({ semanticSort: 2 }), makeRecord({ pnId: "CN2A", semanticSort: 1 })],
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SEMANTIC_SORT_ORDER_INVALID");
});

test("missing detail content is an empty string rather than null", async () => {
  const record = makeRecord();
  record.abview = [];
  record.clms = [];
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    authorization: "Bearer TOKEN",
    fetchImpl: async () => envelope({ ssId: "SESSION-1", listCounts: 1, resultList: [record] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.records[0].abview, "");
  assert.equal(result.records[0].clms, "");
});

test("abstract and main claim are returned as complete plain text", async () => {
  const record = makeRecord();
  record.abview = [{
    indexCnName: "摘要",
    indexEnName: "AB",
    value: "<div class=\"summary\"><p>摘要&amp;附图&nbsp;信息</p><p>包含&#x4E2D;&#25991;内容。</p></div>",
  }];
  record.clms = [{
    indexEnName: "CLMFIR",
    value: "<?xml version=\"1.0\" encoding=\"UTF-8\"?><![CDATA[<result>1. 一种装置，包括<p>完整<strong>技术</strong>方案及其效果。</p></result>]]>",
  }];
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    authorization: "Bearer TOKEN",
    fetchImpl: async () => envelope({ ssId: "SESSION-1", listCounts: 1, resultList: [record] }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.records[0].abview, "摘要&附图 信息\n包含中文内容。");
  assert.equal(result.records[0].clms, "1. 一种装置，包括\n完整技术方案及其效果。");
  assert.ok(!JSON.stringify(result.records[0]).includes("<"));
  assert.ok(!Object.hasOwn(result.records[0], "indexCnName"));
  assert.ok(!Object.hasOwn(result.records[0], "indexEnName"));
});

test("provider labels vary but only the first clean field value is returned", async () => {
  const record = makeRecord();
  record.abview = [{ indexCnName: "摘要", indexEnName: "AB", value: "Abstract text" }];
  record.clms = [{ indexEnName: "CLMFIR", value: "Claim text" }];
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    authorization: "Bearer TOKEN",
    fetchImpl: async () => envelope({ ssId: "SESSION-1", listCounts: 1, resultList: [record] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.records[0].abview, "Abstract text");
  assert.equal(result.records[0].clms, "Claim text");
});

test("an empty search with null listCounts and zero hitCounts returns zero pages", async () => {
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    authorization: "Bearer TOKEN",
    fetchImpl: async () => envelope({ ssId: "SESSION-1", listCounts: null, hitCounts: 0, resultList: [] }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.totalPage, 0);
  assert.deepEqual(result.records, []);
});

test("the API maps authentication errors for the shared token manager", async () => {
  const api = createFusionResultPageApi({
    authorization: "Bearer TOKEN",
    fetchImpl: async () => ({ status: 401, bodyText: "{}" }),
  });
  await assert.rejects(api.resultPage({ sessionId: "SESSION-1", page: 1, start: 0 }), (error) => {
    assert.equal(error.code, "REMOTE_AUTH_REJECTED");
    assert.equal(error.status, 401);
    return true;
  });
});

test("cancellation before result retrieval is reported", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const api = createFusionResultPageApi({
    authorization: "Bearer TOKEN",
    signal: controller.signal,
    fetchImpl: async () => { calls += 1; return envelope({}); },
  });
  const result = await executeSemanticResultPage({
    args: { session_id: "SESSION-1", page: 1 },
    api,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CANCELLED");
  assert.equal(calls, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  executeSemanticBaseline,
  createFusionSearchApi,
  SEMANTIC_BASELINE_ENDPOINTS,
} from "../src/semantic-baseline.mjs";

function retrievalEnvelope({ chinese = [], english = [], success = false, deletedChinese = [], deletedEnglish = [] } = {}) {
  const group = (sec, terms, deleted) => ({
    sec,
    eles: [
      ...terms.map(([wd, wt]) => ({ wd, wt, isAdd: 0 })),
      ...deleted.map((wd) => ({ wd, wt: 0, isAdd: 0 })),
    ],
  });
  return {
    status: 200,
    t: {
      code: "200",
      success,
      data: {
        records: [{
          srcEle: [
            group("cn", chinese, deletedChinese),
            group("en", english, deletedEnglish),
          ],
        }],
      },
    },
  };
}

function fakeApi(responses) {
  const calls = [];
  return {
    calls,
    async post(endpoint, payload) {
      calls.push({ endpoint, payload });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

test("prepare normalizes an application number and returns both term lists", async () => {
  const api = fakeApi([
    { status: 200, t: "ELEMENT-1", message: "SUCCESS" },
    retrievalEnvelope({ chinese: [["通信", 4]], english: [["wireless", 3]] }),
  ]);

  const result = await executeSemanticBaseline({
    api,
    args: {
      action: "prepare",
      reference_kind: "application_number",
      reference: "202010123456.7",
    },
  });

  assert.deepEqual(result, {
    ok: true,
    action: "prepare",
    element_id: "ELEMENT-1",
    reference: { kind: "application_number", value: "2020101234567" },
    terms: {
      chinese: [{ term: "通信", weight: 4 }],
      english: [{ term: "wireless", weight: 3 }],
    },
    deleted_terms: { chinese: [], english: [] },
  });
  assert.deepEqual(api.calls[0], {
    endpoint: SEMANTIC_BASELINE_ENDPOINTS.addElement,
    payload: { sno: "2020101234567", stxt: "" },
  });
  assert.deepEqual(api.calls[1].payload, { eId: "ELEMENT-1" });
});

test("prepare accepts direct text and returns a compact text reference", async () => {
  const api = fakeApi([
    { status: 200, t: { id: 42 }, message: "SUCCESS" },
    retrievalEnvelope({ chinese: [["点云", 5]] }),
  ]);
  const text = "一种用于点云采集和事件检测的监测方法及其设备";

  const result = await executeSemanticBaseline({
    api,
    args: { action: "prepare", reference_kind: "text", reference: text },
  });

  assert.equal(result.ok, true);
  assert.equal(result.element_id, "42");
  assert.deepEqual(result.reference, { kind: "text", length: text.length, preview: text });
  assert.deepEqual(api.calls[0].payload, { sno: "", stxt: text });
});

test("get_terms preserves active weights and exposes zero-weight deletions", async () => {
  const api = fakeApi([
    retrievalEnvelope({
      chinese: [["保留词", 5]],
      english: [["wireless", 3]],
      deletedChinese: ["已删除中文"],
      deletedEnglish: ["deleted english"],
    }),
  ]);

  const result = await executeSemanticBaseline({
    api,
    args: { action: "get_terms", element_id: 42 },
  });

  assert.deepEqual(result, {
    ok: true,
    action: "get_terms",
    element_id: "42",
    terms: {
      chinese: [{ term: "保留词", weight: 5 }],
      english: [{ term: "wireless", weight: 3 }],
    },
    deleted_terms: {
      chinese: [{ term: "已删除中文" }],
      english: [{ term: "deleted english" }],
    },
  });
});

test("update_terms preserves an omitted language and sends explicit deletions", async () => {
  const api = fakeApi([
    retrievalEnvelope({
      chinese: [["保留词", 2], ["删除词", 1]],
      english: [["wireless", 3]],
    }),
    { status: 200, t: true, message: "SUCCESS" },
    retrievalEnvelope({
      chinese: [["保留词", 5], ["新增词", 4]],
      english: [["wireless", 3]],
    }),
  ]);

  const result = await executeSemanticBaseline({
    api,
    args: {
      action: "update_terms",
      element_id: "ELEMENT-1",
      terms: {
        chinese: [
          { term: "保留词", weight: 5 },
          { term: "新增词", weight: 4 },
        ],
      },
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.verified, true);
  assert.deepEqual(api.calls[1], {
    endpoint: SEMANTIC_BASELINE_ENDPOINTS.modify,
    payload: {
      eid: "ELEMENT-1",
      eleStat: [
        { wd: "保留词", wt: 5, type: "cn", isAdd: 0 },
        { wd: "新增词", wt: 4, type: "cn", isAdd: "1" },
        { wd: "wireless", wt: 3, type: "en", isAdd: 0 },
        { wd: "删除词", wt: 0, type: "cn" },
      ],
    },
  });
  assert.deepEqual(result.terms, {
    chinese: [
      { term: "保留词", weight: 5 },
      { term: "新增词", weight: 4 },
    ],
    english: [{ term: "wireless", weight: 3 }],
  });
});

test("an aborted read does not return a success after the transport completes", async () => {
  let startedResolve;
  let finishFetch;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const response = new Promise((resolve) => { finishFetch = resolve; });
  const controller = new AbortController();
  const pending = executeSemanticBaseline({
    args: { action: "get_terms", element_id: 42 },
    authorization: "Bearer test-token",
    signal: controller.signal,
    fetchImpl: async () => {
      startedResolve();
      return response;
    },
  });

  await started;
  controller.abort();
  finishFetch({ status: 200, bodyText: JSON.stringify(retrievalEnvelope({ chinese: [["sensitive term", 3]] })) });
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CANCELLED");
});
test("an aborted read maps the host cancellation to CANCELLED", async () => {
  let startedResolve;
  let rejectFetch;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const response = new Promise((_resolve, reject) => { rejectFetch = reject; });
  const controller = new AbortController();
  const pending = executeSemanticBaseline({
    args: { action: "get_terms", element_id: 42 },
    authorization: "Bearer test-token",
    signal: controller.signal,
    fetchImpl: async () => {
      startedResolve();
      return response;
    },
  });

  await started;
  controller.abort();
  rejectFetch(Object.assign(new Error("plugin invocation cancelled"), { code: "PLUGIN_TOOL_ABORTED" }));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "CANCELLED");
});
test("an aborted remote mutation reports unknown outcome and is never replayed", async () => {
  let modifyStartedResolve;
  let rejectModify;
  const modifyStarted = new Promise((resolve) => { modifyStartedResolve = resolve; });
  const modifyResponse = new Promise((_resolve, reject) => { rejectModify = reject; });
  const controller = new AbortController();
  let requests = 0;
  const pending = executeSemanticBaseline({
    args: {
      action: "update_terms",
      element_id: 42,
      terms: { chinese: [{ term: "new term", weight: 3 }] },
    },
    authorization: "Bearer test-token",
    signal: controller.signal,
    fetchImpl: async (input) => {
      requests += 1;
      if (input.url.endsWith(SEMANTIC_BASELINE_ENDPOINTS.retrieval)) {
        return { status: 200, bodyText: JSON.stringify(retrievalEnvelope({ chinese: [["old term", 2]] })) };
      }
      modifyStartedResolve();
      return modifyResponse;
    },
  });

  await modifyStarted;
  controller.abort();
  rejectModify(Object.assign(new Error("tool call cancelled"), { code: "PLUGIN_TOOL_ABORTED" }));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REMOTE_OUTCOME_UNKNOWN");
  assert.equal(requests, 2, "the cancelled mutation is not retried or followed by verification");
});

test("invalid weights fail before a save request", async () => {
  const api = fakeApi([retrievalEnvelope({ chinese: [["旧词", 2]] })]);
  const result = await executeSemanticBaseline({
    api,
    args: {
      action: "update_terms",
      element_id: "ELEMENT-1",
      terms: { chinese: [{ term: "新词", weight: 6 }] },
      verify: false,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.equal(api.calls.length, 0, "input validation fails before any request");
});

test("the HTTP adapter applies the legacy JSON request headers without exposing tokens in tool input", async () => {
  const calls = [];
  const api = createFusionSearchApi({
    authorization: "Bearer TOKEN",
    fetchImpl: async (input) => {
      calls.push(input);
      return { status: 200, bodyText: JSON.stringify({ status: 200, t: true }) };
    },
  });

  await api.post(SEMANTIC_BASELINE_ENDPOINTS.modify, { eid: "E", eleStat: [] });

  assert.equal(calls[0].url, "http://10.160.28.16/api/neusipo-app-search/element/modify");
  assert.equal(calls[0].headers.Authorization, "Bearer TOKEN");
  assert.deepEqual(JSON.parse(calls[0].body), { eid: "E", eleStat: [] });
});

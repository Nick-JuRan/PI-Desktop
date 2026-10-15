import assert from "node:assert/strict";
import test from "node:test";

import {
  FUSION_FULL_TEXT_ENDPOINT,
  FUSION_FULL_TEXT_REFERER,
  FUSION_FULL_TEXT_TIMEOUT_MS,
  createFusionFullTextApi,
  executeFullText,
  fullTextPayload,
  validateFullTextInput,
} from "../src/full-text.mjs";
import { createRecordRegistry } from "../src/record-registry.mjs";

const FULL_TEXT_HTML = `
<table>
  <tr><td id="claim_title">权利要求</td></tr>
  <tr><td id="claim_1">1.一种可调鞋跟。</td></tr>
  <tr><td id="claim_2">2.根据权利要求1所述的鞋跟。</td></tr>
  <tr><td id="description_title">说明书</td></tr>
  <tr><td id="description_1">技术领域</td></tr>
  <tr><td id="description_2">本发明涉及鞋跟。</td></tr>
</table>`;

const RENDERED_BODY = [
  "权利要求",
  "1.一种可调鞋跟。",
  "2.根据权利要求1所述的鞋跟。",
  "",
  "说明书",
  "技术领域",
  "[0002] 本发明涉及鞋跟。",
].join("\n");

function envelope(t, message = null) {
  return { status: 200, bodyText: JSON.stringify({ status: 200, t, message }) };
}

function recordingFetch(responses) {
  const calls = [];
  const queue = [...responses];
  const fetchImpl = async (input) => {
    calls.push(input);
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next ?? envelope(null, "no more responses");
  };
  return { calls, fetchImpl };
}

function registryWithRecord() {
  const registry = createRecordRegistry();
  registry.rememberSession("SESSION-1", "CNTXT");
  registry.rememberRecords("SESSION-1", [
    { ssId: "SESSION-1", pnId: "CN1A;CN1B", anId: "CN2022001.1", dbName: "CNTXT", ti: "可调鞋跟" },
  ]);
  return registry;
}

test("only pnId is accepted and it must be a non-empty string", () => {
  assert.equal(validateFullTextInput({ pnId: "CN1A" }), null);
  for (const args of [undefined, [], { pnId: "" }, { pnId: 12 }, { pnId: "CN1A", page: 1 }, { pnId: "x".repeat(1001) }]) {
    const result = validateFullTextInput(args);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_INPUT");
  }
});

test("the payload mirrors the original SDK's quick-view request", () => {
  assert.deepEqual(fullTextPayload({ pnId: "CN1A", anId: "AN1", database: "CNTXT" }), {
    anid: "AN1",
    pnid: "CN1A",
    source: "GENERAL",
    patType: "PATENT",
    viewDb: "CNTXT",
  });
  assert.deepEqual(fullTextPayload({ pnId: "CN1A" }), {
    anid: "",
    pnid: "CN1A",
    source: "GENERAL",
    patType: "PATENT",
    viewDb: "",
  });
});

test("a listed record is read with the registered session, database and application number", async () => {
  const { calls, fetchImpl } = recordingFetch([envelope({ fullTextHtml: FULL_TEXT_HTML })]);
  const text = await executeFullText({
    args: { pnId: "CN1B" },
    authorization: "Bearer token-1",
    fetchImpl,
    registry: registryWithRecord(),
  });
  assert.equal(typeof text, "string");
  assert.equal(text, `CN1A;CN1B  可调鞋跟\n\n${RENDERED_BODY}`);
  assert.equal(calls.length, 1);
  const request = calls[0];
  assert.equal(request.url, `http://10.160.28.16/api${FUSION_FULL_TEXT_ENDPOINT}`);
  assert.equal(request.method, "POST");
  assert.equal(request.timeoutMs, FUSION_FULL_TEXT_TIMEOUT_MS);
  assert.equal(request.headers.Authorization, "Bearer token-1");
  assert.equal(request.headers.Referer, FUSION_FULL_TEXT_REFERER);
  assert.equal(request.headers.ssid, "SESSION-1");
  assert.deepEqual(JSON.parse(request.body), {
    anid: "CN2022001.1",
    pnid: "CN1A;CN1B",
    source: "GENERAL",
    patType: "PATENT",
    viewDb: "CNTXT",
  });
});

test("an unlisted pnId is requested bare: no ssid header, empty anid and viewDb, no title", async () => {
  const { calls, fetchImpl } = recordingFetch([envelope({ fullTextHtml: FULL_TEXT_HTML })]);
  const text = await executeFullText({
    args: { pnId: "CN9Z" },
    authorization: "Bearer token-1",
    fetchImpl,
    registry: createRecordRegistry(),
  });
  assert.equal(text, `CN9Z\n\n${RENDERED_BODY}`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.ssid, undefined);
  assert.deepEqual(JSON.parse(calls[0].body), { anid: "", pnid: "CN9Z", source: "GENERAL", patType: "PATENT", viewDb: "" });
});

test("without a registry the tool still works from the pnId alone", async () => {
  const { fetchImpl } = recordingFetch([envelope({ fullTextHtml: FULL_TEXT_HTML })]);
  const text = await executeFullText({ args: { pnId: "CN1A" }, authorization: "Bearer t", fetchImpl });
  assert.equal(text, `CN1A\n\n${RENDERED_BODY}`);
});

test("when the application number has no full text the publication number alone is tried once more", async () => {
  const { calls, fetchImpl } = recordingFetch([
    envelope(null, "未收录"),
    envelope({ fullTextHtml: FULL_TEXT_HTML }),
  ]);
  const text = await executeFullText({
    args: { pnId: "CN1A" },
    authorization: "Bearer t",
    fetchImpl,
    registry: registryWithRecord(),
  });
  assert.equal(text, `CN1A;CN1B  可调鞋跟\n\n${RENDERED_BODY}`);
  assert.deepEqual(calls.map((call) => JSON.parse(call.body).anid), ["CN2022001.1", ""]);
  assert.deepEqual(calls.map((call) => call.headers.ssid), ["SESSION-1", "SESSION-1"]);
});

test("a merged identity is reduced to the members the endpoint accepts", async () => {
  const registry = createRecordRegistry();
  registry.rememberSession("SESSION-1", "CNTXT");
  registry.rememberRecords("SESSION-1", [
    { ssId: "SESSION-1", pnId: "CN1A;CN1B;CN1C", anId: "CN2022001.1;CN2022002.2", dbName: "CNTXT", ti: "可调鞋跟" },
  ]);
  const { calls, fetchImpl } = recordingFetch([
    envelope(null, "未检索到收录的文献！"),
    envelope({ fullTextHtml: FULL_TEXT_HTML }),
  ]);
  const text = await executeFullText({
    args: { pnId: "CN1B" },
    authorization: "Bearer t",
    fetchImpl,
    registry,
  });
  assert.equal(text, `CN1A;CN1B;CN1C  可调鞋跟\n\n${RENDERED_BODY}`);
  // The endpoint rejects a `;`-joined application number, and a `;`-joined
  // publication number when no application number is sent: the first request
  // carries the first application member with the merged publication list
  // (the shape the web QuickView page sends), the second the first
  // publication member alone.
  assert.deepEqual(calls.map((call) => JSON.parse(call.body)), [
    { anid: "CN2022001.1", pnid: "CN1A;CN1B;CN1C", source: "GENERAL", patType: "PATENT", viewDb: "CNTXT" },
    { anid: "", pnid: "CN1A", source: "GENERAL", patType: "PATENT", viewDb: "CNTXT" },
  ]);
});

test("a listed record without an application number is read by its first publication member", async () => {
  const registry = createRecordRegistry();
  registry.rememberSession("SESSION-1", "CNTXT");
  registry.rememberRecords("SESSION-1", [
    { ssId: "SESSION-1", pnId: "CN1A;CN1B", dbName: "CNTXT", ti: "可调鞋跟" },
  ]);
  const { calls, fetchImpl } = recordingFetch([envelope({ fullTextHtml: FULL_TEXT_HTML })]);
  const text = await executeFullText({
    args: { pnId: "CN1B" },
    authorization: "Bearer t",
    fetchImpl,
    registry,
  });
  assert.equal(text, `CN1A;CN1B  可调鞋跟\n\n${RENDERED_BODY}`);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), { anid: "", pnid: "CN1A", source: "GENERAL", patType: "PATENT", viewDb: "CNTXT" });
});

test("a record the store has not indexed is reported with the provider's reason, not as bad input", async () => {
  const { calls, fetchImpl } = recordingFetch([envelope(null, "该文献未收录于快速全文库"), envelope(null, "该文献未收录于快速全文库")]);
  const result = await executeFullText({
    args: { pnId: "CN1A" },
    authorization: "Bearer t",
    fetchImpl,
    registry: registryWithRecord(),
  });
  assert.deepEqual(result, {
    ok: false,
    error: { code: "FULL_TEXT_UNAVAILABLE", message: "该文献未收录于快速全文库", endpoint: FUSION_FULL_TEXT_ENDPOINT },
  });
  assert.equal(calls.length, 2);
});

test("a data object without fullTextHtml is also unavailable, with a default message", async () => {
  const { fetchImpl } = recordingFetch([envelope({ other: 1 })]);
  const result = await executeFullText({ args: { pnId: "CN1A" }, authorization: "Bearer t", fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FULL_TEXT_UNAVAILABLE");
  assert.match(result.error.message, /no readable full text/u);
});

test("HTML without any claim or description cell is reported as unparsed", async () => {
  const { fetchImpl } = recordingFetch([envelope({ fullTextHtml: "<table><tr><td>nothing recognizable</td></tr></table>" })]);
  const result = await executeFullText({ args: { pnId: "CN1A" }, authorization: "Bearer t", fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "FULL_TEXT_UNPARSED");
});

test("transport and envelope failures map to the plugin's error codes", async () => {
  const cases = [
    [{ status: 401, bodyText: "" }, "REMOTE_AUTH_REJECTED"],
    [{ status: 403, bodyText: "" }, "REMOTE_AUTH_REJECTED"],
    [{ status: 502, bodyText: "" }, "REMOTE_HTTP_ERROR"],
    [{ status: 200, bodyText: "<html>" }, "REMOTE_RESPONSE_INVALID"],
    [{ status: 200, bodyText: JSON.stringify({ status: 500, message: "服务异常" }) }, "REMOTE_API_ERROR"],
    [{ bodyText: "{}" }, "REMOTE_RESPONSE_INVALID"],
  ];
  for (const [response, code] of cases) {
    const { fetchImpl } = recordingFetch([response]);
    const result = await executeFullText({ args: { pnId: "CN1A" }, authorization: "Bearer t", fetchImpl });
    assert.equal(result.ok, false, code);
    assert.equal(result.error.code, code);
    if (code === "REMOTE_API_ERROR") assert.equal(result.error.message, "服务异常");
  }
});

test("a cancelled call is reported as CANCELLED and never parsed", async () => {
  const controller = new AbortController();
  const { fetchImpl } = recordingFetch([envelope({ fullTextHtml: FULL_TEXT_HTML })]);
  controller.abort();
  const result = await executeFullText({ args: { pnId: "CN1A" }, authorization: "Bearer t", fetchImpl, signal: controller.signal });
  assert.equal(result.error.code, "CANCELLED");
});

test("the api requires a fetch implementation and an authorization header", () => {
  assert.throws(() => createFusionFullTextApi({ authorization: "Bearer t" }), TypeError);
  assert.throws(() => createFusionFullTextApi({ fetchImpl: async () => ({}), authorization: "" }), /authorization header/u);
});

test("the safety cap is applied to the rendered text", async () => {
  const cells = Array.from({ length: 40 }, (_, index) => `<td id="description_${index + 1}">${"正文".repeat(30)}</td>`).join("");
  const { fetchImpl } = recordingFetch([envelope({ fullTextHtml: `<td id="claim_1">1.一种装置。</td>${cells}` })]);
  const text = await executeFullText({ args: { pnId: "CN1A" }, authorization: "Bearer t", fetchImpl, maxChars: 800 });
  assert.equal(typeof text, "string");
  assert.match(text, /\[全文超长，已截断于第 \d+ 段\]$/u);
});

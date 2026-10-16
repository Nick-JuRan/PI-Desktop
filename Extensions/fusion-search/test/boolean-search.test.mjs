import assert from "node:assert/strict";
import test from "node:test";

import {
  createFusionBooleanSearchApi,
  executeBooleanSearch,
  FUSION_BOOLEAN_SEARCH_ENDPOINTS,
  FUSION_BOOLEAN_SEARCH_RESULT_LIMIT,
} from "../src/boolean-search.mjs";
import { FUSION_RESULT_PAGE_SIZE } from "../src/semantic-result-page.mjs";
import { createRecordRegistry } from "../src/record-registry.mjs";
import { createResultSnapshotStore } from "../src/result-snapshot.mjs";

const API_ROOT = "/api";
const args = { database: "CNTXT", query: "A01B1/00/IC" };

const DEFAULT_OVERVIEW_ROWS = [{ pnId: "CN1A", ti: "title", simVal: 99, semanticSort: 1 }];

function makeFetch({ totalHits = 17, sessionId = "SESSION-1", onExecute, onOverview, overviewRows = DEFAULT_OVERVIEW_ROWS } = {}) {
  const calls = [];
  const fetchImpl = async (input) => {
    const path = new URL(input.url).pathname;
    const body = JSON.parse(input.body);
    calls.push({ path, body, authorization: input.headers.Authorization });
    if (path.endsWith("/dbAll")) {
      return { status: 200, bodyText: JSON.stringify({ status: 200, t: { allList: [{ dbCode: "CNTXT", dbId: "DB201" }] } }) };
    }
    if (path.endsWith("/valid/boolterm")) {
      return { status: 200, bodyText: JSON.stringify({ status: 200, t: true }) };
    }
    if (path.endsWith("/element/selectElement")) {
      return { status: 200, bodyText: JSON.stringify({ status: 200, t: { id: "SEMANTIC-ELEMENT-1" } }) };
    }
    if (path.endsWith("/action/executeSearch")) {
      await onExecute?.();
      return { status: 200, bodyText: JSON.stringify({ status: 200, t: sessionId }) };
    }
    if (path.endsWith("/new/forOverview")) {
      await onOverview?.();
      return {
        status: 200,
        bodyText: JSON.stringify({ status: 200, t: {
          ssId: sessionId,
          hitCounts: totalHits,
          listCounts: 1,
          semSortCounts: 1,
          fromSource: "boolean-semantic",
          resultList: overviewRows,
        } }),
      };
    }
    return { status: 404, bodyText: JSON.stringify({ status: 404, message: "unexpected endpoint" }) };
  };
  return { calls, fetchImpl };
}

test("Boolean search resolves the displayed code and returns the count with opaque session_id", async () => {
  const { calls, fetchImpl } = makeFetch({ totalHits: 17 });
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl });

  assert.deepEqual(result, { ok: true, database: "CNTXT", total_hits: 17, session_id: "SESSION-1" });
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.authorization === "Bearer TOKEN"));
  assert.equal(calls[0].path, `${API_ROOT}/neusipo-app-search/dbAll`);
  assert.deepEqual(calls[1].body, { dbIds: ["DB201"], boolterm: args.query });
  assert.equal(calls[2].path, `${API_ROOT}/neusipo-app-search/element/selectElement`);
  assert.deepEqual(calls[2].body, {});
  assert.equal(calls[3].path, `${API_ROOT}/neusipo-app-search/fusionSearch/new/action/executeSearch`);
  assert.deepEqual(calls[3].body.dbs, ["DB201"]);
  assert.equal(calls[3].body.semanticParam.boolterm, args.query);
  assert.equal(calls[3].body.semanticParam.eid, "SEMANTIC-ELEMENT-1");
  assert.equal(calls[3].body.semanticParam.top, String(FUSION_BOOLEAN_SEARCH_RESULT_LIMIT));
  assert.equal(calls[4].path, `${API_ROOT}/neusipo-app-search/fusionSearch/new/forOverview`);
  assert.equal(calls[4].body.ssId, "SESSION-1");
  assert.equal(calls[4].body.searchType, "boolean-semantic");
  assert.equal(calls[4].body.size, FUSION_BOOLEAN_SEARCH_RESULT_LIMIT, "the overview asks for the whole retained set");
  assert.equal(calls[4].body.showAbsFlag, "1", "the overview carries abstracts for the snapshot");
  assert.equal(calls[3].body.showAbsFlag, "0", "search creation stays as before");
  assert.equal(calls[4].body.semanticParam.eid, "SEMANTIC-ELEMENT-1");
  assert.equal(calls[4].body.semanticParam.boolterm, args.query);
  assert.equal(result.records, undefined);
  assert.ok(!JSON.stringify(result).includes("DB201"));
});

test("CTTXT is normalized to the provider catalog's canonical CNTXT code", async () => {
  const { fetchImpl } = makeFetch();
  const result = await executeBooleanSearch({
    args: { database: "CTTXT", query: "A01B1/00/IC" },
    authorization: "Bearer TOKEN",
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.database, "CNTXT");
});

test("invalid input is rejected before any network request", async () => {
  const { calls, fetchImpl } = makeFetch();
  for (const invalid of [
    { database: "DB201", query: "A01B1/00/IC" },
    { database: "CNTXT", query: " " },
    { database: "CNTXT", query: "A01B1/00/IC", dbId: "DB201" },
  ]) {
    const result = await executeBooleanSearch({ args: invalid, authorization: "Bearer TOKEN", fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "INVALID_INPUT");
  }
  assert.equal(calls.length, 0);
});

test("missing or ambiguous catalog IDs fail closed before query validation", async () => {
  for (const { catalog, expectedCode } of [
    { catalog: { allList: [{ dbCode: "ENTXT", dbId: "DB297" }] }, expectedCode: "DATABASE_NOT_FOUND" },
    { catalog: { allList: [{ dbCode: "CNTXT", dbId: "DB201" }, { dbCode: "CNTXT", dbId: "DB202" }] }, expectedCode: "DATABASE_CATALOG_AMBIGUOUS" },
  ]) {
    let calls = 0;
    const result = await executeBooleanSearch({
      args,
      authorization: "Bearer TOKEN",
      fetchImpl: async () => {
        calls += 1;
        return { status: 200, bodyText: JSON.stringify({ status: 200, t: catalog }) };
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, expectedCode);
    assert.equal(calls, 1);
  }
});

test("rejected syntax never submits a search", async () => {
  let executeCalls = 0;
  const result = await executeBooleanSearch({
    args,
    authorization: "Bearer TOKEN",
    fetchImpl: async (input) => {
      const path = new URL(input.url).pathname;
      const t = path.endsWith("/dbAll")
        ? { allList: [{ dbCode: "CNTXT", dbId: "DB201" }] }
        : false;
      if (path.endsWith("/action/executeSearch")) executeCalls += 1;
      return { status: 200, bodyText: JSON.stringify({ status: 200, t }) };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "QUERY_VALIDATION_FAILED");
  assert.equal(executeCalls, 0);
});

test("a Boolean search requires an active semantic baseline and refuses an unranked session", async () => {
  const { calls, fetchImpl } = makeFetch({ onExecute: async () => {} });
  const withoutBaseline = await executeBooleanSearch({
    args,
    authorization: "Bearer TOKEN",
    fetchImpl: async (input) => {
      const path = new URL(input.url).pathname;
      if (path.endsWith("/element/selectElement")) {
        calls.push({ path, body: JSON.parse(input.body), authorization: input.headers.Authorization });
        return { status: 200, bodyText: JSON.stringify({ status: 200, t: { id: "" } }) };
      }
      return fetchImpl(input);
    },
  });
  assert.equal(withoutBaseline.ok, false);
  assert.equal(withoutBaseline.error.code, "SEMANTIC_BASELINE_REQUIRED");
  assert.equal(calls.some((call) => call.path.endsWith("/action/executeSearch")), false);
});

test("lost execution response is marked uncertain and is not replayed", async () => {
  const { calls, fetchImpl } = makeFetch({
    onExecute: async () => { throw new Error("socket closed"); },
  });
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REMOTE_OUTCOME_UNKNOWN");
  assert.match(result.error.message, /check search history/i);
  assert.equal(calls.filter((call) => call.path.endsWith("/action/executeSearch")).length, 1);
  assert.equal(calls.some((call) => call.path.endsWith("/new/forOverview")), false);
});

test("an overview transport failure returns the created session for recovery", async () => {
  const { calls, fetchImpl } = makeFetch({
    onOverview: async () => { throw new Error("connection closed"); },
  });
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RESULT_SESSION_READ_FAILED");
  assert.equal(result.error.session_id, "SESSION-1");
  assert.match(result.error.message, /returned session_id instead of rerunning/i);
  assert.equal(calls.filter((call) => call.path.endsWith("/action/executeSearch")).length, 1);
});

test("an overview auth rejection retains the already-created session ID", async () => {
  const { calls, fetchImpl } = makeFetch();
  const result = await executeBooleanSearch({
    args,
    authorization: "Bearer TOKEN",
    fetchImpl: async (input) => {
      if (new URL(input.url).pathname.endsWith("/new/forOverview")) {
        calls.push({ path: new URL(input.url).pathname, body: JSON.parse(input.body) });
        return { status: 401, bodyText: "{}" };
      }
      return fetchImpl(input);
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REMOTE_AUTH_REJECTED");
  assert.equal(result.error.session_id, "SESSION-1");
  assert.equal(calls.filter((call) => call.path.endsWith("/action/executeSearch")).length, 1);
});

test("cancellation after execution submission preserves the unknown outcome", async () => {
  const controller = new AbortController();
  const { calls, fetchImpl } = makeFetch({ onExecute: async () => controller.abort() });
  const api = createFusionBooleanSearchApi({
    fetchImpl,
    authorization: "Bearer TOKEN",
    signal: controller.signal,
  });
  const result = await executeBooleanSearch({ args, api });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REMOTE_OUTCOME_UNKNOWN");
  assert.equal(calls.filter((call) => call.path.endsWith("/action/executeSearch")).length, 1);
  assert.equal(calls.some((call) => call.path.endsWith("/new/forOverview")), false);
});

test("endpoints are pinned to the inspected Fusion Search contract", () => {
  assert.deepEqual(FUSION_BOOLEAN_SEARCH_ENDPOINTS, {
    databases: "/neusipo-app-search/dbAll",
    validate: "/neusipo-app-search/fusionSearch/new/valid/boolterm",
    selectSemanticElement: "/neusipo-app-search/element/selectElement",
    execute: "/neusipo-app-search/fusionSearch/new/action/executeSearch",
    overview: "/neusipo-app-search/fusionSearch/new/forOverview",
  });
});

function overviewRow(pnId, extra = {}) {
  return {
    ssId: "SESSION-1",
    pnId,
    anId: `AN-${pnId}`,
    dbName: "CNTXT",
    ti: `Title ${pnId}`,
    abview: [{ indexCnName: "摘要", value: `<p>Abstract ${pnId}</p>` }],
    clms: [{ indexCnName: "主权利要求说明", value: `Claim ${pnId}` }],
    ...extra,
  };
}

test("a search freezes its overview as the session snapshot and registers the rows for full text", async () => {
  const snapshots = createResultSnapshotStore();
  const registry = createRecordRegistry();
  const { calls, fetchImpl } = makeFetch({
    totalHits: 3,
    overviewRows: [
      overviewRow("CN2A", { simVal: 80, semanticSort: 2 }),
      overviewRow("CN9A", { simVal: undefined, semanticSort: undefined }),
      overviewRow("CN1A", { simVal: 95, semanticSort: 1 }),
    ],
  });
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl, snapshots, registry });
  assert.deepEqual(result, { ok: true, database: "CNTXT", total_hits: 3, session_id: "SESSION-1" });
  assert.equal(calls.length, 5, "no extra request beyond the existing overview");
  const snapshot = snapshots.get("SESSION-1");
  assert.deepEqual(snapshot.records.map((record) => [record.pnId, record.semanticSort]), [["CN1A", 1], ["CN2A", 2], ["CN9A", null]]);
  assert.equal(snapshot.records[0].abview, "Abstract CN1A");
  assert.equal(snapshot.records[0].clms, "Claim CN1A");
  assert.equal(snapshot.unrankedCount, 1);
  assert.deepEqual(registry.resolve("CN2A"), { pnId: "CN2A", anId: "AN-CN2A", database: "CNTXT", sessionId: "SESSION-1", title: "Title CN2A" });
  assert.equal(registry.databaseForSession("SESSION-1"), "CNTXT");
});

test("an overview row from another session is refused and the created session is reported", async () => {
  const snapshots = createResultSnapshotStore();
  const { fetchImpl } = makeFetch({
    overviewRows: [overviewRow("CN1A", { simVal: 1, semanticSort: 1 }), overviewRow("CN2A", { simVal: 1, semanticSort: 2, ssId: "SESSION-OTHER" })],
  });
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl, snapshots });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RESULT_SESSION_MISMATCH");
  assert.equal(result.error.session_id, "SESSION-1");
  assert.equal(snapshots.has("SESSION-1"), false);
});

test("without a snapshot store the search behaves exactly as before", async () => {
  const { fetchImpl } = makeFetch();
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl });
  assert.deepEqual(result, { ok: true, database: "CNTXT", total_hits: 17, session_id: "SESSION-1" });
});

test("session creation and overview run under the search lock, which is released afterwards", async () => {
  const events = [];
  const searchLock = {
    acquire: async () => { events.push("acquire"); return () => events.push("release"); },
  };
  const { fetchImpl } = makeFetch({
    onExecute: async () => events.push("execute"),
    onOverview: async () => events.push("overview"),
  });
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl, searchLock, snapshots: createResultSnapshotStore() });
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["acquire", "execute", "overview", "release"]);
});

test("a busy search lock fails before any search is submitted", async () => {
  const searchLock = {
    acquire: async () => {
      const error = new Error("Another Boolean search is still being frozen for this account. Nothing was sent; retry this exact search shortly.");
      error.code = "SEARCH_BUSY";
      throw error;
    },
  };
  const { calls, fetchImpl } = makeFetch();
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl, searchLock, snapshots: createResultSnapshotStore() });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SEARCH_BUSY");
  assert.equal(result.error.session_id, undefined);
  assert.ok(!calls.some((call) => call.path.endsWith("/action/executeSearch")), "nothing was submitted");
});

test("the lock is released when the search fails after submission", async () => {
  const events = [];
  const searchLock = { acquire: async () => { events.push("acquire"); return () => events.push("release"); } };
  const { fetchImpl } = makeFetch({ onOverview: async () => { throw new Error("socket closed"); } });
  const result = await executeBooleanSearch({ args, authorization: "Bearer TOKEN", fetchImpl, searchLock, snapshots: createResultSnapshotStore() });
  assert.equal(result.ok, false);
  assert.equal(result.error.session_id, "SESSION-1");
  assert.deepEqual(events, ["acquire", "release"]);
});

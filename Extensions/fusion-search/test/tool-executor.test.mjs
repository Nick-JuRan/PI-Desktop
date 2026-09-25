import assert from "node:assert/strict";
import test from "node:test";

import {
  executeFusionTool,
  executeFusionBooleanTool,
  executeFusionResultPageTool,
} from "../src/tool-executor.mjs";

const unauthorized = {
  ok: false,
  error: { code: "REMOTE_AUTH_REJECTED", status: 401, message: "rejected" },
};

function managerForTests() {
  const calls = [];
  return {
    calls,
    authorization: async (options) => {
      calls.push(["authorization", options]);
      return { authorization: "Bearer old-token" };
    },
    refresh: async (options) => {
      calls.push(["refresh", options]);
      return { authorization: "Bearer new-token" };
    },
  };
}

test("a rejected mutation refreshes credentials but is never replayed", async () => {
  for (const action of ["prepare", "update_terms"]) {
    const tokenManager = managerForTests();
    let calls = 0;
    const result = await executeFusionTool({
      args: { action },
      tokenManager,
      fetchImpl: async () => ({}),
      executeSemantic: async () => { calls += 1; return unauthorized; },
    });
    assert.equal(calls, 1, `${action} must not be replayed`);
    assert.equal(tokenManager.calls.filter(([kind]) => kind === "refresh").length, 1);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "REMOTE_AUTH_REJECTED_NOT_RETRIED");
    assert.match(result.error.message, /was not replayed/i);
  }
});

test("non-auth errors are returned without refreshing", async () => {
  const tokenManager = managerForTests();
  const failure = { ok: false, error: { code: "REMOTE_HTTP_ERROR", status: 500 } };
  const result = await executeFusionTool({
    args: { action: "prepare" },
    tokenManager,
    fetchImpl: async () => ({}),
    executeSemantic: async () => failure,
  });
  assert.equal(result, failure);
  assert.equal(tokenManager.calls.length, 1);
});

test("unsupported actions, including removed get_terms, are rejected before token acquisition", async () => {
  for (const action of ["other", "get_terms"]) {
    const tokenManager = managerForTests();
    const result = await executeFusionTool({
      args: { action },
      tokenManager,
      fetchImpl: async () => ({}),
    });
    assert.equal(result.error.code, "INVALID_INPUT");
    assert.equal(tokenManager.calls.length, 0);
  }
});

test("Boolean search shares token acquisition with the semantic tool", async () => {
  const tokenManager = managerForTests();
  const result = await executeFusionBooleanTool({
    args: { database: "CNTXT", query: "A01B1/00/IC" },
    tokenManager,
    fetchImpl: async () => ({}),
    executeBoolean: async ({ authorization }) => ({
      ok: true,
      database: "CNTXT",
      total_hits: 1,
      session_id: "SESSION-1",
      authorization_used: authorization,
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.authorization_used, "Bearer old-token");
  assert.deepEqual(tokenManager.calls.map(([kind]) => kind), ["authorization"]);
});

test("Boolean search auth rejection refreshes but never replays the history-creating request", async () => {
  const tokenManager = managerForTests();
  let calls = 0;
  const result = await executeFusionBooleanTool({
    args: { database: "CNTXT", query: "A01B1/00/IC" },
    tokenManager,
    fetchImpl: async () => ({}),
    executeBoolean: async () => { calls += 1; return unauthorized; },
  });
  assert.equal(calls, 1);
  assert.deepEqual(tokenManager.calls.map(([kind]) => kind), ["authorization", "refresh"]);
  assert.equal(result.error.code, "REMOTE_AUTH_REJECTED_NOT_RETRIED");
  assert.match(result.error.message, /not replayed/i);
});

test("an auth rejection during result loading preserves the created session identifier", async () => {
  const tokenManager = managerForTests();
  const result = await executeFusionBooleanTool({
    args: { database: "CNTXT", query: "A01B1/00/IC" },
    tokenManager,
    executeBoolean: async () => ({
      ok: false,
      error: { code: "REMOTE_AUTH_REJECTED", session_id: "SESSION-1", message: "rejected" },
    }),
  });
  assert.equal(result.error.code, "REMOTE_AUTH_REJECTED_NOT_RETRIED");
  assert.equal(result.error.session_id, "SESSION-1");
  assert.match(result.error.message, /check search history/i);
});

test("Boolean input validation happens before reading credentials", async () => {
  const tokenManager = managerForTests();
  const result = await executeFusionBooleanTool({
    args: { database: "DB201", query: "A01B1/00/IC" },
    tokenManager,
  });
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.equal(tokenManager.calls.length, 0);
});

test("result-page auth rejection refreshes and retries the idempotent read exactly once", async () => {
  const tokenManager = managerForTests();
  const authorizations = [];
  let calls = 0;
  const result = await executeFusionResultPageTool({
    args: { session_id: "SESSION-1", page: 2 },
    tokenManager,
    executeResultPage: async ({ authorization, args }) => {
      calls += 1;
      authorizations.push([authorization, args]);
      return calls === 1 ? unauthorized : { ok: true, page: 2, records: [] };
    },
  });
  assert.deepEqual(result, { ok: true, page: 2, records: [] });
  assert.equal(calls, 2);
  assert.deepEqual(authorizations, [
    ["Bearer old-token", { session_id: "SESSION-1", page: 2 }],
    ["Bearer new-token", { session_id: "SESSION-1", page: 2 }],
  ]);
  assert.deepEqual(tokenManager.calls.map(([kind]) => kind), ["authorization", "refresh"]);
});

test("invalid result-page arguments fail before reading credentials", async () => {
  const tokenManager = managerForTests();
  const result = await executeFusionResultPageTool({
    args: { session_id: "SESSION-1", page: 0 },
    tokenManager,
  });
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.equal(tokenManager.calls.length, 0);
});

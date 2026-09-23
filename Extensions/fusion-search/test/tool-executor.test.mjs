import assert from "node:assert/strict";
import test from "node:test";

import { executeFusionTool } from "../src/tool-executor.mjs";

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

test("a rejected read is refreshed and replayed exactly once", async () => {
  const tokenManager = managerForTests();
  const signal = new AbortController().signal;
  const calls = [];
  const results = [unauthorized, { ok: true, action: "get_terms", terms: [] }];
  const result = await executeFusionTool({
    args: { action: "get_terms", element_id: 23 },
    signal,
    tokenManager,
    fetchImpl: async () => ({}),
    executeSemantic: async (input) => {
      calls.push(input);
      return results.shift();
    },
  });
  assert.deepEqual(result, { ok: true, action: "get_terms", terms: [] });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].authorization, "Bearer old-token");
  assert.equal(calls[1].authorization, "Bearer new-token");
  assert.equal(calls[0].signal, signal);
  assert.deepEqual(tokenManager.calls[1], ["refresh", { signal, rejectedAuthorization: "Bearer old-token" }]);
});

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
    args: { action: "get_terms" },
    tokenManager,
    fetchImpl: async () => ({}),
    executeSemantic: async () => failure,
  });
  assert.equal(result, failure);
  assert.equal(tokenManager.calls.length, 1);
});

test("invalid actions are rejected before token acquisition", async () => {
  const tokenManager = managerForTests();
  const result = await executeFusionTool({
    args: { action: "other" },
    tokenManager,
    fetchImpl: async () => ({}),
  });
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.equal(tokenManager.calls.length, 0);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  readSettings,
  writeSettings,
  readCredentials,
  readStoredToken,
  normalizeAuthorizationHeader,
  persistToken,
} from "../src/settings-store.mjs";
import { createTokenManager, tokenNeedsRefresh } from "../src/token-manager.mjs";

function fakePi({ settings = {}, written = [] } = {}) {
  return {
    plugin: {
      getSettings: async () => settings,
      setSettings: async (partial) => {
        settings = { ...settings, ...partial };
        written.push(partial);
      },
    },
  };
}

test("readCredentials picks up username/password, never echoes password", () => {
  const credentials = readCredentials({ username: " user1 ", password: "pw" });
  assert.deepEqual(credentials, { username: "user1", password: "pw" });
  assert.equal(readCredentials({ username: "x" }), null);
  assert.equal(readCredentials({}), null);
});

test("normalizeAuthorizationHeader adds Bearer once", () => {
  assert.equal(normalizeAuthorizationHeader("tok"), "Bearer tok");
  assert.equal(normalizeAuthorizationHeader("Bearer tok"), "Bearer tok");
  assert.equal(normalizeAuthorizationHeader("bearer tok"), "bearer tok");
});

test("tokenNeedsRefresh refreshes on missing exp and inside the margin", () => {
  const soon = Math.floor(Date.now() / 1000) + 600;
  const later = Math.floor(Date.now() / 1000) + 7200;
  const jwt = (exp) => `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
  assert.equal(tokenNeedsRefresh("not-a-jwt"), true);
  assert.equal(tokenNeedsRefresh(jwt(soon), { marginS: 1800 }), true);
  assert.equal(tokenNeedsRefresh(jwt(later), { marginS: 1800 }), false);
});

test("the token manager returns a stored token with margin without logging in", async () => {
  const later = Math.floor(Date.now() / 1000) + 7200;
  const token = `h.${Buffer.from(JSON.stringify({ exp: later })).toString("base64url")}.s`;
  const pi = fakePi({ settings: { token } });
  let logins = 0;
  const manager = createTokenManager({
    pi,
    login: async () => {
      logins += 1;
      return "fresh";
    },
  });
  const { authorization } = await manager.authorization();
  assert.equal(authorization, `Bearer ${token}`);
  assert.equal(logins, 0);
});

test("the token manager logs in once for a missing token and persists it", async () => {
  const pi = fakePi({ settings: { username: "u", password: "p" } });
  let logins = 0;
  const manager = createTokenManager({
    pi,
    login: async () => {
      logins += 1;
      return "fresh-token";
    },
  });
  const { authorization } = await manager.authorization();
  assert.equal(authorization, "Bearer fresh-token");
  assert.equal(logins, 1);
  // The default persist path writes through pi.setSettings.
  const settings = await readSettings(pi);
  assert.equal(settings.token, "fresh-token");
});

test("the token manager single-flights concurrent refreshes", async () => {
  const pi = fakePi({ settings: { username: "u", password: "p" } });
  let logins = 0;
  let inFlight = 0;
  const manager = createTokenManager({
    pi,
    login: async () => {
      inFlight += 1;
      logins += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return `token-${logins}`;
    },
    persist: async () => {},
  });
  const [a, b, c] = await Promise.all([
    manager.authorization(),
    manager.authorization(),
    manager.authorization(),
  ]);
  assert.equal(logins, 1);
  // All three callers share the one in-flight login's token.
  assert.deepEqual(
    [a.authorization, b.authorization, c.authorization],
    ["Bearer token-1", "Bearer token-1", "Bearer token-1"],
  );
});

test("a missing credential reports AUTH_CONFIG_MISSING", async () => {
  const pi = fakePi({ settings: {} });
  const manager = createTokenManager({ pi, login: async () => "t" });
  await assert.rejects(
    () => manager.authorization(),
    (error) => error.code === "AUTH_CONFIG_MISSING",
  );
});


function makeJwt(expOffsetSeconds) {
  const exp = Math.floor(Date.now() / 1000) + expOffsetSeconds;
  return `h.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.s`;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("a late 401 reuses a newer token already stored by another request", async () => {
  const currentToken = makeJwt(7200);
  const pi = fakePi({ settings: { username: "u", password: "p", token: currentToken } });
  let logins = 0;
  const manager = createTokenManager({
    pi,
    login: async () => { logins += 1; return "unnecessary-login"; },
  });
  const result = await manager.refresh({ rejectedAuthorization: "Bearer old-token" });
  assert.equal(result.authorization, `Bearer ${currentToken}`);
  assert.equal(logins, 0, "a delayed stale 401 must not start another slider login");
});

test("aborting the only token caller aborts the shared login and does not persist its token", async () => {
  const started = deferred();
  const release = deferred();
  let loginSignal;
  const pi = fakePi({ settings: { username: "u", password: "p" } });
  const manager = createTokenManager({
    pi,
    login: async ({ signal }) => {
      loginSignal = signal;
      started.resolve();
      await release.promise;
      return "should-not-persist";
    },
  });
  const controller = new AbortController();
  const pending = manager.authorization({ signal: controller.signal });
  await started.promise;
  controller.abort();
  release.resolve();
  await assert.rejects(pending, (error) => error.code === "CANCELLED");
  assert.equal(loginSignal?.aborted, true);
  assert.equal((await readSettings(pi)).token, undefined);
});

test("one cancelled waiter does not cancel a shared login needed by another", async () => {
  const started = deferred();
  const release = deferred();
  const pi = fakePi({ settings: { username: "u", password: "p" } });
  let loginSignal;
  let logins = 0;
  const manager = createTokenManager({
    pi,
    login: async ({ signal }) => {
      loginSignal = signal;
      logins += 1;
      started.resolve();
      await release.promise;
      return "shared-token";
    },
  });
  const firstController = new AbortController();
  const first = manager.authorization({ signal: firstController.signal });
  await started.promise;
  const second = manager.authorization();
  await new Promise((resolve) => setImmediate(resolve));
  firstController.abort();
  const sharedSignalAborted = loginSignal?.aborted;
  release.resolve();
  await assert.rejects(first, (error) => error.code === "CANCELLED");
  assert.equal((await second).authorization, "Bearer shared-token");
  assert.equal(sharedSignalAborted, false, "the remaining waiter keeps the shared login alive");
  assert.equal(logins, 1);
});

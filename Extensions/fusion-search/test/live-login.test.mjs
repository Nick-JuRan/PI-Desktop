import assert from "node:assert/strict";
import test from "node:test";

/**
 * Real-chain integration test against the intranet auth service.
 *
 * Requires: network reachability of 10.160.47.100 / 10.160.28.16 (the CTF
 * lab intranet), and real credentials via environment variables:
 *   FUSION_TEST_USERNAME, FUSION_TEST_PASSWORD
 * Skips when either is missing, so the default `npm test` run stays offline.
 */

import { loginForToken } from "../src/auth/login-chain.mjs";
import { jwtExpiry } from "../src/auth/crypto.mjs";

const username = process.env.FUSION_TEST_USERNAME;
const password = process.env.FUSION_TEST_PASSWORD;

test("loginForToken acquires a real token end to end", { skip: !(username && password) }, async () => {
  const startedAt = Date.now();
  const token = await loginForToken({ credentials: { username, password } });
  assert.equal(typeof token, "string");
  assert.ok(token.length > 20, "token looks like a JWT");

  const exp = jwtExpiry(token);
  assert.ok(exp !== null, "token carries an exp claim");
  assert.ok(exp * 1000 > startedAt, "token is not already expired");
  // The lab's tokens live 12h; accept anything between 1h and 24h of margin.
  const remainingS = exp - Date.now() / 1000;
  assert.ok(remainingS > 3600 && remainingS < 86400, `token lifetime plausible (${remainingS}s)`);

  // A second login must also succeed — the chain is repeatable.
  const token2 = await loginForToken({ credentials: { username, password } });
  assert.ok(jwtExpiry(token2) !== null);
  // No credential ever appears in the token payload view.
  assert.ok(!JSON.stringify({ token, token2 }).includes(password));
});

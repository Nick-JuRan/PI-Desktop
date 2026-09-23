import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { PassThrough } from "node:stream";
import { Buffer } from "node:buffer";

import { authFetch, CookieJar, AuthHttpError, AUTH_ALLOWED_ORIGINS, assertAllowedUrl, headerValues, readBody } from "../src/auth/http-client.mjs";
import { loginForToken } from "../src/auth/login-chain.mjs";
import { aesEcbDecrypt, aesCbcDecryptBase64, b64decode } from "../src/auth/crypto.mjs";

const localOrigins = (...ports) => new Set(ports.map((port) => `http://127.0.0.1:${port}`));

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

test("CookieJar scopes cookies by host and path while keeping same-name values separate", () => {
  const jar = new CookieJar();
  const authLogin = new URL("http://10.160.47.100:19090/oauth/login");
  const authHome = new URL("http://10.160.47.100:19090/am/");
  const search = new URL("http://10.160.28.16/api/retrieval");
  jar.storeFromResponse({
    "set-cookie": [
      "sid=auth; Path=/oauth",
      "k=0123456789abcdef; Path=/",
    ],
  }, authLogin);
  jar.storeFromResponse({ "set-cookie": ["sid=search; Path=/api"] }, search);
  assert.equal(jar.get("sid", authLogin), "auth");
  assert.equal(jar.get("sid", search), "search", "same-name cookies remain isolated by host");
  assert.equal(jar.header(authLogin), "sid=auth; k=0123456789abcdef");
  assert.equal(jar.header(authHome), "k=0123456789abcdef", "path-scoped cookies are omitted outside their path");
  assert.equal(jar.header(search), "sid=search", "auth cookies are never sent to the search host");
});

test("auth origin allowlist includes exact scheme, host, and port", () => {
  const local = new Set(["http://127.0.0.1:32100"]);
  assert.doesNotThrow(() => assertAllowedUrl(new URL("http://127.0.0.1:32100/am/"), local));
  assert.throws(
    () => assertAllowedUrl(new URL("http://127.0.0.1:32101/am/"), local),
    (error) => error.code === "HOST_NOT_ALLOWED",
  );
  assert.ok(Object.isFrozen(AUTH_ALLOWED_ORIGINS));
  assert.ok(!AUTH_ALLOWED_ORIGINS.includes("http://10.160.47.100:9999"));
});

test("headerValues returns repeated headers in order", () => {
  assert.deepEqual(headerValues({ "Set-Cookie": ["a=1", "b=2"], "x-y": "z" }, "set-cookie"), ["a=1", "b=2"]);
});

test("authFetch refuses a host outside the allowlist", async () => {
  await assert.rejects(
    authFetch("http://10.160.99.99/am/", { allowedOrigins: new Set() }),
    (error) => error.code === "HOST_NOT_ALLOWED",
  );
  await assert.rejects(
    authFetch("https://127.0.0.1/am/", { allowedOrigins: new Set() }),
    (error) => error.code === "HOST_NOT_ALLOWED",
  );
});

test("authFetch refuses a redirect hop outside the allowlist", async () => {
  const evil = await listen((_req, res) => res.end("collected"));
  test.after(() => evil.server.close());
  const hop = await listen((_req, res) => {
    res.writeHead(302, { location: `http://10.160.99.99:${evil.port}/c` }).end();
  });
  test.after(() => hop.server.close());

  await assert.rejects(
    authFetch(`http://127.0.0.1:${hop.port}/start`, { allowedOrigins: localOrigins(hop.port) }),
    (error) => error.code === "HOST_NOT_ALLOWED",
  );
});

test("authFetch reports the final URL after the redirect chain", async () => {
  const final = await listen((req, res) => {
    res.writeHead(200).end(`landed ${req.url}`);
  });
  test.after(() => final.server.close());
  const hop = await listen((_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${final.port}/uniLogin?code=abc123` }).end();
  });
  test.after(() => hop.server.close());

  const response = await authFetch(`http://127.0.0.1:${hop.port}/oauth`, { allowedOrigins: localOrigins(hop.port, final.port) });
  assert.equal(response.status, 200);
  assert.equal(response.url, `http://127.0.0.1:${final.port}/uniLogin?code=abc123`);
  assert.match(response.bodyText, /code=abc123/);
});

test("authFetch aborts an in-flight request", async () => {
  let startedResolve;
  let finishBody = () => {};
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const serverState = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    finishBody = () => res.end("complete");
    startedResolve();
  });
  test.after(() => serverState.server.close());

  const controller = new AbortController();
  const pending = authFetch(`http://127.0.0.1:${serverState.port}/slow`, {
    allowedOrigins: localOrigins(serverState.port),
    signal: controller.signal,
  });
  await started;
  controller.abort();
  finishBody();
  await assert.rejects(pending, (error) => error.code === "CANCELLED");
});

test("readBody aborts while consuming a response stream", async () => {
  const stream = new PassThrough();
  const controller = new AbortController();
  const pending = readBody(stream, 1024, controller.signal);
  stream.write("partial");
  controller.abort();
  stream.end("complete");
  await assert.rejects(pending, (error) => error.code === "CANCELLED");
});

test("loginForToken walks the full chain and returns the exchanged token", async () => {
  const key = "0123456789abcdef";
  const iv = "fedcba9876543210";
  const secret = "abcdef0123456789";
  let judgeCalls = 0;
  let loginPayload = null;
  let authorizeCode = null;

  const auth = await listen((req, res) => {
    if (req.url.startsWith("/am/")) {
      res.setHeader("set-cookie", [`k=${key}; Path=/am`, `i=${iv}; Path=/am`]);
      res.writeHead(200).end("<html></html>");
      return;
    }
    if (req.url.startsWith("/isLogin")) {
      res.writeHead(200).end("{}");
      return;
    }
    if (req.url.startsWith("/validate/behavior/") && req.method === "GET") {
      res.writeHead(200).end(JSON.stringify({
        code: 0,
        result: { originalImageBase64: "x", jigsawImageBase64: "y", secretKey: secret },
      }));
      return;
    }
    if (req.url === "/validate/behavior/judge") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        judgeCalls += 1;
        const { point } = JSON.parse(body);
        const plain = JSON.parse(aesEcbDecrypt(b64decode(point), secret).toString("utf8"));
        assert.equal(typeof plain.x, "number");
        res.writeHead(200).end(JSON.stringify({ code: 0 }));
      });
      return;
    }
    if (req.url === "/oauth/login") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        loginPayload = body;
        res.writeHead(200).end(JSON.stringify({ code: 0, result: "" }));
      });
      return;
    }
    res.writeHead(404).end("{}");
  });
  test.after(() => auth.server.close());

  // Fake search server: searchlogin discovery + authorize chain + exchange.
  const search = await listen((req, res) => {
    if (req.url === "/api/gateway/newauth/searchlogin") {
      res.writeHead(200).end(JSON.stringify({
        data: { url: `http://127.0.0.1:${searchAuthPort}/oauth/authorize` },
      }));
      return;
    }
    if (req.url === "/api/gateway/newauth/aoeeas") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const { code } = JSON.parse(body);
        assert.equal(code, authorizeCode);
        res.writeHead(200).end(JSON.stringify({ data: " exchanged.jwt.token " }));
      });
      return;
    }
    res.writeHead(404).end("{}");
  });
  test.after(() => search.server.close());

  // The authorize hop server: redirect to the search host's uniLogin?code=.
  let searchAuthPort = 0;
  const authorize = await listen((req, res) => {
    authorizeCode = "test-code-42";
    res.writeHead(302, { location: `http://127.0.0.1:${search.port}/uniLogin?code=test-code-42` }).end();
  });
  searchAuthPort = authorize.port;
  test.after(() => authorize.server.close());

  const token = await loginForToken({
    credentials: { username: "user1", password: "pw1" },
    allowedOrigins: localOrigins(auth.port, authorize.port, search.port),
    servers: {
      authServer: `http://127.0.0.1:${auth.port}`,
      authorizeServer: `http://127.0.0.1:${authorize.port}`,
      searchServer: `http://127.0.0.1:${search.port}`,
    },
    // The synthetic challenge images are placeholders; stub the locator.
    locateNotch: () => ({ x: 10, y: 5, score: 1 }),
  });
  assert.equal(token, " exchanged.jwt.token ");
  assert.equal(judgeCalls, 1);
  assert.ok(loginPayload.includes("loginText"), "login posts the encrypted field");
  // The login text decrypts with the cookies' key/iv back to the fields.
  const match = /name="loginText"\r\n\r\n([^\r]+)\r/.exec(loginPayload);
  const fields = aesCbcDecryptBase64(match[1], key, iv);
  assert.match(fields, /^username=/);
  assert.match(fields, /deviceId=/);
  assert.match(fields, /loginMethod=CODE/);
});

test("loginForToken retries a rejected slider and then succeeds", async () => {
  const secret = "abcdef0123456789";
  let judgeCalls = 0;
  const auth = await listen((req, res) => {
    if (req.url.startsWith("/am/")) {
      res.setHeader("set-cookie", ["k=0123456789abcdef; Path=/am", "i=fedcba9876543210; Path=/am"]);
      res.writeHead(200).end("<html></html>");
      return;
    }
    if (req.url.startsWith("/isLogin")) {
      res.writeHead(200).end("{}");
      return;
    }
    if (req.url.startsWith("/validate/behavior/") && req.method === "GET") {
      res.writeHead(200).end(JSON.stringify({
        code: 0,
        result: { originalImageBase64: "x", jigsawImageBase64: "y", secretKey: secret },
      }));
      return;
    }
    if (req.url === "/validate/behavior/judge") {
      judgeCalls += 1;
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        // First two attempts rejected, third accepted.
        res.writeHead(200).end(JSON.stringify(judgeCalls >= 3 ? { code: 0 } : { code: 1, message: "bad" }));
      });
      return;
    }
    if (req.url === "/oauth/login") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => res.writeHead(200).end(JSON.stringify({ code: 0, result: "" })));
      return;
    }
    res.writeHead(404).end("{}");
  });
  test.after(() => auth.server.close());

  const search = await listen((req, res) => {
    if (req.url === "/api/gateway/newauth/searchlogin") {
      res.writeHead(200).end(JSON.stringify({ data: { url: "" } }));
      return;
    }
    if (req.url.startsWith("/uniLogin")) {
      // The authorize chain lands here with ?code=..., answering 200.
      res.writeHead(200).end("<html>uniLogin</html>");
      return;
    }
    if (req.url === "/api/gateway/newauth/aoeeas") {
      res.writeHead(200).end(JSON.stringify({ data: "tok" }));
      return;
    }
    res.writeHead(404).end("{}");
  });
  test.after(() => search.server.close());

  // The fallback authorize URL points at 10.160.47.100:6100 — outside
  // LOCAL_HOST and unreachable — so the test overrides the authorize URL with
  // a local hop that redirects to the search host's uniLogin?code=...
  const authorize = await listen((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${search.port}/uniLogin?code=stub-code` }).end();
  });
  test.after(() => authorize.server.close());

  const token = await loginForToken({
    credentials: { username: "user1", password: "pw1" },
    allowedOrigins: localOrigins(auth.port, authorize.port, search.port),
    servers: {
      authServer: `http://127.0.0.1:${auth.port}`,
      authorizeServer: `http://127.0.0.1:${authorize.port}`,
      searchServer: `http://127.0.0.1:${search.port}`,
    },
    locateNotch: () => ({ x: 10, y: 5, score: 1 }),
    authorizeUrlOverride: `http://127.0.0.1:${authorize.port}/oauth/authorize`,
  });
  assert.equal(token, "tok");
  assert.equal(judgeCalls, 3);
});

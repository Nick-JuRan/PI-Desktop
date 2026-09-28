import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  IP_LOGIN_URL,
  buildCookieHeader,
  createCookieManager,
  ipLogin,
  parseLoginBody,
  parseSetCookie,
} from "../src/cookie-manager.mjs";

/**
 * A `node:https.request`-shaped stub. `respond(url, options)` returns
 * `{ status, headers, body }`; `headers["set-cookie"]` may be an array.
 */
function fakeRequest(respond, calls = []) {
  return (url, options, onResponse) => {
    const req = new EventEmitter();
    let written = "";
    req.write = (chunk) => {
      written += chunk;
    };
    req.destroy = (error) => req.emit("error", error ?? new Error("destroyed"));
    req.end = () => {
      calls.push({ url: String(url), options, body: written });
      queueMicrotask(() => {
        let reply;
        try {
          reply = respond(String(url), options, written);
        } catch (error) {
          req.emit("error", error);
          return;
        }
        const res = new EventEmitter();
        res.statusCode = reply.status;
        res.headers = reply.headers ?? {};
        onResponse(res);
        res.emit("data", Buffer.from(reply.body ?? "", "utf8"));
        res.emit("end");
        req.emit("close");
      });
    };
    return req;
  };
}

const successBody = (extra = {}) =>
  JSON.stringify({ IsSuccess: true, ShowName: "政府机构IP用户", UserName: "ip-user", ...extra });

test("parseSetCookie / buildCookieHeader keep every cookie, sorted and attribute-free", () => {
  assert.deepEqual(parseSetCookie("Ecp_LoginStuts=abc; path=/; domain=.cnki.net; HttpOnly"), {
    name: "Ecp_LoginStuts",
    value: "abc",
  });
  assert.equal(parseSetCookie("garbage"), null);
  assert.equal(
    buildCookieHeader(["b=2; path=/", "a=1; domain=.cnki.net", "a=3", "=broken"]),
    "a=3; b=2",
  );
});

test("parseLoginBody accepts bare and parenthesised JSON", () => {
  assert.deepEqual(parseLoginBody('({"IsSuccess":true})'), { IsSuccess: true });
  assert.deepEqual(parseLoginBody('{"IsSuccess":false,"ErrorMsg":"x"}'), { IsSuccess: false, ErrorMsg: "x" });
  assert.equal(parseLoginBody("<html>"), null);
});

test("ipLogin posts an empty JSON body to the IP login endpoint and joins all Set-Cookie headers", async () => {
  const calls = [];
  const request = fakeRequest(
    () => ({
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": ["Ecp_ClientId=1; path=/", "Ecp_LoginStuts=xyz; domain=.cnki.net", "c_m_LinID=LinID_1"],
      },
      body: `(${successBody()})`,
    }),
    calls,
  );
  const result = await ipLogin({ request });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, IP_LOGIN_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].body, "{}");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.equal(result.cookie, "Ecp_ClientId=1; Ecp_LoginStuts=xyz; c_m_LinID=LinID_1");
  assert.equal(result.user, "政府机构IP用户");
});

test("ipLogin reports a rejected login with a LOGIN_FAILED code and never returns a cookie", async () => {
  const request = fakeRequest(() => ({
    status: 200,
    headers: { "set-cookie": ["Ecp_IpLoginFail=1"] },
    body: JSON.stringify({ IsSuccess: false, ErrorMsg: "IP not in whitelist" }),
  }));
  await assert.rejects(ipLogin({ request }), (error) => {
    assert.equal(error.code, "LOGIN_FAILED");
    assert.match(error.message, /IP not in whitelist/);
    assert.match(error.message, /plugin settings file/);
    return true;
  });
  const noCookies = fakeRequest(() => ({ status: 200, headers: {}, body: successBody() }));
  await assert.rejects(ipLogin({ request: noCookies }), /set no cookies/);
  const serverError = fakeRequest(() => ({ status: 503, headers: {}, body: "" }));
  await assert.rejects(ipLogin({ request: serverError }), /HTTP 503/);
});

test("the cookie manager prefers the private settings cookie over IP login", async () => {
  let logins = 0;
  const request = fakeRequest(() => {
    logins += 1;
    return { status: 200, headers: { "set-cookie": ["x=1"] }, body: successBody() };
  });
  const manager = createCookieManager({
    readSettings: async () => ({ cookie: " manual=cookie; other=2 " }),
    request,
  });
  assert.equal(await manager.ensure(), "manual=cookie; other=2");
  assert.equal(manager.source, "settings");
  assert.equal(logins, 0);
});

test("the cookie manager logs in once, dedupes concurrent callers, and re-logs in on refresh", async () => {
  let logins = 0;
  const request = fakeRequest(() => {
    logins += 1;
    return { status: 200, headers: { "set-cookie": [`session=${logins}`] }, body: successBody() };
  });
  const logs = [];
  const manager = createCookieManager({ readSettings: async () => ({}), request, log: (m) => logs.push(m) });
  const [a, b] = await Promise.all([manager.ensure(), manager.ensure()]);
  assert.equal(a, "session=1");
  assert.equal(b, "session=1");
  assert.equal(logins, 1, "concurrent ensure() calls share one login");
  assert.equal(await manager.ensure(), "session=1", "a held cookie is reused");
  assert.equal(await manager.refresh(), "session=2");
  assert.equal(manager.source, "ip-login");
  assert.ok(logs.some((line) => /IP login succeeded/.test(line)));
  manager.dispose();
  assert.equal(await manager.ensure(), "session=3", "dispose forgets the cookie");
});

test("warmUp swallows login failures and only logs them", async () => {
  const request = fakeRequest(() => ({ status: 200, headers: {}, body: JSON.stringify({ IsSuccess: false }) }));
  const logs = [];
  const manager = createCookieManager({ readSettings: async () => ({}), request, log: (m) => logs.push(m) });
  manager.warmUp();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(logs.some((line) => /cookie warm-up failed/.test(line)), logs.join("\n"));
});

test("settings read failures fall back to IP login", async () => {
  const request = fakeRequest(() => ({ status: 200, headers: { "set-cookie": ["s=1"] }, body: successBody() }));
  const logs = [];
  const manager = createCookieManager({
    readSettings: async () => {
      throw new Error("no settings host");
    },
    request,
    log: (m) => logs.push(m),
  });
  assert.equal(await manager.ensure(), "s=1");
  assert.ok(logs.some((line) => /settings unavailable/.test(line)));
});

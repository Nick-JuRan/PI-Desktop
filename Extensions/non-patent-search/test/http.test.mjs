import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { cnkiHeaders, cnkiRequest, mergeCookieHeader, rawRequest } from "../src/http.mjs";

const require = createRequire(import.meta.url);
const { createRequestStub } = require("./helpers/fake-cnki.cjs");

test("cnkiHeaders is the Go crawler's header set: form content type, cookie, Chrome UA, kns referer", () => {
  assert.deepEqual(cnkiHeaders("a=1; b=2"), {
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    Cookie: "a=1; b=2",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    Referer: "https://kns.cnki.net/",
    "Accept-Encoding": "gzip",
  });
  assert.equal("Cookie" in cnkiHeaders(""), false);
  assert.equal(cnkiHeaders("", { "Content-Type": "application/json" })["Content-Type"], "application/json");
});

test("cnkiRequest follows redirects inside *.cnki.net, downgrades to GET, and carries chain cookies plus the login cookie", async () => {
  const { request, calls } = createRequestStub((call) => {
    if (call.url === "https://kns.cnki.net/kns8s/brief/grid") {
      return { status: 302, headers: { location: "/kns8s/brief/grid2", "set-cookie": ["SID_kns8=abc; Path=/", "Ecp_notFirstLogin=1; Path=/"] } };
    }
    if (call.url === "https://kns.cnki.net/kns8s/brief/grid2") {
      return { status: 302, headers: { location: "https://kns.cnki.net/kns8s/final" } };
    }
    return { status: 200, headers: {}, body: "done" };
  });
  const response = await cnkiRequest({ url: "https://kns.cnki.net/kns8s/brief/grid", method: "POST", cookie: "Ecp_session=1", body: "a=1" }, { request });
  assert.equal(response.status, 200);
  assert.equal(response.bodyText, "done");
  assert.equal(response.finalUrl, "https://kns.cnki.net/kns8s/final");
  assert.deepEqual(response.hops, ["https://kns.cnki.net/kns8s/brief/grid", "https://kns.cnki.net/kns8s/brief/grid2", "https://kns.cnki.net/kns8s/final"]);
  assert.deepEqual(response.setCookies, ["SID_kns8=abc; Path=/", "Ecp_notFirstLogin=1; Path=/"]);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].body, "a=1");
  assert.equal(calls[0].headers.Cookie, "Ecp_session=1");
  assert.equal(calls[1].method, "GET");
  assert.equal(calls[1].body, "");
  assert.equal(calls[1].headers.Cookie, "Ecp_session=1; SID_kns8=abc; Ecp_notFirstLogin=1");
  assert.equal(calls[2].headers.Cookie, "Ecp_session=1; SID_kns8=abc; Ecp_notFirstLogin=1");
});

test("cnkiRequest refuses a redirect that leaves the allowlist and stops after too many hops", async () => {
  const outside = createRequestStub(() => ({ status: 302, headers: { location: "https://evil.example.com/steal" } }));
  await assert.rejects(cnkiRequest({ url: "https://kns.cnki.net/x", cookie: "c" }, { request: outside.request }), (error) => error.code === "HOST_NOT_ALLOWED");
  assert.equal(outside.calls.length, 1);
  const loop = createRequestStub(() => ({ status: 302, headers: { location: "https://kns.cnki.net/loop" } }));
  await assert.rejects(cnkiRequest({ url: "https://kns.cnki.net/x", cookie: "c" }, { request: loop.request }), (error) => error.code === "HTTP_ERROR" && /too many redirects/.test(error.message));
  assert.equal(loop.calls.length, 7);
});

test("cnkiRequest with followRedirects=false returns the first response and its Location", async () => {
  const { request, calls } = createRequestStub(() => ({ status: 302, headers: { location: "/next" } }));
  const response = await cnkiRequest({ url: "https://kns.cnki.net/x", cookie: "c", followRedirects: false }, { request });
  assert.equal(response.status, 302);
  assert.equal(response.location, "/next");
  assert.equal(response.finalUrl, "https://kns.cnki.net/x");
  assert.equal(calls.length, 1);
});

test("rawRequest decodes gzip bodies and keeps every Set-Cookie line", async () => {
  const { request } = createRequestStub(() => ({
    status: 200,
    headers: { "content-encoding": "gzip", "set-cookie": ["a=1; Path=/", "b=2; Path=/"] },
    body: gzipSync(Buffer.from("压缩的正文", "utf8")),
  }));
  const response = await rawRequest({ url: "https://login.cnki.net/x", headers: {} }, { request });
  assert.equal(response.bodyText, "压缩的正文");
  assert.deepEqual(response.setCookies, ["a=1; Path=/", "b=2; Path=/"]);
});

test("rawRequest wraps transport failures as HTTP_ERROR and refuses foreign hosts before connecting", async () => {
  const failing = createRequestStub(() => {
    throw new Error("ECONNRESET");
  });
  await assert.rejects(rawRequest({ url: "https://kns.cnki.net/x", headers: {} }, { request: failing.request }), (error) => error.code === "HTTP_ERROR" && /ECONNRESET/.test(error.message));
  await assert.rejects(rawRequest({ url: "https://example.com/x", headers: {} }, { request: failing.request }), (error) => error.code === "HOST_NOT_ALLOWED");
  assert.equal(failing.calls.length, 1);
});

test("mergeCookieHeader lets later Set-Cookie values override earlier pairs", () => {
  assert.equal(mergeCookieHeader("a=1; b=2", ["b=3; Path=/; HttpOnly", "c=4"]), "a=1; b=3; c=4");
  assert.equal(mergeCookieHeader("", []), "");
  assert.equal(mergeCookieHeader("a=1", undefined), "a=1");
});

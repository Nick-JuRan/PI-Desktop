/**
 * A fake CNKI at the `node:https.request` boundary.
 *
 * `createRequestStub(handler)` returns a drop-in for `https.request` that
 * answers from `handler({ url, method, headers, body })` with
 * `{ status, headers, body }` and records every call; unit tests inject it as
 * the `request` service. `install(handler)` patches `https.request` itself so
 * the plugin entry (main.cjs) and the forked plugin host process talk to the
 * fake without any production seam; `uninstall()` restores the original.
 *
 * `fixtureHandler(dir)` answers the standard routes (search grid, abstract
 * page, reader JSON) from the fixtures directory.
 */
const { EventEmitter } = require("node:events");
const { readFileSync, appendFileSync } = require("node:fs");
const https = require("node:https");
const { join } = require("node:path");

function createRequestStub(handler) {
  const calls = [];
  const request = (url, options, onResponse) => {
    const req = new EventEmitter();
    let body = "";
    req.write = (chunk) => {
      body += String(chunk);
    };
    req.destroy = (error) => req.emit("error", error ?? new Error("destroyed"));
    req.end = () => {
      const call = { url: String(url), method: options?.method ?? "GET", headers: options?.headers ?? {}, body };
      calls.push(call);
      queueMicrotask(() => {
        let reply;
        try {
          reply = handler(call, calls.length);
        } catch (error) {
          req.emit("error", error);
          return;
        }
        const res = new EventEmitter();
        res.statusCode = reply.status ?? 200;
        res.headers = reply.headers ?? {};
        onResponse(res);
        res.emit("data", Buffer.from(reply.body ?? "", "utf8"));
        res.emit("end");
        req.emit("close");
      });
    };
    return req;
  };
  return { request, calls };
}

function fixtureHandler(fixturesDir, { logPath } = {}) {
  const fixture = (name) => readFileSync(join(fixturesDir, name), "utf8");
  return (call) => {
    if (logPath) appendFileSync(logPath, `${JSON.stringify(call)}\n`);
    const { url } = call;
    if (url.startsWith("https://kns.cnki.net/kns8s/brief/grid")) return { status: 200, body: fixture("search-page.html") };
    if (url.startsWith("https://kns.cnki.net/kcms2/article/abstract")) return { status: 200, body: fixture("abstract-page.html") };
    if (url.startsWith("https://kns.cnki.net/nzkhtml/knsread/litNotes/getPaperInfo")) return { status: 200, body: fixture("reader-response.json") };
    return { status: 404, body: "not found" };
  };
}

const originalRequest = https.request;

function install(handler) {
  const stub = createRequestStub(handler);
  https.request = stub.request;
  return stub;
}

function uninstall() {
  https.request = originalRequest;
}

module.exports = { createRequestStub, fixtureHandler, install, uninstall };

// `node --require test/helpers/fake-cnki.cjs` (the forked plugin host in the
// runtime harness): install the fixture fake for the whole process.
if (process.env.FAKE_CNKI_FIXTURES) {
  install(fixtureHandler(process.env.FAKE_CNKI_FIXTURES, { logPath: process.env.FAKE_CNKI_LOG }));
}

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import test from "node:test";

import { executeGetPaperMainBody, executeScanPaper } from "../src/tools.mjs";
import { READER_ENDPOINT, resolveReaderParams } from "../src/paper.mjs";
import { createThrottle } from "../src/throttle.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const noWait = () => createThrottle({ minGapMs: 0, jitterMs: 0 });

/** Cookie manager stub with a scripted cookie sequence. */
function cookieStub(cookies = ["c1"]) {
  let index = 0;
  const calls = { ensure: 0, refresh: 0 };
  return {
    calls,
    ensure: async () => {
      calls.ensure += 1;
      return cookies[Math.min(index, cookies.length - 1)];
    },
    refresh: async () => {
      calls.refresh += 1;
      index = Math.min(index + 1, cookies.length - 1);
      return cookies[index];
    },
  };
}

/** `pi.net.fetch` stub routed by URL. */
function fetchStub(routes) {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(input);
    for (const [test, reply] of routes) {
      if (typeof test === "function" ? test(input) : input.url.startsWith(test)) {
        return typeof reply === "function" ? reply(input, calls) : reply;
      }
    }
    throw new Error(`unexpected fetch ${input.url}`);
  };
  return { fetchImpl, calls };
}

/** `node:https.request` stub for redirect resolution. */
function requestStub(respond) {
  const calls = [];
  const request = (url, options, onResponse) => {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = (error) => req.emit("error", error ?? new Error("destroyed"));
    req.end = () => {
      calls.push(String(url));
      queueMicrotask(() => {
        const reply = respond(String(url));
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
  return { request, calls };
}

const html = (body) => ({ status: 200, headers: {}, bodyText: body });
const ABSTRACT_1 = "https://kns.cnki.net/kcms2/article/abstract?v=ABC123&uniplatform=NZKPT";
const ABSTRACT_2 = "https://kns.cnki.net/kcms2/article/abstract?v=DEF456";

test("CNKI_ScanPaper returns Title, Href, Abstract and HTML_READING_URL per hit and nothing else", async () => {
  const { fetchImpl, calls } = fetchStub([
    ["https://kns.cnki.net/kns8s/brief/grid", html(fixture("search-page.html"))],
    [ABSTRACT_1, html(fixture("abstract-page.html"))],
    [ABSTRACT_2, html("<html><body><input type=hidden id=abstract_text value='第二篇摘要'><li class='btn-html'><a href='/kcms2/article/htmlreading?v=READ456'>HTML阅读</a></li></body></html>")],
  ]);
  const cookies = cookieStub(["session=1"]);
  const result = await executeScanPaper({ args: { value: "格罗皮乌斯", pageSize: 2 }, cookies, fetchImpl, throttle: noWait() });
  assert.equal(result.ok, true);
  assert.equal(result.query, "格罗皮乌斯");
  assert.equal(result.returned, 2);
  assert.equal(result.totalHits, 1234);
  assert.deepEqual(Object.keys(result.papers[0]), ["Title", "Href", "Abstract", "HTML_READING_URL"]);
  assert.deepEqual(result.papers[0], {
    Title: "基于格罗皮乌斯的现代建筑教育研究",
    Href: ABSTRACT_1,
    Abstract: "本文以格罗皮乌斯的教育思想为线索，\n分析包豪斯 & 现代建筑教育之间的关系。…结论：理念仍具当代价值。",
    HTML_READING_URL: "https://kns.cnki.net/kcms2/article/htmlreading?v=READ123&uniplatform=NZKPT",
  });
  assert.deepEqual(result.papers[1], {
    Title: "包豪斯设计理念的当代价值 & 反思",
    Href: ABSTRACT_2,
    Abstract: "第二篇摘要",
    HTML_READING_URL: "https://kns.cnki.net/kcms2/article/htmlreading?v=READ456",
  });
  assert.equal(result.warnings, undefined);
  assert.equal(calls.length, 3, "one search page + one abstract page per hit");
  assert.ok(calls.every((call) => call.headers.Cookie === "session=1"), "every request carries the session cookie");
  assert.equal(JSON.stringify(result).includes("withFactors"), false);
  assert.equal(JSON.stringify(result).includes("Authors"), false);
});

test("CNKI_ScanPaper re-logs in once when CNKI answers with the login page", async () => {
  let searches = 0;
  const { fetchImpl } = fetchStub([
    [
      "https://kns.cnki.net/kns8s/brief/grid",
      () => {
        searches += 1;
        return html(searches === 1 ? fixture("login-page.html") : fixture("search-page.html"));
      },
    ],
    [ABSTRACT_1, html(fixture("abstract-page.html"))],
    [ABSTRACT_2, html("<html></html>")],
  ]);
  const cookies = cookieStub(["stale", "fresh"]);
  const result = await executeScanPaper({ args: { value: "x", pageSize: 2 }, cookies, fetchImpl, throttle: noWait() });
  assert.equal(searches, 2);
  assert.equal(cookies.calls.refresh, 1);
  assert.equal(result.returned, 2);
});

test("CNKI_ScanPaper keeps a hit whose abstract page fails and reports it in warnings", async () => {
  const { fetchImpl } = fetchStub([
    ["https://kns.cnki.net/kns8s/brief/grid", html(fixture("search-page.html"))],
    [ABSTRACT_1, { status: 500, headers: {}, bodyText: "boom" }],
    [ABSTRACT_2, html("<html><body><input id=abstract_text value=ok></body></html>")],
  ]);
  const result = await executeScanPaper({ args: { value: "x", pageSize: 2 }, cookies: cookieStub(), fetchImpl, throttle: noWait() });
  assert.equal(result.returned, 2);
  assert.equal(result.papers[0].Abstract, "");
  assert.equal(result.papers[0].HTML_READING_URL, "");
  assert.equal(result.papers[1].Abstract, "ok");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /基于格罗皮乌斯的现代建筑教育研究: abstract page unavailable \(abstract page returned HTTP 500\)/);
});

test("CNKI_ScanPaper validates its arguments and refuses withFactors-era extras via the schema owner", async () => {
  const { fetchImpl, calls } = fetchStub([]);
  const cookies = cookieStub();
  await assert.rejects(executeScanPaper({ args: {}, cookies, fetchImpl, throttle: noWait() }), (e) => e.code === "INVALID_ARGUMENT");
  await assert.rejects(executeScanPaper({ args: { value: "x", pageSize: 0 }, cookies, fetchImpl, throttle: noWait() }), (e) => e.code === "INVALID_ARGUMENT");
  await assert.rejects(executeScanPaper({ args: { value: "x", pageSize: 51 }, cookies, fetchImpl, throttle: noWait() }), (e) => e.code === "INVALID_ARGUMENT");
  await assert.rejects(executeScanPaper({ args: { value: "x", pageNum: 1.5 }, cookies, fetchImpl, throttle: noWait() }), (e) => e.code === "INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
});

test("resolveReaderParams follows redirects by hand until the reader URL carries all four parameters", async () => {
  const { request, calls } = requestStub((url) => {
    if (url.startsWith("https://kns.cnki.net/kcms2/article/htmlreading")) {
      return { status: 302, headers: { location: "https://kns.cnki.net/nzkhtml/knsread/login-check?token=1" } };
    }
    if (url.includes("/nzkhtml/knsread/login-check")) {
      return { status: 302, headers: { location: "/nzkhtml/knsread/index?fileName=F1&tableName=CJFDLAST2024&dbCode=CJFD&invoice=INV%2F1" } };
    }
    return { status: 200, headers: {}, body: "<html>reader</html>" };
  });
  const params = await resolveReaderParams({
    href: "https://kns.cnki.net/kcms2/article/htmlreading?v=READ123",
    cookie: "c",
    request,
    throttle: noWait(),
  });
  assert.deepEqual(params, { fileName: "F1", tableName: "CJFDLAST2024", dbCode: "CJFD", invoice: "INV/1" });
  assert.equal(calls.length, 2, "stops as soon as a Location carries the parameters");
});

test("resolveReaderParams falls back to parameters embedded in a final page and classifies login pages", async () => {
  const embedded = requestStub(() => ({
    status: 200,
    headers: {},
    body: `<html><script>var url="/nzkhtml/knsread/litNotes/getPaperInfo?fileName=F9&amp;tableName=T9&amp;dbCode=D9&amp;invoice=I9";</script></html>`,
  }));
  assert.deepEqual(
    await resolveReaderParams({ href: "https://kns.cnki.net/kcms2/article/htmlreading?v=1", cookie: "c", request: embedded.request, throttle: noWait() }),
    { fileName: "F9", tableName: "T9", dbCode: "D9", invoice: "I9" },
  );
  const login = requestStub(() => ({ status: 200, headers: {}, body: fixture("login-page.html") }));
  await assert.rejects(
    resolveReaderParams({ href: "https://kns.cnki.net/kcms2/article/htmlreading?v=1", cookie: "c", request: login.request, throttle: noWait() }),
    (error) => error.code === "COOKIE_EXPIRED",
  );
  const dead = requestStub(() => ({ status: 200, headers: {}, body: "<html>no reader here</html>" }));
  await assert.rejects(
    resolveReaderParams({ href: "https://kns.cnki.net/kcms2/article/htmlreading?v=1", cookie: "c", request: dead.request, throttle: noWait() }),
    (error) => error.code === "MAIN_BODY_UNAVAILABLE",
  );
  await assert.rejects(
    resolveReaderParams({ href: "https://evil.example.com/x", cookie: "c", request: dead.request, throttle: noWait() }),
    (error) => error.code === "HOST_NOT_ALLOWED",
  );
});

test("CNKI_GetPaperMainBody returns the article as a plain string with real newlines", async () => {
  const { fetchImpl, calls } = fetchStub([[READER_ENDPOINT, html(fixture("reader-response.json"))]]);
  const text = await executeGetPaperMainBody({
    args: { href: "https://kns.cnki.net/nzkhtml/knsread/index?fileName=F1&tableName=T1&dbCode=CJFD&invoice=INV" },
    cookies: cookieStub(["session=9"]),
    fetchImpl,
    throttle: noWait(),
  });
  assert.equal(typeof text, "string");
  assert.match(text, /^基于格罗皮乌斯的现代建筑教育研究\n\n1 引言\n/);
  assert.equal(text.includes("\\n"), false);
  assert.equal(text.includes("<p>"), false);
  assert.equal(calls.length, 1, "parameters in the href skip the redirect resolution");
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, READER_ENDPOINT);
  assert.equal(url.searchParams.get("fileName"), "F1");
  assert.equal(url.searchParams.get("invoice"), "INV");
  assert.equal(calls[0].headers.Cookie, "session=9");
});

test("CNKI_GetPaperMainBody surfaces subscription refusals and empty bodies as MAIN_BODY_UNAVAILABLE", async () => {
  const refused = fetchStub([[READER_ENDPOINT, html(JSON.stringify({ success: false, message: "暂无阅读权限" }))]]);
  await assert.rejects(
    executeGetPaperMainBody({
      args: { href: "https://kns.cnki.net/x?fileName=F&tableName=T&dbCode=D&invoice=I" },
      cookies: cookieStub(),
      fetchImpl: refused.fetchImpl,
      throttle: noWait(),
    }),
    (error) => error.code === "MAIN_BODY_UNAVAILABLE" && /暂无阅读权限/.test(error.message),
  );
  const empty = fetchStub([[READER_ENDPOINT, html(JSON.stringify({ success: true, content: { title: "", catalogInfos: [] } }))]]);
  await assert.rejects(
    executeGetPaperMainBody({
      args: { href: "https://kns.cnki.net/x?fileName=F&tableName=T&dbCode=D&invoice=I" },
      cookies: cookieStub(),
      fetchImpl: empty.fetchImpl,
      throttle: noWait(),
    }),
    (error) => error.code === "MAIN_BODY_UNAVAILABLE",
  );
  await assert.rejects(
    executeGetPaperMainBody({ args: {}, cookies: cookieStub(), fetchImpl: empty.fetchImpl, throttle: noWait() }),
    (error) => error.code === "INVALID_ARGUMENT",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { executeGetPaperMainBody, executeScanPaper } from "../src/tools.mjs";
import { READER_ENDPOINT, resolveReaderParams } from "../src/paper.mjs";
import { createThrottle } from "../src/throttle.mjs";

const require = createRequire(import.meta.url);
const { createRequestStub } = require("./helpers/fake-cnki.cjs");

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

/** Route `https.request` calls by URL prefix (or predicate) to canned replies. */
function routes(table) {
  return createRequestStub((call, n) => {
    for (const [match, reply] of table) {
      if (typeof match === "function" ? match(call) : call.url.startsWith(match)) {
        return typeof reply === "function" ? reply(call, n) : reply;
      }
    }
    throw new Error(`unexpected request ${call.url}`);
  });
}

const html = (body, status = 200) => ({ status, body });
const GRID = "https://kns.cnki.net/kns8s/brief/grid";
const ABSTRACT_1 = "https://kns.cnki.net/kcms2/article/abstract?v=ABC123&uniplatform=NZKPT";
const ABSTRACT_2 = "https://kns.cnki.net/kcms2/article/abstract?v=DEF456";
const VERIFY_URL = "https://kns.cnki.net/kns8s/security/verify?returnUrl=%2Fkcms2%2Farticle%2Fabstract";

test("CNKI_ScanPaper returns Title, Href, Abstract and HTML_READING_URL per hit and nothing else", async () => {
  const { request, calls } = routes([
    [GRID, html(fixture("search-page.html"))],
    [ABSTRACT_1, html(fixture("abstract-page.html"))],
    [ABSTRACT_2, html("<html><body><input type=hidden id=abstract_text value='第二篇摘要'><li class='btn-html'><a href='/kcms2/article/htmlreading?v=READ456'>HTML阅读</a></li></body></html>")],
  ]);
  const cookies = cookieStub(["session=1"]);
  const result = await executeScanPaper({ args: { value: "格罗皮乌斯" }, cookies, request, throttle: noWait() });
  assert.deepEqual(Object.keys(result), ["ok", "pageNum", "totalPage", "totalHits", "papers"]);
  assert.equal(result.ok, true);
  assert.equal(result.pageNum, 1);
  assert.equal(result.totalPage, 62, "ceil(1234 / 20)");
  assert.equal(result.totalHits, 1234);
  assert.equal(result.papers.length, 2);
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
  assert.equal(new URLSearchParams(calls[0].body).get("pageSize"), "20");
  for (const call of calls) {
    assert.equal(call.headers.Cookie, "session=1", "every request carries the login cookie verbatim");
    assert.match(call.headers["User-Agent"], /Chrome\/114/);
    assert.equal(call.headers.Referer, "https://kns.cnki.net/");
    assert.match(call.headers["Content-Type"], /x-www-form-urlencoded/);
  }
  assert.equal(JSON.stringify(result).includes("withFactors"), false);
  assert.equal(JSON.stringify(result).includes("withDetails"), false);
  assert.equal(JSON.stringify(result).includes("Authors"), false);
});

test("CNKI_ScanPaper requests the asked page, and warns when CNKI hands back page 1 again or the page is past the end", async () => {
  const gridFor = (rows) =>
    `<html><body><div id="countPageDiv"><em>45</em></div><table class="result-table-list"><tbody>${rows
      .map(([title, href]) => `<tr><td class="name"><a class="fz14" href="${href}">${title}</a></td></tr>`)
      .join("")}</tbody></table></body></html>`;
  const firstRows = [["一", "/kcms2/article/abstract?v=p1a"], ["二", "/kcms2/article/abstract?v=p1b"]];
  const secondRows = [["三", "/kcms2/article/abstract?v=p2a"]];
  const detail = html("<html><body><input id=abstract_text value=ok></body></html>");
  const { request, calls } = routes([
    [GRID, (call) => html(gridFor(new URLSearchParams(call.body).get("pageNum") === "2" ? secondRows : firstRows))],
    ["https://kns.cnki.net/kcms2/article/abstract", detail],
  ]);
  const cookies = cookieStub();
  const first = await executeScanPaper({ args: { value: "翻页查询", pageNum: 1 }, cookies, request, throttle: noWait() });
  assert.equal(first.totalPage, 3, "ceil(45 / 20)");
  assert.equal(first.warnings, undefined);
  const second = await executeScanPaper({ args: { value: "翻页查询", pageNum: 2 }, cookies, request, throttle: noWait() });
  assert.equal(new URLSearchParams(calls.find((call, i) => i > 0 && call.url === GRID).body).get("pageNum"), "2");
  assert.equal(second.pageNum, 2);
  assert.equal(second.papers.length, 1);
  assert.equal(second.warnings, undefined);
  const third = await executeScanPaper({ args: { value: "翻页查询", pageNum: 3 }, cookies, request, throttle: noWait() });
  assert.equal(third.papers.length, 2, "CNKI answered page 3 with page 1's papers");
  assert.match(third.warnings[0], /page 3 with the same papers as page 1/);

  const past = routes([[GRID, html(gridFor([]))]]);
  const beyond = await executeScanPaper({ args: { value: "翻页查询", pageNum: 4 }, cookies, request: past.request, throttle: noWait() });
  assert.deepEqual(beyond.papers, []);
  assert.match(beyond.warnings[0], /page 4 is past the last page \(3\)/);
});

test("CNKI_ScanPaper reports a page that carries a hit count but no readable list as UNEXPECTED_PAGE with a markup sample", async () => {
  const { request, calls } = routes([[GRID, html('<html><body><div id="countPageDiv"><em>864,896</em></div><div class="grid" data-rows="20"></div></body></html>')]]);
  await assert.rejects(
    executeScanPaper({ args: { value: "人工智能" }, cookies: cookieStub(), request, throttle: noWait() }),
    (error) => error.code === "UNEXPECTED_PAGE" && /reported 864896 hits for page 1 but the result list could not be read/.test(error.message) && /data-rows="20"/.test(error.markup),
  );
  assert.equal(calls.length, 1, "no abstract page is requested for a list that could not be read");
});

test("CNKI_ScanPaper stops reading abstract pages when the time budget is spent and says so", async () => {
  let clock = 0;
  const { request, calls } = routes([
    [GRID, html(fixture("search-page.html"))],
    [
      "https://kns.cnki.net/kcms2/article/abstract",
      () => {
        clock += 90_000;
        return html("<html><body><input id=abstract_text value=ok></body></html>");
      },
    ],
  ]);
  const result = await executeScanPaper({ args: { value: "x" }, cookies: cookieStub(), request, throttle: noWait(), now: () => clock });
  assert.equal(result.ok, true);
  assert.equal(result.papers.length, 2);
  assert.equal(result.papers[0].Abstract, "ok");
  assert.equal(result.papers[1].Abstract, "", "the second abstract page is skipped: 90 s had elapsed, over the 80 s budget");
  assert.equal(calls.length, 2, "search + first abstract only");
  assert.match(result.warnings.at(-1), /stopped reading abstract pages after 1 to stay within the tool time limit/);
});

test("CNKI_ScanPaper re-logs in once when the search is redirected to login.cnki.net", async () => {
  let searches = 0;
  const { request, calls } = routes([
    [
      GRID,
      () => {
        searches += 1;
        return searches === 1
          ? { status: 302, headers: { location: "https://login.cnki.net/TopLogin/api/loginapi/Login?returnUrl=x" } }
          : html(fixture("search-page.html"));
      },
    ],
    ["https://login.cnki.net/", html(fixture("login-page.html"))],
    [ABSTRACT_1, html(fixture("abstract-page.html"))],
    [ABSTRACT_2, html("<html></html>")],
  ]);
  const cookies = cookieStub(["stale", "fresh"]);
  const result = await executeScanPaper({ args: { value: "x" }, cookies, request, throttle: noWait() });
  assert.equal(searches, 2);
  assert.equal(cookies.calls.refresh, 1);
  assert.equal(result.papers.length, 2);
  assert.ok(calls.slice(-3).every((call) => call.headers.Cookie === "fresh"), "the retry and the detail pages use the fresh cookie");
  assert.equal(result.warnings.length, 1, "the empty second abstract page is reported, not treated as a login page");
  assert.match(result.warnings[0], /no abstract or HTML reading link found/);
});

test("CNKI_ScanPaper keeps a hit whose abstract page fails and reports it in warnings", async () => {
  const { request } = routes([
    [GRID, html(fixture("search-page.html"))],
    [ABSTRACT_1, html("boom", 500)],
    [ABSTRACT_2, html("<html><body><input id=abstract_text value=ok></body></html>")],
  ]);
  const result = await executeScanPaper({ args: { value: "x" }, cookies: cookieStub(), request, throttle: noWait() });
  assert.equal(result.papers.length, 2);
  assert.equal(result.papers[0].Abstract, "");
  assert.equal(result.papers[0].HTML_READING_URL, "");
  assert.equal(result.papers[1].Abstract, "ok");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /基于格罗皮乌斯的现代建筑教育研究: abstract page unavailable \(abstract page returned HTTP 500\)/);
});

test("a healthy abstract page that links to login.cnki.net and loads captcha scripts is not misread as a login or verification page", async () => {
  const noisy = fixture("abstract-page.html").replace(
    "<body>",
    `<body><div class="header"><a href="https://login.cnki.net/TopLogin/api/loginapi/Login?returnUrl=x">登录</a> | <a href="https://my.cnki.net/">注册</a></div><script src="https://kns.cnki.net/dist/captcha/verifycode.min.js"></script><script>var loginUrl = "https://login.cnki.net/";</script>`,
  );
  const { request } = routes([
    [GRID, html(fixture("search-page.html"))],
    [ABSTRACT_1, html(noisy)],
    [ABSTRACT_2, html(noisy.replace(/<input[^>]*abstract_text[^>]*>/, "").replace(/<li class="btn-html">[\s\S]*?<\/li>/, ""))],
  ]);
  const cookies = cookieStub(["c"]);
  const result = await executeScanPaper({ args: { value: "x" }, cookies, request, throttle: noWait() });
  assert.equal(result.papers[0].Abstract.startsWith("本文以格罗皮乌斯"), true);
  assert.equal(result.papers[1].Abstract, "");
  assert.equal(cookies.calls.refresh, 0, "no re-login was triggered by the navigation link");
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /包豪斯设计理念的当代价值 & 反思: no abstract or HTML reading link found on the abstract page \(title: /);
});

test("CNKI_ScanPaper stops reading abstract pages at the first human-verification page and still returns the search", async () => {
  const grid = fixture("search-page.html").replace(
    "</tbody>",
    `<tr><td class="name"><a class="fz14" href="/kcms2/article/abstract?v=GHI789">第三篇</a></td></tr></tbody>`,
  );
  const { request, calls } = routes([
    [GRID, html(grid)],
    [ABSTRACT_1, html(fixture("abstract-page.html"))],
    [ABSTRACT_2, { status: 302, headers: { location: VERIFY_URL } }],
    [VERIFY_URL, html(fixture("verify-page.html"))],
  ]);
  const result = await executeScanPaper({ args: { value: "x" }, cookies: cookieStub(), request, throttle: noWait() });
  assert.equal(result.ok, true);
  assert.equal(result.papers.length, 3);
  assert.equal(result.papers[0].Abstract.startsWith("本文以格罗皮乌斯"), true);
  assert.equal(result.papers[1].Abstract, "");
  assert.equal(result.papers[2].Abstract, "");
  assert.equal(calls.length, 4, "the third abstract page is never requested");
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /包豪斯设计理念的当代价值 & 反思: abstract page unavailable \(CNKI asked for human verification/);
  assert.match(result.warnings[1], /human verification after 1 abstract page\(s\).*Wait a few minutes/);
});

test("CNKI_ScanPaper re-logs in at most once per call when abstract pages report a stale session", async () => {
  const loginPage = { status: 302, headers: { location: "https://login.cnki.net/TopLogin/api/loginapi/Login" } };
  const { request, calls } = routes([
    [GRID, html(fixture("search-page.html"))],
    ["https://login.cnki.net/", html(fixture("login-page.html"))],
    [ABSTRACT_1, loginPage],
    [ABSTRACT_2, loginPage],
  ]);
  const cookies = cookieStub(["stale", "fresh"]);
  const result = await executeScanPaper({ args: { value: "x" }, cookies, request, throttle: noWait() });
  assert.equal(result.ok, true);
  assert.equal(cookies.calls.refresh, 1, "one IP login for the whole call");
  const abstractCalls = calls.filter((call) => call.url.startsWith("https://kns.cnki.net/kcms2/article/abstract"));
  assert.equal(abstractCalls.length, 2, "first paper, retry with the fresh cookie, then details stop");
  assert.equal(abstractCalls[1].headers.Cookie, "fresh");
  assert.match(result.warnings.at(-1), /kept answering with its login page after a fresh IP login/);
});

test("CNKI_ScanPaper validates its arguments before any request", async () => {
  const { request, calls } = routes([]);
  const cookies = cookieStub();
  const run = (args) => executeScanPaper({ args, cookies, request, throttle: noWait() });
  await assert.rejects(run({}), (e) => e.code === "INVALID_ARGUMENT");
  await assert.rejects(run({ value: "   " }), (e) => e.code === "INVALID_ARGUMENT");
  await assert.rejects(run({ value: "x", pageNum: 0 }), (e) => e.code === "INVALID_ARGUMENT");
  await assert.rejects(run({ value: "x", pageNum: 1.5 }), (e) => e.code === "INVALID_ARGUMENT");
  await assert.rejects(run({ value: "x", pageNum: "2" }), (e) => e.code === "INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
});

test("resolveReaderParams follows redirects by hand until the reader URL carries all four parameters", async () => {
  const { request, calls } = routes([
    ["https://kns.cnki.net/kcms2/article/htmlreading", { status: 302, headers: { location: "https://kns.cnki.net/nzkhtml/knsread/login-check?token=1" } }],
    [
      "https://kns.cnki.net/nzkhtml/knsread/login-check",
      { status: 302, headers: { location: "/nzkhtml/knsread/index?fileName=F1&tableName=CJFDLAST2024&dbCode=CJFD&invoice=INV%2F1" } },
    ],
    [() => true, html("<html>reader</html>")],
  ]);
  const params = await resolveReaderParams({
    href: "https://kns.cnki.net/kcms2/article/htmlreading?v=READ123",
    cookie: "c",
    request,
    throttle: noWait(),
  });
  assert.deepEqual(params, { fileName: "F1", tableName: "CJFDLAST2024", dbCode: "CJFD", invoice: "INV/1" });
  assert.equal(calls.length, 2, "stops as soon as a Location carries the parameters");
  assert.ok(calls.every((call) => call.headers.Cookie === "c"));
});

test("resolveReaderParams falls back to parameters embedded in a final page and classifies login pages", async () => {
  const embedded = routes([
    [() => true, html(`<html><script>var url="/nzkhtml/knsread/litNotes/getPaperInfo?fileName=F9&amp;tableName=T9&amp;dbCode=D9&amp;invoice=I9";</script></html>`)],
  ]);
  assert.deepEqual(
    await resolveReaderParams({ href: "https://kns.cnki.net/kcms2/article/htmlreading?v=1", cookie: "c", request: embedded.request, throttle: noWait() }),
    { fileName: "F9", tableName: "T9", dbCode: "D9", invoice: "I9" },
  );
  const login = routes([[() => true, html(fixture("login-page.html"))]]);
  await assert.rejects(
    resolveReaderParams({ href: "https://kns.cnki.net/kcms2/article/htmlreading?v=1", cookie: "c", request: login.request, throttle: noWait() }),
    (error) => error.code === "COOKIE_EXPIRED",
  );
  const dead = routes([[() => true, html("<html><title>知网节</title><body>no reader here</body></html>")]]);
  await assert.rejects(
    resolveReaderParams({ href: "https://kns.cnki.net/kcms2/article/htmlreading?v=1", cookie: "c", request: dead.request, throttle: noWait() }),
    (error) => error.code === "MAIN_BODY_UNAVAILABLE" && error.title === "知网节" && error.snippet === "知网节 no reader here",
  );
  await assert.rejects(
    resolveReaderParams({ href: "https://evil.example.com/x", cookie: "c", request: dead.request, throttle: noWait() }),
    (error) => error.code === "HOST_NOT_ALLOWED",
  );
});

test("CNKI_GetPaperMainBody returns the article as a plain string with real newlines", async () => {
  const { request, calls } = routes([[READER_ENDPOINT, html(fixture("reader-response.json"))]]);
  const text = await executeGetPaperMainBody({
    args: { href: "https://kns.cnki.net/nzkhtml/knsread/index?fileName=F1&tableName=T1&dbCode=CJFD&invoice=INV" },
    cookies: cookieStub(["session=9"]),
    request,
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

test("CNKI_GetPaperMainBody surfaces subscription refusals, empty bodies and verification pages", async () => {
  const href = "https://kns.cnki.net/x?fileName=F&tableName=T&dbCode=D&invoice=I";
  const refused = routes([[READER_ENDPOINT, html(JSON.stringify({ success: false, message: "暂无阅读权限" }))]]);
  await assert.rejects(
    executeGetPaperMainBody({ args: { href }, cookies: cookieStub(), request: refused.request, throttle: noWait() }),
    (error) => error.code === "MAIN_BODY_UNAVAILABLE" && /暂无阅读权限/.test(error.message),
  );
  const empty = routes([[READER_ENDPOINT, html(JSON.stringify({ success: true, content: { title: "", catalogInfos: [] } }))]]);
  await assert.rejects(
    executeGetPaperMainBody({ args: { href }, cookies: cookieStub(), request: empty.request, throttle: noWait() }),
    (error) => error.code === "MAIN_BODY_UNAVAILABLE",
  );
  const verify = routes([
    [READER_ENDPOINT, { status: 302, headers: { location: VERIFY_URL } }],
    [VERIFY_URL, html(fixture("verify-page.html"), 200)],
  ]);
  await assert.rejects(
    executeGetPaperMainBody({ args: { href }, cookies: cookieStub(), request: verify.request, throttle: noWait() }),
    (error) => error.code === "BLOCKED" && error.finalUrl === VERIFY_URL && error.title === "安全验证",
  );
  await assert.rejects(
    executeGetPaperMainBody({ args: {}, cookies: cookieStub(), request: empty.request, throttle: noWait() }),
    (error) => error.code === "INVALID_ARGUMENT",
  );
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { PAGE_SIZE, SEARCH_ENDPOINT, buildQueryJson, buildSearchForm, searchPapers, totalPagesFor } from "../src/search.mjs";
import { createThrottle } from "../src/throttle.mjs";

const require = createRequire(import.meta.url);
const { createRequestStub } = require("./helpers/fake-cnki.cjs");

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const noWait = () => createThrottle({ minGapMs: 0, jitterMs: 0 });

/** Build a search-grid page with the given (title, href) rows. */
function gridPage(rows, { total = 100, totalPage = 5, closeTags = true } = {}) {
  const body = rows
    .map(([title, href]) =>
      closeTags
        ? `<tr><td class="name"><a class="fz14" href="${href}">${title}</a></td><td class="author"></td><td class="source"></td></tr>`
        : `<tr><td class="seq">1<td class="name"><a class="fz14" href="${href}">${title}</a><td class="author">A<td class="source">S`,
    )
    .join("");
  return `<html><body><div id="countPageDiv"><em>${total}</em><span class="countPageMark" data-pagenum="${totalPage}">1/${totalPage}</span></div><table class="result-table-list"><tbody>${body}</tbody></table></body></html>`;
}

/** `https.request` stub; `handler(call, n)` returns `{ status, headers, body }`. */
const requestStub = (handler) => createRequestStub(handler);
const page = (body, status = 200) => ({ status, body });

test("the page size is fixed at 20 and totalPage is ceil(totalHits / 20)", () => {
  assert.equal(PAGE_SIZE, 20);
  assert.equal(totalPagesFor(864_896, 300), 43_245);
  assert.equal(totalPagesFor(20, 1), 1);
  assert.equal(totalPagesFor(21, 2), 2);
  assert.equal(totalPagesFor(0, 0), 0);
  assert.equal(totalPagesFor(-1, 7), 7, "CNKI's own page mark when the hit count is unknown");
  assert.equal(totalPagesFor(-1, 0), 0);
});

test("the request body matches the original crawler's form and QueryJson", () => {
  const form = buildSearchForm("格罗皮乌斯", 2, 20);
  assert.equal(form.pageNum, "2");
  assert.equal(form.pageSize, "20");
  assert.equal(form.turnpage, "vLP2bNpghntZLRq9Q5Y7Qg!!");
  assert.equal(form.searchFrom, "资源范围：总库");
  const query = JSON.parse(form.QueryJson);
  assert.deepEqual(query, buildQueryJson("格罗皮乌斯"));
  assert.equal(query.QNode.QGroup[0].Items[0].Field, "SU");
  assert.equal(query.QNode.QGroup[0].Items[0].Value, "格罗皮乌斯");
  assert.equal(query.QNode.QGroup[0].Items[0].Operator, "TOPRANK");
  assert.equal(query.Resource, "CROSSDB");
  assert.equal(query.SearchFrom, 4);
});

test("searchPapers posts one page of 20 with the crawler's exact headers and parses the fixture page", async () => {
  const { request, calls } = requestStub(() => page(fixture("search-page.html")));
  const result = await searchPapers({ value: " 格罗皮乌斯 ", cookie: "s=1", request, throttle: noWait() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SEARCH_ENDPOINT);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(Object.keys(calls[0].headers).sort(), ["Accept-Encoding", "Content-Length", "Content-Type", "Cookie", "Referer", "User-Agent"]);
  assert.equal(calls[0].headers.Cookie, "s=1");
  assert.equal(calls[0].headers.Referer, "https://kns.cnki.net/");
  assert.equal(calls[0].headers["User-Agent"], "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");
  assert.equal(calls[0].headers["Content-Type"], "application/x-www-form-urlencoded; charset=UTF-8");
  const form = new URLSearchParams(calls[0].body);
  assert.equal(form.get("pageSize"), "20");
  assert.equal(form.get("pageNum"), "1");
  assert.match(decodeURIComponent(calls[0].body), /"Value":"格罗皮乌斯"/);
  assert.equal(result.total, 1234);
  assert.equal(result.totalPage, 62);
  assert.deepEqual(
    result.papers.map((paper) => paper.title),
    ["基于格罗皮乌斯的现代建筑教育研究", "包豪斯设计理念的当代价值 & 反思"],
    "the duplicate href is dropped",
  );
});

test("searchPapers requests the page it is asked for and reads rows whose end tags are omitted", async () => {
  const { request, calls } = requestStub((call) => {
    const pageNum = Number(new URLSearchParams(call.body).get("pageNum"));
    const rows = Array.from({ length: 20 }, (_, i) => [`P${pageNum}-${i}`, `/kcms2/article/abstract?v=${pageNum}-${i}`]);
    return page(gridPage(rows, { total: 55, totalPage: 3, closeTags: false }));
  });
  const result = await searchPapers({ value: "x", pageNum: 3, cookie: "c", request, throttle: noWait() });
  assert.equal(calls.length, 1);
  assert.equal(new URLSearchParams(calls[0].body).get("pageNum"), "3");
  assert.equal(result.papers.length, 20);
  assert.equal(result.papers[0].title, "P3-0");
  assert.equal(result.papers[0].href, "https://kns.cnki.net/kcms2/article/abstract?v=3-0");
  assert.equal(result.totalPage, 3, "ceil(55 / 20)");
});

test("a page past the end is empty and fine; a page inside the range without rows is UNEXPECTED_PAGE with a markup sample", async () => {
  const past = requestStub(() => page(gridPage([], { total: 25, totalPage: 2 })));
  const result = await searchPapers({ value: "x", pageNum: 9, cookie: "c", request: past.request, throttle: noWait() });
  assert.deepEqual(result, { papers: [], total: 25, totalPage: 2 });

  const withheld = `<html><body><div id="countPageDiv"><em>864,896</em></div><div class="no-table">rendered by script</div></body></html>`;
  const missing = requestStub(() => page(withheld));
  await assert.rejects(
    searchPapers({ value: "人工智能", pageNum: 1, cookie: "c", request: missing.request, throttle: noWait() }),
    (error) =>
      error.code === "UNEXPECTED_PAGE" &&
      /reported 864896 hits for page 1 but the result list could not be read \(table absent, 0 rows, 0 title cells, 0 abstract links\)/.test(error.message) &&
      error.markup.startsWith("<html><body><div id=\"countPageDiv\">") &&
      error.status === 200,
  );

  const unknownRows = `<html><body><div id="countPageDiv"><em>40</em></div><table class="result-table-list"><tbody><tr><td class="title"><span>no link here</span></td></tr></tbody></table></body></html>`;
  const unparsed = requestStub(() => page(unknownRows));
  await assert.rejects(
    searchPapers({ value: "x", pageNum: 1, cookie: "c", request: unparsed.request, throttle: noWait() }),
    (error) => error.code === "UNEXPECTED_PAGE" && /table present, 1 rows, 0 title cells, 0 abstract links/.test(error.message) && error.markup.startsWith('<table class="result-table-list">'),
  );

  const none = requestStub(() => page(gridPage([], { total: 0, totalPage: 0 })));
  assert.deepEqual(await searchPapers({ value: "x", cookie: "c", request: none.request, throttle: noWait() }), { papers: [], total: 0, totalPage: 0 });
});

test("a login page becomes COOKIE_EXPIRED, a captcha page BLOCKED, anything else UNEXPECTED_PAGE with diagnostics", async () => {
  const login = requestStub(() => page(fixture("login-page.html")));
  await assert.rejects(
    searchPapers({ value: "x", cookie: "", request: login.request, throttle: noWait() }),
    (error) => error.code === "COOKIE_EXPIRED",
  );
  const verify = requestStub(() => page(fixture("verify-page.html")));
  await assert.rejects(
    searchPapers({ value: "x", cookie: "c", request: verify.request, throttle: noWait() }),
    (error) => error.code === "BLOCKED" && error.title === "安全验证" && error.finalUrl === SEARCH_ENDPOINT,
  );
  const redirected = requestStub((call) =>
    call.url === SEARCH_ENDPOINT
      ? { status: 302, headers: { location: "/kns8s/security/verify?from=grid" } }
      : page('<html><body><div id="slider"></div></body></html>'),
  );
  await assert.rejects(
    searchPapers({ value: "x", cookie: "c", request: redirected.request, throttle: noWait() }),
    (error) => error.code === "BLOCKED" && error.finalUrl === "https://kns.cnki.net/kns8s/security/verify?from=grid",
    "a redirect to a verify URL is BLOCKED even when the page text says nothing",
  );
  const other = requestStub(() => page("<html><head><title>维护中</title></head><body>maintenance</body></html>"));
  await assert.rejects(
    searchPapers({ value: "x", cookie: "c", request: other.request, throttle: noWait() }),
    (error) => error.code === "UNEXPECTED_PAGE" && error.title === "维护中" && error.snippet === "维护中 maintenance" && error.status === 200,
  );
  const forbidden = requestStub(() => page("<html><body>Forbidden</body></html>", 403));
  await assert.rejects(
    searchPapers({ value: "x", cookie: "c", request: forbidden.request, throttle: noWait() }),
    (error) => error.code === "HTTP_ERROR" && error.status === 403,
  );
});

test("an empty keyword is refused before any request", async () => {
  const { request, calls } = requestStub(() => page(""));
  await assert.rejects(searchPapers({ value: "  ", cookie: "c", request, throttle: noWait() }), (error) => error.code === "INVALID_ARGUMENT");
  assert.equal(calls.length, 0);
});

test("the throttle spaces CNKI requests by the minimum gap plus jitter", async () => {
  let now = 0;
  const sleeps = [];
  const throttle = createThrottle({
    minGapMs: 1200,
    jitterMs: 900,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    random: () => 0.5,
  });
  await throttle.waitTurn();
  await throttle.waitTurn();
  assert.deepEqual(sleeps, [1650], "second call waits 1200 + 0.5 * 900 ms");
});

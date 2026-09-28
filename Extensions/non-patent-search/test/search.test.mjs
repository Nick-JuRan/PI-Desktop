import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import {
  SEARCH_ENDPOINT,
  buildQueryJson,
  buildSearchForm,
  normalizePageSize,
  searchPapers,
} from "../src/search.mjs";
import { createThrottle } from "../src/throttle.mjs";

const require = createRequire(import.meta.url);
const { createRequestStub } = require("./helpers/fake-cnki.cjs");

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const noWait = () => createThrottle({ minGapMs: 0, jitterMs: 0 });

/** Build a search-grid page with the given (title, href) rows. */
function gridPage(rows, { total = 100, totalPage = 5 } = {}) {
  const body = rows
    .map(
      ([title, href]) =>
        `<tr><td class="name"><a class="fz14" href="${href}">${title}</a></td><td class="author"></td><td class="source"></td></tr>`,
    )
    .join("");
  return `<html><body><div id="countPageDiv"><em>${total}</em><span class="countPageMark" data-pagenum="${totalPage}">1/${totalPage}</span></div><table class="result-table-list"><tbody>${body}</tbody></table></body></html>`;
}

/** `https.request` stub; `handler(call, n)` returns `{ status, headers, body }`. */
function requestStub(handler) {
  return createRequestStub(handler);
}
const page = (body, status = 200) => ({ status, body });

test("normalizePageSize rounds up to CNKI's 10/20/50 tiers", () => {
  assert.equal(normalizePageSize(1), 10);
  assert.equal(normalizePageSize(10), 10);
  assert.equal(normalizePageSize(11), 20);
  assert.equal(normalizePageSize(35), 50);
  assert.equal(normalizePageSize(500), 50);
  assert.equal(normalizePageSize(0), 20);
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

test("searchPapers posts the form with the crawler's exact headers and parses the fixture page", async () => {
  const { request, calls } = requestStub(() => page(fixture("search-page.html")));
  const result = await searchPapers({ value: " 格罗皮乌斯 ", want: 2, cookie: "s=1", request, throttle: noWait() });
  assert.equal(calls.length, 1, "two unique hits satisfy want=2 on the first page");
  assert.equal(calls[0].url, SEARCH_ENDPOINT);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(Object.keys(calls[0].headers).sort(), ["Accept-Encoding", "Content-Length", "Content-Type", "Cookie", "Referer", "User-Agent"]);
  assert.equal(calls[0].headers.Cookie, "s=1");
  assert.equal(calls[0].headers.Referer, "https://kns.cnki.net/");
  assert.equal(calls[0].headers["User-Agent"], "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36");
  assert.equal(calls[0].headers["Content-Type"], "application/x-www-form-urlencoded; charset=UTF-8");
  assert.match(calls[0].body, /^QueryJson=%7B/);
  assert.match(decodeURIComponent(calls[0].body), /"Value":"格罗皮乌斯"/);
  assert.equal(result.total, 1234);
  assert.deepEqual(
    result.papers.map((paper) => paper.title),
    ["基于格罗皮乌斯的现代建筑教育研究", "包豪斯设计理念的当代价值 & 反思"],
    "the duplicate href is dropped",
  );
});

test("searchPapers paginates until `want` papers are collected and stops at the last page", async () => {
  const { request, calls } = requestStub((call) => {
    const pageNum = Number(new URLSearchParams(call.body).get("pageNum"));
    const rows = Array.from({ length: 10 }, (_, i) => [`P${pageNum}-${i}`, `/kcms2/article/abstract?v=${pageNum}-${i}`]);
    return page(gridPage(rows, { totalPage: 2 }));
  });
  const result = await searchPapers({ value: "x", want: 15, cookie: "c", request, throttle: noWait() });
  assert.equal(calls.length, 2);
  assert.equal(new URLSearchParams(calls[0].body).get("pageSize"), "20", "15 rounds up to the 20 tier");
  assert.equal(result.papers.length, 15);
  assert.equal(result.papers[10].title, "P2-0");
});

test("searchPapers stops when a page repeats only known papers or is empty", async () => {
  const { request, calls } = requestStub(() => page(gridPage([["same", "/kcms2/article/abstract?v=1"]], { totalPage: 99 })));
  const result = await searchPapers({ value: "x", want: 30, cookie: "c", request, throttle: noWait() });
  assert.equal(result.papers.length, 1);
  assert.equal(calls.length, 2, "a second page of duplicates ends the loop");
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
      : page("<html><body><div id=\"slider\"></div></body></html>"),
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

test("partial results survive a failure on a later page", async () => {
  const { request } = requestStub((call, n) =>
    n === 1
      ? page(gridPage(Array.from({ length: 10 }, (_, i) => [`t${i}`, `/kcms2/article/abstract?v=${i}`]), { totalPage: 3 }))
      : page(fixture("verify-page.html")),
  );
  const result = await searchPapers({ value: "x", want: 20, cookie: "c", request, throttle: noWait() });
  assert.equal(result.papers.length, 10);
});

test("an empty keyword and a foreign host are refused before any request", async () => {
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

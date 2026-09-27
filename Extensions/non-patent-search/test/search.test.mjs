import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SEARCH_ENDPOINT,
  buildQueryJson,
  buildSearchForm,
  normalizePageSize,
  searchPapers,
} from "../src/search.mjs";
import { createThrottle } from "../src/throttle.mjs";

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

function fetchStub(handler) {
  const calls = [];
  const fetchImpl = async (input) => {
    calls.push(input);
    return handler(input, calls.length);
  };
  return { fetchImpl, calls };
}

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

test("searchPapers posts the form with cookie and browser headers and parses the fixture page", async () => {
  const { fetchImpl, calls } = fetchStub(() => ({ status: 200, headers: {}, bodyText: fixture("search-page.html") }));
  const result = await searchPapers({ value: " 格罗皮乌斯 ", want: 2, cookie: "s=1", fetchImpl, throttle: noWait() });
  assert.equal(calls.length, 1, "two unique hits satisfy want=2 on the first page");
  assert.equal(calls[0].url, SEARCH_ENDPOINT);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.Cookie, "s=1");
  assert.equal(calls[0].headers.Referer, "https://kns.cnki.net/");
  assert.match(calls[0].headers["Content-Type"], /x-www-form-urlencoded/);
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
  const { fetchImpl, calls } = fetchStub((input) => {
    const pageNum = Number(new URLSearchParams(input.body).get("pageNum"));
    const rows = Array.from({ length: 10 }, (_, i) => [`P${pageNum}-${i}`, `/kcms2/article/abstract?v=${pageNum}-${i}`]);
    return { status: 200, headers: {}, bodyText: gridPage(rows, { totalPage: 2 }) };
  });
  const result = await searchPapers({ value: "x", want: 15, cookie: "c", fetchImpl, throttle: noWait() });
  assert.equal(calls.length, 2);
  assert.equal(new URLSearchParams(calls[0].body).get("pageSize"), "20", "15 rounds up to the 20 tier");
  assert.equal(result.papers.length, 15);
  assert.equal(result.papers[10].title, "P2-0");
});

test("searchPapers stops when a page repeats only known papers or is empty", async () => {
  const { fetchImpl, calls } = fetchStub(() => ({
    status: 200,
    headers: {},
    bodyText: gridPage([["same", "/kcms2/article/abstract?v=1"]], { totalPage: 99 }),
  }));
  const result = await searchPapers({ value: "x", want: 30, cookie: "c", fetchImpl, throttle: noWait() });
  assert.equal(result.papers.length, 1);
  assert.equal(calls.length, 2, "a second page of duplicates ends the loop");
});

test("a login page becomes COOKIE_EXPIRED and a captcha page becomes BLOCKED", async () => {
  const login = fetchStub(() => ({ status: 200, headers: {}, bodyText: fixture("login-page.html") }));
  await assert.rejects(
    searchPapers({ value: "x", cookie: "", fetchImpl: login.fetchImpl, throttle: noWait() }),
    (error) => error.code === "COOKIE_EXPIRED",
  );
  const verify = fetchStub(() => ({ status: 200, headers: {}, bodyText: fixture("verify-page.html") }));
  await assert.rejects(
    searchPapers({ value: "x", cookie: "c", fetchImpl: verify.fetchImpl, throttle: noWait() }),
    (error) => error.code === "BLOCKED",
  );
  const other = fetchStub(() => ({ status: 200, headers: {}, bodyText: "<html><body>maintenance</body></html>" }));
  await assert.rejects(
    searchPapers({ value: "x", cookie: "c", fetchImpl: other.fetchImpl, throttle: noWait() }),
    (error) => error.code === "UNEXPECTED_PAGE",
  );
});

test("partial results survive a failure on a later page", async () => {
  const { fetchImpl } = fetchStub((input, n) =>
    n === 1
      ? { status: 200, headers: {}, bodyText: gridPage(Array.from({ length: 10 }, (_, i) => [`t${i}`, `/kcms2/article/abstract?v=${i}`]), { totalPage: 3 }) }
      : { status: 200, headers: {}, bodyText: fixture("verify-page.html") },
  );
  const result = await searchPapers({ value: "x", want: 20, cookie: "c", fetchImpl, throttle: noWait() });
  assert.equal(result.papers.length, 10);
});

test("an empty keyword and a foreign host are refused before any request", async () => {
  const { fetchImpl, calls } = fetchStub(() => ({ status: 200, headers: {}, bodyText: "" }));
  await assert.rejects(searchPapers({ value: "  ", cookie: "c", fetchImpl, throttle: noWait() }), (error) => error.code === "INVALID_ARGUMENT");
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

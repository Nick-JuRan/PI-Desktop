import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  absoluteUrl,
  attr,
  looksLikeLogin,
  looksLikeVerify,
  parseAbstractPage,
  parseReaderParams,
  parseSearchPage,
  restoreArticleText,
  stripHtml,
  unescapeHtml,
} from "../src/cnki-html.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("parseSearchPage keeps only abstract links, absolutizes them, decodes titles, and reads the toolbar", () => {
  const page = parseSearchPage(fixture("search-page.html"));
  assert.equal(page.hasToolbar, true);
  assert.equal(page.hasResultsTable, true);
  assert.equal(page.total, 1234);
  assert.equal(page.totalPage, 62);
  assert.deepEqual(page.papers, [
    {
      title: "基于格罗皮乌斯的现代建筑教育研究",
      href: "https://kns.cnki.net/kcms2/article/abstract?v=ABC123&uniplatform=NZKPT",
    },
    {
      title: "包豪斯设计理念的当代价值 & 反思",
      href: "https://kns.cnki.net/kcms2/article/abstract?v=DEF456",
    },
    {
      title: "重复的第一条（同一 href）",
      href: "https://kns.cnki.net/kcms2/article/abstract?v=ABC123&uniplatform=NZKPT",
    },
  ]);
});

test("parseSearchPage reports an empty grid without toolbar or table", () => {
  const page = parseSearchPage("<html><body><div>nothing here</div></body></html>");
  assert.equal(page.hasToolbar, false);
  assert.equal(page.hasResultsTable, false);
  assert.deepEqual(page.papers, []);
  assert.equal(page.total, -1);
});

test("login and verification pages are recognised, login first", () => {
  assert.equal(looksLikeLogin(fixture("login-page.html")), true);
  assert.equal(looksLikeVerify(fixture("verify-page.html")), true);
  assert.equal(looksLikeLogin(fixture("verify-page.html")), false);
  assert.equal(looksLikeVerify(fixture("search-page.html")), false);
});

test("parseAbstractPage returns the decoded abstract and absolute links", () => {
  const info = parseAbstractPage(fixture("abstract-page.html"), "https://kns.cnki.net/kcms2/article/abstract?v=ABC123");
  assert.equal(
    info.abstract,
    "本文以格罗皮乌斯的教育思想为线索，\n分析包豪斯 & 现代建筑教育之间的关系。…结论：理念仍具当代价值。",
  );
  assert.equal(info.htmlReadingUrl, "https://kns.cnki.net/kcms2/article/htmlreading?v=READ123&uniplatform=NZKPT");
  assert.equal(info.pdfUrl, "https://kns.cnki.net/pdf/download?id=PDF1");
  assert.equal(info.cajUrl, "https://bar.cnki.net/bar/download/order?id=CAJ1");
});

test("parseAbstractPage tolerates a page without the hidden input or reading button", () => {
  const info = parseAbstractPage("<html><body><span id=\"ChDivSummary\">摘要<b>正文</b></span></body></html>");
  assert.equal(info.abstract, "摘要正文");
  assert.equal(info.htmlReadingUrl, "");
});

test("restoreArticleText orders chapters, strips markup, decodes entities, and uses real newlines", () => {
  const text = restoreArticleText(fixture("reader-response.json"));
  assert.equal(
    text,
    [
      "基于格罗皮乌斯的现代建筑教育研究",
      "1 引言\n格罗皮乌斯（Walter Gropius） 是现代建筑教育的奠基人之一。",
      "2 包豪斯的教育实践\n包豪斯将“艺术与技术的新统一”作为宗旨。\n课程分为<基础课程>与<工坊课程>两部分。",
      "参考文献\n[1] 张三. 建筑教育史[M]. 北京: 建筑工业出版社, 2020.",
    ].join("\n\n"),
  );
  assert.equal(text.includes("\\n"), false, "no escaped newlines");
  assert.equal(/<[a-z]+>/i.test(text), false, "no tags");
  assert.equal(text.includes("&"), false, "no entities left");
});

test("restoreArticleText rejects failures and non-JSON", () => {
  assert.throws(() => restoreArticleText("<html>login</html>"), /not JSON/);
  assert.throws(() => restoreArticleText(JSON.stringify({ success: false, message: "no permission" })), /no permission/);
});

test("parseReaderParams needs all four parameters", () => {
  assert.deepEqual(
    parseReaderParams("https://kns.cnki.net/nzkhtml/knsread/index?fileName=F1&tableName=T1&dbCode=CJFD&invoice=INV%2B1"),
    { fileName: "F1", tableName: "T1", dbCode: "CJFD", invoice: "INV+1" },
  );
  assert.equal(parseReaderParams("https://kns.cnki.net/kcms2/article/htmlreading?v=READ123"), null);
  assert.equal(parseReaderParams("not a url"), null);
});

test("helpers: attr is order-agnostic, stripHtml collapses whitespace, unescapeHtml decodes", () => {
  assert.equal(attr('<a target="_blank" href=\'/x?a=1&amp;b=2\' class=fz14>', "href"), "/x?a=1&b=2");
  assert.equal(attr("<a class=fz14>", "href"), null);
  assert.equal(stripHtml("<p>a&nbsp;&nbsp;b</p>\n\n<p>c &#x4E2D; &#20013;</p>"), "a b\nc 中 中");
  assert.equal(unescapeHtml("&lt;x&gt; &amp; &unknown;"), "<x> & &unknown;");
  assert.equal(absoluteUrl("/kcms2/article/abstract?v=1"), "https://kns.cnki.net/kcms2/article/abstract?v=1");
  assert.equal(absoluteUrl(""), "");
});

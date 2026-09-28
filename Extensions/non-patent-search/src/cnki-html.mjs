/**
 * Parsing of the CNKI pages the tools read. No HTML library is available to a
 * plugin, so these are focused, attribute-order-agnostic extractors for the
 * few structures the crawler depends on:
 *
 * - the search grid (`table.result-table-list tbody tr`, title link
 *   `td.name a.fz14`, `#countPageDiv`),
 * - the abstract page (`input#abstract_text[value]`, `.btn-html a[href]`),
 * - the reader JSON (`{ success, content: { title, catalogInfos[] } }`).
 *
 * Every function is pure; fixtures under test/fixtures mirror the markup.
 */

export const KNS_ORIGIN = "https://kns.cnki.net";

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  ensp: "\u2002",
  emsp: "\u2003",
  hellip: "\u2026",
  middot: "\u00b7",
  ldquo: "\u201c",
  rdquo: "\u201d",
  lsquo: "\u2018",
  rsquo: "\u2019",
  mdash: "\u2014",
  ndash: "\u2013",
  times: "\u00d7",
  deg: "\u00b0",
  plusmn: "\u00b1",
  micro: "\u00b5",
  copy: "\u00a9",
  reg: "\u00ae",
};

/** Decode numeric and the common named HTML entities. */
export function unescapeHtml(text) {
  return String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : match));
}

function safeCodePoint(value) {
  try {
    return Number.isFinite(value) && value >= 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
  } catch {
    return "";
  }
}

/** Remove tags, decode entities, collapse whitespace. */
export function stripHtml(html) {
  const withBreaks = String(html ?? "")
    .replace(/<\s*(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "");
  return unescapeHtml(withBreaks)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Attribute value from a tag string, order-agnostic, quoted or bare.
 *
 * CNKI occasionally emits compact tags such as `target="_blank"href="…"`
 * without whitespace between quoted attributes. A token scanner handles that
 * markup while still respecting quoted values; a whitespace-only regex does
 * not find the following `href`.
 */
export function attr(tag, name) {
  const source = String(tag ?? "");
  const wanted = String(name ?? "").toLowerCase();
  const start = source.indexOf("<");
  let index = start >= 0 ? start + 1 : 0;

  while (index < source.length && !/[\s/>]/.test(source[index])) index += 1;
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (index >= source.length || source[index] === ">") break;
    if (source[index] === "/") {
      index += 1;
      continue;
    }

    const nameStart = index;
    while (index < source.length && !/[\s=/>]/.test(source[index])) index += 1;
    const attributeName = source.slice(nameStart, index).toLowerCase();
    if (!attributeName) {
      index += 1;
      continue;
    }

    while (index < source.length && /\s/.test(source[index])) index += 1;
    if (source[index] !== "=") continue;
    index += 1;
    while (index < source.length && /\s/.test(source[index])) index += 1;

    let value = "";
    const quote = source[index];
    if (quote === '"' || quote === "'") {
      index += 1;
      const valueStart = index;
      while (index < source.length && source[index] !== quote) index += 1;
      value = source.slice(valueStart, index);
      if (index < source.length) index += 1;
    } else {
      const valueStart = index;
      while (index < source.length && !/[\s>]/.test(source[index])) index += 1;
      value = source.slice(valueStart, index);
    }
    if (attributeName === wanted) return unescapeHtml(value);
  }
  return null;
}

function hasClass(tag, className) {
  const classes = attr(tag, "class");
  return Boolean(classes && classes.split(/\s+/).includes(className));
}

export function absoluteUrl(href, base = KNS_ORIGIN) {
  const value = String(href ?? "").trim();
  if (!value) return "";
  try {
    return new URL(value, base).toString();
  } catch {
    return value;
  }
}

/**
 * Login / human-verification detection.
 *
 * CNKICrawlerMCP matches these markers against the raw HTML of a search
 * response that carries no result table; that response is a fragment without
 * site navigation, so the raw match is safe there. Full pages (abstract page,
 * reader page) always link to `login.cnki.net` and ship captcha scripts, so
 * matching their raw HTML reports a healthy page as a login or verification
 * page. The markers are therefore matched against what a person would see —
 * the final URL, the `<title>` and the visible text — plus the script and form
 * targets that a redirect-to-login or redirect-to-verify page uses.
 */
const LOGIN_TEXT_MARKERS = ["用户登录", "登录知网", "账号登录", "个人登录", "IP登录"];
const VERIFY_TEXT_MARKERS = ["滑动验证", "人机验证", "安全验证", "请完成验证", "拖动滑块", "captcha", "verifycode"];
const LOGIN_URL_RE = /^https?:\/\/login\.cnki\.net\b/i;
const VERIFY_URL_RE = /\/(?:[^/?#]*(?:verify|captcha)[^/?#]*)(?:[/?#]|$)/i;
// Script/meta/form targets that move the visitor to a login or verify page.
const LOGIN_TARGET_RE =
  /(?:location(?:\.href)?\s*=\s*["']https?:\/\/login\.cnki\.net|http-equiv\s*=\s*["']refresh["'][^>]*login\.cnki\.net|<form\b[^>]*action\s*=\s*["'][^"']*login\.cnki\.net)/i;
const VERIFY_TARGET_RE =
  /(?:location(?:\.href)?\s*=\s*["'][^"']*(?:verify|captcha)[^"']*["']|<form\b[^>]*action\s*=\s*["'][^"']*(?:verify|captcha)[^"']*["']|<(?:iframe|img)\b[^>]*src\s*=\s*["'][^"']*(?:captcha|verifycode)[^"']*["'])/i;

export function pageTitle(html) {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ""));
  return match ? stripHtml(match[1]).replace(/\s+/g, " ").trim() : "";
}

/** The text a visitor would see: no scripts, styles, tags or entities; one space between elements. */
export function visibleText(html) {
  const text = String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return unescapeHtml(text).replace(/\s+/g, " ").trim();
}

/** Short, non-sensitive description of a page for error details and warnings. */
export function describePage(html, { finalUrl = "", status } = {}) {
  const body = String(html ?? "");
  return {
    ...(finalUrl ? { finalUrl } : {}),
    ...(status !== undefined ? { status } : {}),
    length: body.length,
    title: pageTitle(body).slice(0, 120),
    snippet: visibleText(body).slice(0, 240),
  };
}

function textLooksLike(body, markers) {
  const text = `${pageTitle(body)} ${visibleText(body)}`.toLowerCase();
  return markers.some((marker) => text.includes(marker.toLowerCase()));
}

export function looksLikeLogin(body, { finalUrl = "" } = {}) {
  const html = String(body ?? "");
  return LOGIN_URL_RE.test(finalUrl) || textLooksLike(html, LOGIN_TEXT_MARKERS) || LOGIN_TARGET_RE.test(html);
}

export function looksLikeVerify(body, { finalUrl = "" } = {}) {
  const html = String(body ?? "");
  let path = "";
  try {
    path = finalUrl ? new URL(finalUrl).pathname : "";
  } catch {
    path = "";
  }
  return VERIFY_URL_RE.test(path) || textLooksLike(html, VERIFY_TEXT_MARKERS) || VERIFY_TARGET_RE.test(html);
}

/**
 * Parse one search-grid response.
 * Returns `{ hasResultsTable, hasToolbar, total, totalPage, papers: [{ title, href }], counts }`
 * where `counts` (`rows`, `nameCells`, `abstractLinks`) says how far the row
 * parser got, for the diagnostics of a page that carries a hit count but no
 * usable list. The parser tolerates omitted `</tr>` / `</td>` end tags and a
 * nested table inside a cell; the title link is `td.name a.fz14` with an
 * `/kcms2/article/abstract` href, falling back to any abstract link in the row.
 */
export function parseSearchPage(html) {
  const body = String(html ?? "");
  const hasToolbar = /id\s*=\s*["']countPageDiv["']/i.test(body);
  const tableHtml = resultTableHtml(body);
  const hasResultsTable = tableHtml !== null;

  let total = -1;
  const totalMatch = /id\s*=\s*["']countPageDiv["'][^>]*>[\s\S]*?<em[^>]*>\s*([\d,]+)\s*<\/em>/i.exec(body);
  if (totalMatch) {
    const parsed = Number.parseInt(totalMatch[1].replace(/,/g, ""), 10);
    if (Number.isFinite(parsed)) total = parsed;
  }

  let totalPage = 0;
  const markMatch = /<span\b[^>]*class\s*=\s*["'][^"']*\bcountPageMark\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(body);
  if (markMatch) {
    const dataPageNum = attr(markMatch[0].slice(0, markMatch[0].indexOf(">") + 1), "data-pagenum");
    const fromAttr = Number.parseInt(dataPageNum ?? "", 10);
    if (Number.isFinite(fromAttr) && fromAttr > 0) {
      totalPage = fromAttr;
    } else {
      const text = stripHtml(markMatch[1]);
      const slash = text.lastIndexOf("/");
      const fromText = slash >= 0 ? Number.parseInt(text.slice(slash + 1).trim(), 10) : NaN;
      if (Number.isFinite(fromText) && fromText > 0) totalPage = fromText;
    }
  }

  const papers = [];
  const counts = { rows: 0, nameCells: 0, abstractLinks: 0 };
  for (const rowHtml of splitRows(tableHtml ?? "")) {
    counts.rows += 1;
    const cells = splitCells(rowHtml);
    const nameCell = cells.find((cell) => hasClass(cell.openTag, "name"));
    if (nameCell) counts.nameCells += 1;
    const isAbstractLink = (tag) => (attr(tag, "href") ?? "").includes("/kcms2/article/abstract");
    const anchor =
      (nameCell && (findAnchor(nameCell.inner, (tag) => hasClass(tag, "fz14") && isAbstractLink(tag)) ?? findAnchor(nameCell.inner, isAbstractLink))) ??
      findAnchor(rowHtml, isAbstractLink);
    if (!anchor) continue;
    counts.abstractLinks += 1;
    const hrefRaw = (attr(anchor.openTag, "href") ?? "").trim();
    if (!hrefRaw || hrefRaw.toLowerCase().startsWith("javascript:")) continue;
    const href = absoluteUrl(hrefRaw);
    const title = stripHtml(anchor.inner);
    if (!title) continue;
    papers.push({ title, href });
  }

  return { hasToolbar, hasResultsTable, total, totalPage, papers, counts };
}

/** Inner HTML of `table.result-table-list`, respecting nested tables; null when absent. */
function resultTableHtml(body) {
  const open = /<table\b[^>]*class\s*=\s*["'][^"']*\bresult-table-list\b[^"']*["'][^>]*>/i.exec(body);
  if (!open) return null;
  const start = open.index + open[0].length;
  const tagRe = /<\/?table\b[^>]*>/gi;
  tagRe.lastIndex = start;
  let depth = 1;
  let tag;
  while ((tag = tagRe.exec(body)) !== null) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return body.slice(start, tag.index);
  }
  return body.slice(start);
}

/** Row bodies of a table; each runs from a `<tr>` to the next `<tr>` (end tags may be omitted). */
function splitRows(tableHtml) {
  const rows = [];
  const openRe = /<tr\b[^>]*>/gi;
  const opens = [];
  let match;
  while ((match = openRe.exec(tableHtml)) !== null) opens.push({ index: match.index, end: match.index + match[0].length });
  for (let i = 0; i < opens.length; i += 1) {
    const stop = i + 1 < opens.length ? opens[i + 1].index : tableHtml.length;
    rows.push(tableHtml.slice(opens[i].end, stop).replace(/<\/tr\s*>[\s\S]*$/i, ""));
  }
  return rows;
}

/** Cells of a row; each runs from a `<td>` to the next `<td>` (end tags may be omitted). */
function splitCells(rowHtml) {
  const cells = [];
  const openRe = /<td\b([^>]*)>/gi;
  const opens = [];
  let match;
  while ((match = openRe.exec(rowHtml)) !== null) opens.push({ index: match.index, end: match.index + match[0].length, attrs: match[1] });
  for (let i = 0; i < opens.length; i += 1) {
    const stop = i + 1 < opens.length ? opens[i + 1].index : rowHtml.length;
    cells.push({ openTag: `<td${opens[i].attrs}>`, inner: rowHtml.slice(opens[i].end, stop).replace(/<\/td\s*>[\s\S]*$/i, "") });
  }
  return cells;
}

/** A short markup sample for parser diagnostics: the result table when present, else the body start. */
export function markupSample(html, limit = 1500) {
  const body = String(html ?? "");
  const anchor = /<table\b[^>]*result-table-list[^>]*>|<tbody\b[^>]*>|<tr\b[^>]*>/i.exec(body);
  const start = anchor ? anchor.index : 0;
  return body.slice(start, start + limit).replace(/\s+/g, " ").trim();
}

function findAnchor(html, predicate) {
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    const openTag = `<a${match[1]}>`;
    if (predicate(openTag)) return { openTag, inner: match[2] };
  }
  return null;
}

/**
 * Parse an abstract page. Returns `{ abstract, htmlReadingUrl, pdfUrl, cajUrl }`
 * with absolute URLs and a decoded abstract; missing pieces are "".
 */
export function parseAbstractPage(html, pageUrl = KNS_ORIGIN) {
  const body = String(html ?? "");
  let abstract = "";
  const inputRe = /<input\b[^>]*>/gi;
  let input;
  while ((input = inputRe.exec(body)) !== null) {
    if ((attr(input[0], "id") ?? "") === "abstract_text") {
      abstract = stripHtml(attr(input[0], "value") ?? "");
      break;
    }
  }
  if (!abstract) {
    // Some layouts render the abstract inline instead of the hidden input.
    const span = /<span\b[^>]*id\s*=\s*["']ChDivSummary["'][^>]*>([\s\S]*?)<\/span>/i.exec(body);
    if (span) abstract = stripHtml(span[1]);
  }

  let htmlReadingUrl = "";
  const btnHtml = /<[a-z]+\b[^>]*class\s*=\s*["'][^"']*\bbtn-html\b[^"']*["'][^>]*>/i.exec(body);
  if (btnHtml) {
    // The element is either the <a> itself or a wrapper whose first <a> is the link.
    const openTag = btnHtml[0];
    let href = /^<a\b/i.test(openTag) ? attr(openTag, "href") : null;
    if (!href) {
      const following = body.slice(btnHtml.index + openTag.length, btnHtml.index + openTag.length + 4000);
      const anchorTag = /<a\b[^>]*>/i.exec(following);
      href = anchorTag ? attr(anchorTag[0], "href") : null;
    }
    if (href) htmlReadingUrl = absoluteUrl(href, pageUrl);
  }

  const pdfUrl = anchorHrefById(body, "pdfDown", pageUrl);
  const cajUrl = anchorHrefById(body, "cajDown", pageUrl);
  return { abstract, htmlReadingUrl, pdfUrl, cajUrl };
}

function anchorHrefById(body, id, pageUrl) {
  const anchorRe = /<a\b[^>]*>/gi;
  let match;
  while ((match = anchorRe.exec(body)) !== null) {
    if ((attr(match[0], "id") ?? "") === id) {
      const href = attr(match[0], "href");
      return href ? absoluteUrl(href, pageUrl) : "";
    }
  }
  return "";
}

/** The reader query parameters, or null when any of the four is missing. */
export function parseReaderParams(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return null;
  }
  const params = parsed.searchParams;
  const byName = (...names) => {
    const wanted = new Set(names.map((name) => name.toLowerCase()));
    for (const [key, value] of params.entries()) {
      if (wanted.has(key.toLowerCase()) && value) return value;
    }
    return "";
  };
  const fileName = byName("fileName", "filename");
  const tableName = byName("tableName", "tablename");
  // `/reader/read` redirects use `product` where the reader API expects `dbCode`.
  const dbCode = byName("dbCode", "dbcode", "product");
  const invoice = byName("invoice");
  if (!fileName || !tableName || !dbCode || !invoice) return null;
  return { fileName, tableName, dbCode, invoice };
}

/**
 * Turn the reader JSON into plain text: title, then each chapter heading and
 * its paragraphs in `orderNum` order. Tags and entities are removed; the result
 * contains real newlines only.
 */
export function restoreArticleText(jsonText) {
  let data;
  try {
    data = JSON.parse(String(jsonText));
  } catch (error) {
    throw Object.assign(new Error(`reader response is not JSON: ${error.message}`), { code: "MAIN_BODY_UNAVAILABLE" });
  }
  if (!data || data.success !== true || !data.content || typeof data.content !== "object") {
    const message = typeof data?.message === "string" ? data.message : typeof data?.msg === "string" ? data.msg : "";
    throw Object.assign(
      new Error(`CNKI did not return the article body${message ? `: ${message}` : ""}`),
      { code: "MAIN_BODY_UNAVAILABLE" },
    );
  }
  const content = data.content;
  const chapters = Array.isArray(content.catalogInfos) ? [...content.catalogInfos] : [];
  chapters.sort((a, b) => Number(a?.orderNum ?? 0) - Number(b?.orderNum ?? 0));
  const parts = [];
  const title = stripHtml(content.title ?? "");
  if (title) parts.push(title);
  for (const chapter of chapters) {
    const heading = stripHtml(chapter?.cataTitle ?? "");
    const text = stripHtml(chapter?.content ?? "");
    if (!heading && !text) continue;
    parts.push([heading, text].filter(Boolean).join("\n"));
  }
  return parts.join("\n\n");
}

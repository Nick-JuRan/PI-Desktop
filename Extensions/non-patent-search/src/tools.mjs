import { searchPapers } from "./search.mjs";
import { fetchPaperInfo, fetchPaperMainBody } from "./paper.mjs";
import { CnkiError, ERROR_CODES } from "./errors.mjs";

/**
 * Tool executors. Each takes the parsed arguments plus the plugin services
 * (cookie manager, HTTPS request function, throttle) so tests can drive them
 * without a plugin host.
 */

/**
 * The plugin host cancels a tool call after 110 s. Abstract-page reads stop
 * once this much of the call has elapsed so the search itself is never lost.
 */
export const DETAIL_TIME_BUDGET_MS = 80_000;

/** Remembered first pages (query → hrefs) to notice CNKI answering a later page with page 1 again. */
const FIRST_PAGE_MEMORY = 50;
const firstPages = new Map();

function rememberFirstPage(query, papers) {
  firstPages.delete(query);
  firstPages.set(query, new Set(papers.map((paper) => paper.href)));
  while (firstPages.size > FIRST_PAGE_MEMORY) firstPages.delete(firstPages.keys().next().value);
}

function repeatsFirstPage(query, papers) {
  const first = firstPages.get(query);
  return Boolean(first && papers.length > 0 && papers.every((paper) => first.has(paper.href)));
}

function integerArg(value, name, { min, max, fallback }) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, `${name} must be an integer`);
  }
  if (value < min || (max !== undefined && value > max)) {
    throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, `${name} must be between ${min} and ${max ?? "∞"}`);
  }
  return value;
}

/**
 * Re-login policy for one tool call: the first COOKIE_EXPIRED triggers exactly
 * one IP login and one retry; a second one is final. Shared by the search and
 * every abstract page of the same call, so a stale session costs one login,
 * never one per paper.
 */
function createSession(cookies, signal) {
  let reloggedIn = false;
  return {
    async run(fn) {
      const cookie = await cookies.ensure(signal);
      try {
        return await fn(cookie);
      } catch (error) {
        if (!(error instanceof CnkiError) || error.code !== ERROR_CODES.COOKIE_EXPIRED || reloggedIn) throw error;
        reloggedIn = true;
        const fresh = await cookies.refresh(signal);
        return fn(fresh);
      }
    },
  };
}

/**
 * CNKI_ScanPaper: one result page of 20 papers (one search request, as the
 * original MCP's ScanPaper), then one throttled abstract-page request per hit
 * for Abstract and HTML_READING_URL. Detail requests never fail the search: a
 * paper whose page is unavailable keeps empty fields and a warning names it;
 * the first verification page, a second login page, or the time budget stops
 * the remaining detail requests with a closing warning.
 */
export async function executeScanPaper({ args, cookies, request, throttle, signal, log = () => {}, now = Date.now }) {
  const started = now();
  const value = typeof args?.value === "string" ? args.value.trim() : "";
  if (!value) throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, "value (the search keyword) is required");
  const pageNum = integerArg(args?.pageNum, "pageNum", { min: 1, fallback: 1 });
  const session = createSession(cookies, signal);

  const { papers, total, totalPage } = await session.run((cookie) => searchPapers({ value, pageNum, cookie, request, throttle, signal }));

  const warnings = [];
  if (pageNum === 1) rememberFirstPage(value, papers);
  else if (repeatsFirstPage(value, papers)) {
    warnings.push(`CNKI answered page ${pageNum} with the same papers as page 1; deeper pages are not available for this query in the current session.`);
  }
  if (papers.length === 0 && totalPage > 0 && pageNum > totalPage) {
    warnings.push(`page ${pageNum} is past the last page (${totalPage}).`);
  }

  const results = [];
  let detailsStopped = "";
  for (const paper of papers) {
    if (signal?.aborted) throw new CnkiError(ERROR_CODES.CANCELLED, "search cancelled");
    let info = { abstract: "", htmlReadingUrl: "" };
    if (!detailsStopped && now() - started > DETAIL_TIME_BUDGET_MS) detailsStopped = "TIME_BUDGET";
    if (!detailsStopped) {
      try {
        info = await session.run((cookie) => fetchPaperInfo({ href: paper.href, cookie, request, throttle, signal }));
        if (info.note) warnings.push(`${paper.title}: ${info.note}`);
      } catch (error) {
        if (error instanceof CnkiError && error.code === ERROR_CODES.CANCELLED) throw error;
        const message = error instanceof Error ? error.message : String(error);
        warnings.push(`${paper.title}: abstract page unavailable (${message})`);
        log(`abstract page failed for ${paper.href}: ${message}`);
        if (error instanceof CnkiError && (error.code === ERROR_CODES.BLOCKED || error.code === ERROR_CODES.COOKIE_EXPIRED)) {
          detailsStopped = error.code;
        }
      }
    }
    results.push({
      Title: paper.title,
      Href: paper.href,
      Abstract: info.abstract ?? "",
      HTML_READING_URL: info.htmlReadingUrl ?? "",
    });
  }
  if (detailsStopped) {
    const fetched = results.filter((paper) => paper.Abstract || paper.HTML_READING_URL).length;
    const tail = "the remaining papers carry empty Abstract and HTML_READING_URL";
    warnings.push(
      detailsStopped === ERROR_CODES.BLOCKED
        ? `CNKI asked for human verification after ${fetched} abstract page(s); ${tail}. Wait a few minutes before the next call.`
        : detailsStopped === ERROR_CODES.COOKIE_EXPIRED
          ? `CNKI kept answering with its login page after a fresh IP login; ${tail}. Check that this network is on the CNKI IP whitelist.`
          : `stopped reading abstract pages after ${fetched} to stay within the tool time limit; ${tail}. Call the same page again later for them.`,
    );
  }

  return {
    ok: true,
    pageNum,
    totalPage,
    ...(total >= 0 ? { totalHits: total } : {}),
    papers: results,
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * CNKI_GetPaperMainBody: full text as a plain string (the host hands strings
 * to the model verbatim, so no JSON escaping reaches the transcript).
 */
export async function executeGetPaperMainBody({ args, cookies, request, throttle, signal }) {
  const href = typeof args?.href === "string" ? args.href.trim() : "";
  if (!href) throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, "href (the HTML_READING_URL) is required");
  const session = createSession(cookies, signal);
  const text = await session.run((cookie) => fetchPaperMainBody({ href, cookie, request, throttle, signal }));
  if (!text.trim()) {
    throw new CnkiError(ERROR_CODES.MAIN_BODY_UNAVAILABLE, "CNKI returned an empty article body", { url: href });
  }
  return text;
}

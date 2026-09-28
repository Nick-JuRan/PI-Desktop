import { searchPapers, DEFAULT_PAGE_SIZE, MAX_TOTAL_RESULTS } from "./search.mjs";
import { fetchPaperInfo, fetchPaperMainBody } from "./paper.mjs";
import { CnkiError, ERROR_CODES } from "./errors.mjs";

/**
 * Tool executors. Each takes the parsed arguments plus the plugin services
 * (cookie manager, HTTPS request function, throttle) so tests can drive them
 * without a plugin host.
 */

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

function booleanArg(value, name, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, `${name} must be a boolean`);
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
    get reloggedIn() {
      return reloggedIn;
    },
  };
}

/**
 * CNKI_ScanPaper: one search request (as the original MCP's ScanPaper), then,
 * unless `withDetails` is false, one throttled abstract-page request per hit
 * for Abstract and HTML_READING_URL. Detail requests never fail the search:
 * a paper whose page is unavailable keeps empty fields and a warning names it,
 * and the first verification or second login page stops the remaining detail
 * requests so a rate-limited session is not hammered further.
 */
export async function executeScanPaper({ args, cookies, request, throttle, signal, log = () => {} }) {
  const value = typeof args?.value === "string" ? args.value.trim() : "";
  if (!value) throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, "value (the search keyword) is required");
  const pageSize = integerArg(args?.pageSize, "pageSize", { min: 1, max: MAX_TOTAL_RESULTS, fallback: DEFAULT_PAGE_SIZE });
  const pageNum = integerArg(args?.pageNum, "pageNum", { min: 1, fallback: 1 });
  const withDetails = booleanArg(args?.withDetails, "withDetails", true);
  const session = createSession(cookies, signal);

  const { papers, total } = await session.run((cookie) =>
    searchPapers({ value, pageNum, want: pageSize, cookie, request, throttle, signal }),
  );

  const results = [];
  const warnings = [];
  let detailsStopped = "";
  for (const paper of papers) {
    if (signal?.aborted) throw new CnkiError(ERROR_CODES.CANCELLED, "search cancelled");
    let info = { abstract: "", htmlReadingUrl: "" };
    if (withDetails && !detailsStopped) {
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
    warnings.push(
      detailsStopped === ERROR_CODES.BLOCKED
        ? `CNKI asked for human verification after ${fetched} abstract page(s); the remaining papers carry empty Abstract and HTML_READING_URL. Wait a few minutes before the next call, or call again with withDetails=false for a single-request search.`
        : `CNKI kept answering with its login page after a fresh IP login; the remaining papers carry empty Abstract and HTML_READING_URL. Check that this network is on the CNKI IP whitelist.`,
    );
  }

  return {
    ok: true,
    query: value,
    pageNum,
    requested: pageSize,
    returned: results.length,
    ...(total >= 0 ? { totalHits: total } : {}),
    withDetails,
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

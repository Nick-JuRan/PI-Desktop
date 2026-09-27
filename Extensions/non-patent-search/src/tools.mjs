import { searchPapers, DEFAULT_PAGE_SIZE, MAX_TOTAL_RESULTS } from "./search.mjs";
import { fetchPaperInfo, fetchPaperMainBody } from "./paper.mjs";
import { CnkiError, ERROR_CODES } from "./errors.mjs";

/**
 * Tool executors. Each takes the parsed arguments plus the plugin services
 * (cookie manager, host fetch, raw request, throttle) so tests can drive them
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

/** Run `fn` once; on COOKIE_EXPIRED re-login and run it once more. */
async function withRelogin(cookies, signal, fn) {
  let cookie = await cookies.ensure(signal);
  try {
    return await fn(cookie);
  } catch (error) {
    if (!(error instanceof CnkiError) || error.code !== ERROR_CODES.COOKIE_EXPIRED) throw error;
    cookie = await cookies.refresh(signal);
    return fn(cookie);
  }
}

/**
 * CNKI_ScanPaper: search, then read every hit's abstract page for Abstract and
 * HTML_READING_URL. Detail failures do not fail the search; the paper is
 * returned with empty fields and a warning line names it.
 */
export async function executeScanPaper({ args, cookies, fetchImpl, throttle, signal, log = () => {} }) {
  const value = typeof args?.value === "string" ? args.value.trim() : "";
  if (!value) throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, "value (the search keyword) is required");
  const pageSize = integerArg(args?.pageSize, "pageSize", { min: 1, max: MAX_TOTAL_RESULTS, fallback: DEFAULT_PAGE_SIZE });
  const pageNum = integerArg(args?.pageNum, "pageNum", { min: 1, fallback: 1 });

  const { papers, total } = await withRelogin(cookies, signal, (cookie) =>
    searchPapers({ value, pageNum, want: pageSize, cookie, fetchImpl, throttle, signal }),
  );

  const results = [];
  const warnings = [];
  for (const paper of papers) {
    if (signal?.aborted) throw new CnkiError(ERROR_CODES.CANCELLED, "search cancelled");
    let info = { abstract: "", htmlReadingUrl: "" };
    try {
      info = await withRelogin(cookies, signal, (cookie) =>
        fetchPaperInfo({ href: paper.href, cookie, fetchImpl, throttle, signal }),
      );
    } catch (error) {
      if (error instanceof CnkiError && error.code === ERROR_CODES.BLOCKED) throw error;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${paper.title}: abstract page unavailable (${message})`);
      log(`abstract page failed for ${paper.href}: ${message}`);
    }
    results.push({
      Title: paper.title,
      Href: paper.href,
      Abstract: info.abstract ?? "",
      HTML_READING_URL: info.htmlReadingUrl ?? "",
    });
  }

  return {
    ok: true,
    query: value,
    pageNum,
    requested: pageSize,
    returned: results.length,
    ...(total >= 0 ? { totalHits: total } : {}),
    papers: results,
    ...(warnings.length ? { warnings } : {}),
  };
}

/**
 * CNKI_GetPaperMainBody: full text as a plain string (the host hands strings
 * to the model verbatim, so no JSON escaping reaches the transcript).
 */
export async function executeGetPaperMainBody({ args, cookies, fetchImpl, request, throttle, signal }) {
  const href = typeof args?.href === "string" ? args.href.trim() : "";
  if (!href) throw new CnkiError(ERROR_CODES.INVALID_ARGUMENT, "href (the HTML_READING_URL) is required");
  const text = await withRelogin(cookies, signal, (cookie) =>
    fetchPaperMainBody({ href, cookie, fetchImpl, request, throttle, signal }),
  );
  if (!text.trim()) {
    throw new CnkiError(ERROR_CODES.MAIN_BODY_UNAVAILABLE, "CNKI returned an empty article body", { url: href });
  }
  return text;
}

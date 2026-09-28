import { cnkiRequest, MAX_REDIRECT_HOPS } from "./http.mjs";
import { describePage, looksLikeLogin, looksLikeVerify, parseAbstractPage, parseReaderParams, restoreArticleText } from "./cnki-html.mjs";
import { CnkiError, ERROR_CODES } from "./errors.mjs";

/**
 * Per-paper requests: the abstract page (abstract + HTML reading link) and the
 * full text behind the HTML reading link. Every request goes through
 * `cnkiRequest`, i.e. the Go crawler's header set with the session cookie.
 */
export const READER_ENDPOINT = "https://kns.cnki.net/nzkhtml/knsread/litNotes/getPaperInfo";

/** Login → COOKIE_EXPIRED, verification → BLOCKED, otherwise null. */
export function pageError(url, response) {
  const bodyText = response.bodyText ?? "";
  const finalUrl = response.finalUrl ?? url;
  const context = { finalUrl };
  const details = { url, ...describePage(bodyText, { finalUrl, status: response.status }) };
  if (looksLikeLogin(bodyText, context)) {
    return new CnkiError(ERROR_CODES.COOKIE_EXPIRED, "CNKI answered with its login page; the session cookie is missing or expired", details);
  }
  if (looksLikeVerify(bodyText, context)) {
    return new CnkiError(ERROR_CODES.BLOCKED, "CNKI asked for human verification; slow down and retry later", details);
  }
  return null;
}

/**
 * Abstract + HTML reading link for one search hit (GetPaperInfo, reduced).
 * A page that is neither a login nor a verification page but carries none of
 * the expected markup is returned with empty fields and a `note`, like the Go
 * crawler's empty PaperInfo; the caller reports it as a warning.
 */
export async function fetchPaperInfo({ href, cookie, request, throttle, signal }) {
  await throttle?.waitTurn(signal);
  const response = await cnkiRequest({ url: href, cookie, signal }, request ? { request } : undefined);
  const info = parseAbstractPage(response.bodyText, response.finalUrl ?? href);
  if (info.abstract || info.htmlReadingUrl) return { ...info, note: "" };
  const classified = pageError(href, response);
  if (classified) throw classified;
  if (response.status >= 400) {
    throw new CnkiError(ERROR_CODES.HTTP_ERROR, `abstract page returned HTTP ${response.status}`, {
      url: href,
      ...describePage(response.bodyText, { finalUrl: response.finalUrl, status: response.status }),
    });
  }
  const page = describePage(response.bodyText, { finalUrl: response.finalUrl, status: response.status });
  return {
    ...info,
    note: `no abstract or HTML reading link found on the abstract page (title: ${page.title || "none"}, ${page.length} characters)`,
  };
}

/**
 * Resolve the reader query parameters behind an HTML reading link.
 * The link itself may already carry them; otherwise CNKI redirects (usually
 * twice) to a URL that does. Redirects are followed one hop at a time so each
 * `Location` can be inspected, exactly like the Go crawler's `getRedirect`.
 */
export async function resolveReaderParams({ href, cookie, request, throttle, signal }) {
  const direct = parseReaderParams(href);
  if (direct) return direct;
  let url = href;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    await throttle?.waitTurn(signal);
    const response = await cnkiRequest({ url, cookie, followRedirects: false, signal }, request ? { request } : undefined);
    if (response.status >= 300 && response.status < 400 && response.location) {
      url = new URL(response.location, url).toString();
      const params = parseReaderParams(url);
      if (params) return params;
      continue;
    }
    const classified = pageError(url, response);
    if (classified) throw classified;
    // A final page without the parameters: look for them inside the markup.
    const embedded = /fileName=([^&"'\s]+)&(?:amp;)?tableName=([^&"'\s]+)&(?:amp;)?dbCode=([^&"'\s]+)&(?:amp;)?invoice=([^&"'\s]+)/i.exec(response.bodyText ?? "");
    if (embedded) {
      return {
        fileName: decodeURIComponent(embedded[1]),
        tableName: decodeURIComponent(embedded[2]),
        dbCode: decodeURIComponent(embedded[3]),
        invoice: decodeURIComponent(embedded[4]),
      };
    }
    throw new CnkiError(
      ERROR_CODES.MAIN_BODY_UNAVAILABLE,
      `the reading link did not lead to a reader page with fileName/tableName/dbCode/invoice (HTTP ${response.status}); the paper may not be readable online under the current subscription`,
      { url, ...describePage(response.bodyText, { finalUrl: url, status: response.status }) },
    );
  }
  throw new CnkiError(ERROR_CODES.MAIN_BODY_UNAVAILABLE, `too many redirects while resolving the reading link`, { url: href });
}

export function readerUrl({ fileName, tableName, dbCode, invoice }) {
  const params = new URLSearchParams({ fileName, tableName, dbCode, invoice });
  return `${READER_ENDPOINT}?${params.toString()}`;
}

/** Plain-text full text for one HTML reading link (GetPaperMainBody). */
export async function fetchPaperMainBody({ href, cookie, request, throttle, signal }) {
  const params = await resolveReaderParams({ href, cookie, request, throttle, signal });
  const url = readerUrl(params);
  await throttle?.waitTurn(signal);
  const response = await cnkiRequest({ url, cookie, signal }, request ? { request } : undefined);
  const isJson = response.bodyText.trim().startsWith("{");
  if (!isJson) {
    const classified = pageError(url, response);
    if (classified) throw classified;
  }
  if (response.status >= 400) {
    throw new CnkiError(ERROR_CODES.HTTP_ERROR, `reader endpoint returned HTTP ${response.status}`, {
      url,
      ...describePage(response.bodyText, { finalUrl: response.finalUrl, status: response.status }),
    });
  }
  try {
    return restoreArticleText(response.bodyText);
  } catch (error) {
    throw new CnkiError(ERROR_CODES.MAIN_BODY_UNAVAILABLE, error.message, { url });
  }
}

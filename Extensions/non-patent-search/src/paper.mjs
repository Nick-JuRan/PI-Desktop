import { hostFetch, cnkiHeaders, rawRequest } from "./http.mjs";
import { looksLikeLogin, looksLikeVerify, parseAbstractPage, parseReaderParams, restoreArticleText } from "./cnki-html.mjs";
import { CnkiError, ERROR_CODES } from "./errors.mjs";

/**
 * Per-paper requests: the abstract page (abstract + HTML reading link) and the
 * full text behind the HTML reading link.
 */
export const READER_ENDPOINT = "https://kns.cnki.net/nzkhtml/knsread/litNotes/getPaperInfo";
const MAX_REDIRECT_HOPS = 6;

function pageError(url, bodyText) {
  if (looksLikeLogin(bodyText)) {
    return new CnkiError(ERROR_CODES.COOKIE_EXPIRED, "CNKI answered with its login page; the session cookie is missing or expired", { url });
  }
  if (looksLikeVerify(bodyText)) {
    return new CnkiError(ERROR_CODES.BLOCKED, "CNKI asked for human verification; slow down and retry later", { url });
  }
  return null;
}

/** Abstract + HTML reading link for one search hit (GetPaperInfo, reduced). */
export async function fetchPaperInfo({ href, cookie, fetchImpl, throttle, signal }) {
  await throttle?.waitTurn(signal);
  const response = await hostFetch(fetchImpl, { url: href, headers: cnkiHeaders(cookie) });
  if (response.status >= 400) {
    throw new CnkiError(ERROR_CODES.HTTP_ERROR, `abstract page returned HTTP ${response.status}`, { url: href, status: response.status });
  }
  const info = parseAbstractPage(response.bodyText, href);
  if (!info.abstract && !info.htmlReadingUrl) {
    const classified = pageError(href, response.bodyText);
    if (classified) throw classified;
  }
  return info;
}

/**
 * Resolve the reader query parameters behind an HTML reading link.
 * The link itself may already carry them; otherwise CNKI redirects (usually
 * twice) to a URL that does. Redirects are followed by hand so each hop's
 * `Location` can be inspected and checked against the host allowlist.
 */
export async function resolveReaderParams({ href, cookie, request, throttle, signal }) {
  const direct = parseReaderParams(href);
  if (direct) return direct;
  let url = href;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    await throttle?.waitTurn(signal);
    const response = await rawRequest(
      { url, headers: cnkiHeaders(cookie), signal },
      request ? { request } : undefined,
    );
    if (response.status >= 300 && response.status < 400 && response.location) {
      url = new URL(response.location, url).toString();
      const params = parseReaderParams(url);
      if (params) return params;
      continue;
    }
    const classified = pageError(url, response.bodyText ?? "");
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
      { url, status: response.status },
    );
  }
  throw new CnkiError(ERROR_CODES.MAIN_BODY_UNAVAILABLE, `too many redirects while resolving the reading link`, { url: href });
}

export function readerUrl({ fileName, tableName, dbCode, invoice }) {
  const params = new URLSearchParams({ fileName, tableName, dbCode, invoice });
  return `${READER_ENDPOINT}?${params.toString()}`;
}

/** Plain-text full text for one HTML reading link (GetPaperMainBody). */
export async function fetchPaperMainBody({ href, cookie, fetchImpl, request, throttle, signal }) {
  const params = await resolveReaderParams({ href, cookie, request, throttle, signal });
  const url = readerUrl(params);
  await throttle?.waitTurn(signal);
  const response = await hostFetch(fetchImpl, { url, headers: cnkiHeaders(cookie, { Accept: "application/json, text/plain, */*" }) });
  if (response.status >= 400) {
    throw new CnkiError(ERROR_CODES.HTTP_ERROR, `reader endpoint returned HTTP ${response.status}`, { url, status: response.status });
  }
  const classified = pageError(url, response.bodyText);
  if (classified && !response.bodyText.trim().startsWith("{")) throw classified;
  try {
    return restoreArticleText(response.bodyText);
  } catch (error) {
    throw new CnkiError(ERROR_CODES.MAIN_BODY_UNAVAILABLE, error.message, { url });
  }
}

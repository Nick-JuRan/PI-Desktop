import https from "node:https";
import { URL } from "node:url";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import { CnkiError, fail, ERROR_CODES } from "./errors.mjs";

/**
 * HTTP for the CNKI tools: a minimal `node:https` client that sends exactly the
 * request CNKICrawlerMCP (Go, colly) sends, confined to `*.cnki.net`.
 *
 * The host's `pi.net.fetch` is deliberately not used for CNKI. In the desktop
 * it is Electron's `net.fetch` (Chromium's network stack), which behaves like a
 * browser tab, not like a crawler:
 *
 * - once any response has set a cookie for the host, Chromium replaces the
 *   plugin's `Cookie` header with its own session jar, so the IP-login cookie
 *   stops reaching CNKI after the first request and CNKI answers the anonymous
 *   client with its human-verification page;
 * - `redirect: "manual"` is not supported and any 30x response fails with
 *   "Redirect was cancelled", so redirect targets can never be inspected;
 * - several `Set-Cookie` headers collapse into one string.
 *
 * `cnkiRequest` therefore follows redirects itself (each hop re-checked
 * against the host allowlist), carries the login cookie on every hop, keeps
 * cookies set inside one redirect chain for the following hops (like colly's
 * per-request jar) and returns the final URL so the caller can tell a login or
 * verification redirect from the page it asked for.
 */
export const ALLOWED_HOST_SUFFIX = ".cnki.net";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
export const REFERER = "https://kns.cnki.net/";
export const FORM_CONTENT_TYPE = "application/x-www-form-urlencoded; charset=UTF-8";

const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_REDIRECT_HOPS = 6;

export function assertAllowedUrl(input) {
  let url;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    fail(ERROR_CODES.INVALID_ARGUMENT, `not a valid URL: ${String(input).slice(0, 200)}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    fail(ERROR_CODES.HOST_NOT_ALLOWED, `refusing URL scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    fail(ERROR_CODES.HOST_NOT_ALLOWED, "refusing URL with embedded credentials");
  }
  const host = url.hostname.toLowerCase();
  if (host !== ALLOWED_HOST_SUFFIX.slice(1) && !host.endsWith(ALLOWED_HOST_SUFFIX)) {
    fail(ERROR_CODES.HOST_NOT_ALLOWED, `refusing host outside ${ALLOWED_HOST_SUFFIX}: ${host}`);
  }
  return url;
}

/**
 * The header set CNKICrawlerMCP puts on every crawler request (its colly
 * `OnRequest` hook), including the form content type on GET requests.
 * `cookie` may be empty for the login call.
 */
export function cnkiHeaders(cookie, extra = {}) {
  return {
    "Content-Type": FORM_CONTENT_TYPE,
    ...(cookie ? { Cookie: cookie } : {}),
    "User-Agent": USER_AGENT,
    Referer: REFERER,
    "Accept-Encoding": "gzip",
    ...extra,
  };
}

/** Case-insensitive header lookup over a plain object. */
export function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

function decodeBody(buffer, encoding) {
  const codec = String(encoding ?? "").trim().toLowerCase();
  try {
    if (codec === "gzip" || codec === "x-gzip") return gunzipSync(buffer);
    if (codec === "deflate") {
      try {
        return inflateSync(buffer);
      } catch {
        return inflateRawSync(buffer);
      }
    }
    if (codec === "br") return brotliDecompressSync(buffer);
  } catch (error) {
    throw new CnkiError(ERROR_CODES.HTTP_ERROR, `could not decode a ${codec}-encoded response: ${error.message}`);
  }
  return buffer;
}

/**
 * One HTTPS request without redirect following. Resolves with
 * `{ status, headers, setCookies, location, bodyText }`; `headers` values are
 * strings, `setCookies` keeps every Set-Cookie line, `location` is the raw
 * redirect target or null. Compressed bodies are decoded.
 */
export async function rawRequest({ url, method = "GET", headers = {}, body, timeoutMs = 20_000, signal }, { request } = {}) {
  const target = assertAllowedUrl(url);
  const send = request ?? ((...args) => https.request(...args));
  return await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CnkiError(ERROR_CODES.CANCELLED, "request cancelled"));
      return;
    }
    const req = send(
      target,
      {
        method,
        headers: {
          ...headers,
          ...(body !== undefined ? { "Content-Length": String(Buffer.byteLength(body)) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        let received = 0;
        res.on("data", (chunk) => {
          received += chunk.length;
          if (received > MAX_BODY_BYTES) {
            req.destroy(new Error("response body exceeds the 8 MiB limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          const flat = {};
          for (const [key, value] of Object.entries(res.headers)) {
            if (key === "set-cookie") continue;
            flat[key] = Array.isArray(value) ? value.join(", ") : value;
          }
          const setCookies = Array.isArray(res.headers["set-cookie"])
            ? res.headers["set-cookie"]
            : res.headers["set-cookie"]
              ? [res.headers["set-cookie"]]
              : [];
          let bodyText;
          try {
            bodyText = decodeBody(Buffer.concat(chunks), res.headers["content-encoding"]).toString("utf8");
          } catch (error) {
            reject(error);
            return;
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: flat,
            setCookies,
            location: typeof res.headers.location === "string" ? res.headers.location : null,
            bodyText,
          });
        });
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(new Error(`request timed out after ${timeoutMs} ms`)), timeoutMs);
    const onAbort = () => req.destroy(new CnkiError(ERROR_CODES.CANCELLED, "request cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(error instanceof CnkiError ? error : new CnkiError(ERROR_CODES.HTTP_ERROR, `${method} ${target.host} failed: ${error?.message ?? error}`, { url: String(url) }));
    });
    req.on("close", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** Merge cookie header strings and Set-Cookie lines into one `Cookie` value; later entries win. */
export function mergeCookieHeader(base, setCookies) {
  const jar = new Map();
  for (const pair of String(base ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    jar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  for (const line of setCookies ?? []) {
    const first = String(line).split(";", 1)[0];
    const separator = first.indexOf("=");
    if (separator <= 0) continue;
    const name = first.slice(0, separator).trim();
    if (name) jar.set(name, first.slice(separator + 1).trim());
  }
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

/**
 * One logical CNKI request as the Go crawler makes it: the standard header set
 * with the session cookie, redirects followed by hand within the allowlist
 * (at most `MAX_REDIRECT_HOPS`), cookies set by a hop carried to the next hop.
 * Resolves with `{ status, headers, bodyText, setCookies, finalUrl, hops }`
 * where `hops` lists every URL visited, the requested one first.
 * `followRedirects: false` returns the first response untouched (with `location`).
 */
export async function cnkiRequest(
  { url, method = "GET", cookie = "", body, extraHeaders = {}, followRedirects = true, timeoutMs, signal },
  { request } = {},
) {
  let current = assertAllowedUrl(url).toString();
  let currentMethod = method;
  let currentBody = body;
  let chainCookie = cookie;
  const hops = [current];
  const setCookies = [];
  for (let hop = 0; ; hop += 1) {
    const response = await rawRequest(
      { url: current, method: currentMethod, headers: cnkiHeaders(chainCookie, extraHeaders), body: currentBody, timeoutMs, signal },
      request ? { request } : undefined,
    );
    setCookies.push(...response.setCookies);
    const redirected = response.status >= 300 && response.status < 400 && response.location;
    if (!redirected || !followRedirects) {
      return { ...response, setCookies, finalUrl: current, hops };
    }
    if (hop >= MAX_REDIRECT_HOPS) {
      throw new CnkiError(ERROR_CODES.HTTP_ERROR, `too many redirects starting at ${url}`, { url: String(url), finalUrl: current });
    }
    current = assertAllowedUrl(new URL(response.location, current)).toString();
    hops.push(current);
    if (response.status !== 307 && response.status !== 308) {
      currentMethod = "GET";
      currentBody = undefined;
    }
    if (response.setCookies.length) chainCookie = mergeCookieHeader(chainCookie, response.setCookies);
  }
}

export function formEncode(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

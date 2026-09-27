import { request as httpsRequest } from "node:https";
import { URL } from "node:url";
import { CnkiError, fail, ERROR_CODES } from "./errors.mjs";

/**
 * HTTP for the CNKI tools.
 *
 * Two request paths exist on purpose:
 *
 * - `pi.net.fetch` (passed in as `fetchImpl`) carries the ordinary page and
 *   JSON requests. The host audits it and confines it to `manifest.net.domains`.
 * - `rawRequest` is a minimal `node:https` client for the two things the host
 *   fetch cannot express: reading every `Set-Cookie` header of the IP login
 *   response (the host flattens headers into one object, so only the last
 *   cookie would survive) and reading a redirect `Location` without following
 *   it (the host follows redirects and returns only the final body). It is
 *   confined to the same hosts as the manifest by `assertAllowedUrl`.
 */
export const ALLOWED_HOST_SUFFIX = ".cnki.net";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
export const REFERER = "https://kns.cnki.net/";

const MAX_BODY_BYTES = 8 * 1024 * 1024;

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

/** Standard CNKI browser-like headers; `cookie` may be empty for the login call. */
export function cnkiHeaders(cookie, extra = {}) {
  return {
    "User-Agent": USER_AGENT,
    Referer: REFERER,
    ...(cookie ? { Cookie: cookie } : {}),
    ...extra,
  };
}

/**
 * One HTTPS request without redirect following. Resolves with
 * `{ status, headers, setCookies, location, bodyText }`; `headers` values are
 * strings, `setCookies` keeps every Set-Cookie line, `location` is the raw
 * redirect target or null.
 */
export function rawRequest(
  { url, method = "GET", headers = {}, body, timeoutMs = 20_000, signal },
  { request = httpsRequest } = {},
) {
  const target = assertAllowedUrl(url);
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CnkiError(ERROR_CODES.CANCELLED, "request cancelled"));
      return;
    }
    const req = request(
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
          resolve({
            status: res.statusCode ?? 0,
            headers: flat,
            setCookies,
            location: typeof res.headers.location === "string" ? res.headers.location : null,
            bodyText: Buffer.concat(chunks).toString("utf8"),
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
      reject(error);
    });
    req.on("close", () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    });
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/**
 * Host-fetch adapter: same URL policy, same headers, returns the host shape
 * `{ status, headers, bodyText }`. `fetchImpl` is `pi.net.fetch`.
 */
export async function hostFetch(fetchImpl, { url, method = "GET", headers = {}, body, timeoutMs = 20_000 }) {
  assertAllowedUrl(url);
  const response = await fetchImpl({ url, method, headers, ...(body !== undefined ? { body } : {}), timeoutMs });
  if (!response || typeof response.status !== "number" || typeof response.bodyText !== "string") {
    fail(ERROR_CODES.HTTP_ERROR, `unexpected fetch result for ${url}`, { url });
  }
  return response;
}

/** Case-insensitive header lookup over a plain object. */
export function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

export function formEncode(fields) {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

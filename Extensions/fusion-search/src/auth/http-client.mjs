import { request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { URL } from "node:url";

/**
 * Minimal HTTP/1.1 client on node:http for the Fusion Search auth chain.
 * Every production request and redirect is restricted to an explicit origin.
 * Cookie storage follows host/path scope so auth cookies cannot cross to the
 * search service's different host.
 */
export const AUTH_ALLOWED_ORIGINS = Object.freeze([
  "http://10.160.47.100:19090",
  "http://10.160.47.100:6100",
  "http://10.160.28.16",
]);

const MAX_REDIRECTS = 8;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export class AuthHttpError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthHttpError";
    this.code = code;
    Object.assign(this, details);
  }
}

function allowedOrigin(origin, allowedOrigins) {
  if (Array.isArray(allowedOrigins)) return allowedOrigins.includes(origin);
  return allowedOrigins instanceof Set && allowedOrigins.has(origin);
}

export function assertAllowedUrl(input, allowedOrigins = AUTH_ALLOWED_ORIGINS) {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== "http:" || url.username || url.password) {
    throw new AuthHttpError("HOST_NOT_ALLOWED", `refusing URL outside the Fusion Search auth policy: ${url.protocol}`);
  }
  if (!allowedOrigin(url.origin, allowedOrigins)) {
    throw new AuthHttpError("HOST_NOT_ALLOWED", `refusing origin outside the Fusion Search auth allowlist: ${url.origin}`);
  }
  return url;
}

/** Case-insensitive first-value header lookup over a plain object. */
export function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === target) {
      return Array.isArray(value) ? value[0] : value;
    }
  }
  return undefined;
}

/** All values of one header name, in order; `set-cookie` needs every entry. */
export function headerValues(headers, name) {
  const target = name.toLowerCase();
  const values = [];
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== target) continue;
    if (Array.isArray(value)) values.push(...value);
    else if (value !== undefined) values.push(value);
  }
  return values;
}

function normalizedHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "");
}

function domainMatches(hostname, domain) {
  const host = normalizedHostname(hostname);
  const candidate = normalizedHostname(domain);
  if (host === candidate) return true;
  if (isIP(host) || isIP(candidate)) return false;
  return host.endsWith(`.${candidate}`);
}

function defaultCookiePath(pathname) {
  if (!pathname || pathname[0] !== "/" || pathname === "/") return "/";
  const lastSlash = pathname.lastIndexOf("/");
  return lastSlash <= 0 ? "/" : pathname.slice(0, lastSlash);
}

function pathMatches(requestPath, cookiePath) {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

function cookieIdentity(cookie) {
  return `${cookie.name}\u0000${cookie.domain}\u0000${cookie.path}`;
}

function parseCookie(line, responseUrl, nowMs) {
  const [pair, ...attributeParts] = String(line).split(";");
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const value = pair.slice(separator + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\u0000-\u0020\u007f;,]/.test(value)) {
    return null;
  }

  const attributes = new Map();
  for (const part of attributeParts) {
    const attributeSeparator = part.indexOf("=");
    const key = (attributeSeparator < 0 ? part : part.slice(0, attributeSeparator)).trim().toLowerCase();
    const attributeValue = attributeSeparator < 0 ? "" : part.slice(attributeSeparator + 1).trim();
    if (key) attributes.set(key, attributeValue);
  }

  let domain = normalizedHostname(responseUrl.hostname);
  let hostOnly = true;
  if (attributes.has("domain")) {
    const requestedDomain = normalizedHostname(attributes.get("domain").replace(/^\./, ""));
    if (!requestedDomain || !domainMatches(responseUrl.hostname, requestedDomain)) return null;
    domain = requestedDomain;
    hostOnly = false;
  }

  const requestedPath = attributes.get("path");
  const path = requestedPath?.startsWith("/") ? requestedPath : defaultCookiePath(responseUrl.pathname);
  let expiresAt = null;
  const maxAge = attributes.get("max-age");
  if (maxAge !== undefined && /^-?\d+$/.test(maxAge)) {
    const seconds = Number(maxAge);
    if (!Number.isSafeInteger(seconds)) return null;
    expiresAt = seconds <= 0 ? nowMs : nowMs + seconds * 1000;
  } else if (attributes.has("expires")) {
    const parsed = Date.parse(attributes.get("expires"));
    if (Number.isFinite(parsed)) expiresAt = parsed;
  }

  return {
    name,
    value,
    domain,
    hostOnly,
    path,
    secure: attributes.has("secure"),
    expiresAt,
  };
}

export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  /** Store Set-Cookie values against the URL that produced them. */
  storeFromResponse(headers, responseUrl, nowMs = Date.now()) {
    const url = responseUrl instanceof URL ? responseUrl : new URL(responseUrl);
    for (const line of headerValues(headers, "set-cookie")) {
      const cookie = parseCookie(line, url, nowMs);
      if (!cookie) continue;
      const key = cookieIdentity(cookie);
      if (cookie.expiresAt !== null && cookie.expiresAt <= nowMs) {
        this.cookies.delete(key);
      } else {
        this.cookies.set(key, cookie);
      }
    }
  }

  matching(requestUrl, nowMs = Date.now()) {
    const url = requestUrl instanceof URL ? requestUrl : new URL(requestUrl);
    const hostname = normalizedHostname(url.hostname);
    for (const [key, cookie] of this.cookies) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= nowMs) this.cookies.delete(key);
    }
    return [...this.cookies.values()]
      .filter((cookie) => {
        const domainMatchesRequest = cookie.hostOnly
          ? hostname === cookie.domain
          : domainMatches(hostname, cookie.domain);
        return domainMatchesRequest && pathMatches(url.pathname || "/", cookie.path) && (!cookie.secure || url.protocol === "https:");
      })
      .sort((left, right) => right.path.length - left.path.length);
  }

  header(requestUrl, nowMs = Date.now()) {
    const cookies = this.matching(requestUrl, nowMs);
    if (cookies.length === 0) return undefined;
    return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  }

  get(name, requestUrl, nowMs = Date.now()) {
    return this.matching(requestUrl, nowMs).find((cookie) => cookie.name === name)?.value;
  }

  clear() {
    this.cookies.clear();
  }
}

export function readBody(stream, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let settled = false;
    const chunks = [];
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => {
      const error = cancelledError();
      finish(reject, error);
      stream.destroy(error);
    };
    const onError = (error) => {
      finish(
        reject,
        error instanceof AuthHttpError
          ? error
          : signal?.aborted
            ? cancelledError()
            : new AuthHttpError("UPSTREAM_ERROR", `response stream failed: ${error.message}`),
      );
    };

    stream.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        finish(reject, new AuthHttpError("RESPONSE_TOO_LARGE", "response body exceeded the plugin's size budget"));
        stream.destroy();
        return;
      }
      chunks.push(chunk);
    });
    stream.on("end", () => finish(resolve, Buffer.concat(chunks).toString("utf8")));
    stream.on("error", onError);
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function isAborted(signal) {
  return Boolean(signal?.aborted);
}

function cancelledError() {
  return new AuthHttpError("CANCELLED", "request was cancelled");
}

function rawRequest(url, { method = "GET", headers = {}, body, timeoutMs = 20_000, signal, allowedOrigins }) {
  assertAllowedUrl(url, allowedOrigins);
  if (isAborted(signal)) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port || 80,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (res) => resolve(res),
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new AuthHttpError("UPSTREAM_TIMEOUT", `request timed out after ${timeoutMs}ms: ${url.host}${url.pathname}`));
    });
    req.on("error", (error) => {
      reject(error instanceof AuthHttpError ? error : new AuthHttpError("UPSTREAM_ERROR", `request failed: ${error.message}`));
    });
    if (signal) {
      const onAbort = () => req.destroy(cancelledError());
      signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => signal.removeEventListener("abort", onAbort));
      if (signal.aborted) onAbort();
    }
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function withoutHeaders(headers, excludedNames) {
  const excluded = new Set(excludedNames.map((name) => name.toLowerCase()));
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name.toLowerCase())));
}

/**
 * One GET/POST with manual redirects. Returns the final URL where the OAuth
 * code lives. The allowlist is checked before every request, and cookies are
 * selected for each individual redirect target.
 */
export async function authFetch(rawUrl, options = {}) {
  const {
    method: initialMethod = "GET",
    headers: initialHeaders = {},
    body: initialBody,
    jar,
    timeoutMs = 20_000,
    signal,
    maxRedirects = MAX_REDIRECTS,
    allowedOrigins = AUTH_ALLOWED_ORIGINS,
  } = options;

  let url = assertAllowedUrl(rawUrl, allowedOrigins);
  let method = initialMethod;
  let body = initialBody;
  let headers = { ...initialHeaders };

  for (let hop = 0; ; hop += 1) {
    if (isAborted(signal)) throw cancelledError();
    let requestHeaders = { ...headers };
    if (body !== undefined && headerValue(requestHeaders, "content-type") === undefined) {
      requestHeaders["Content-Type"] = "application/json";
    }
    requestHeaders = withoutHeaders(requestHeaders, ["cookie"]);
    const cookie = jar?.header(url);
    if (cookie) requestHeaders.Cookie = cookie;

    const res = await rawRequest(url, { method, headers: requestHeaders, body, timeoutMs, signal, allowedOrigins });
    if (jar) jar.storeFromResponse(res.headers, url);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status <= 399) {
      const location = headerValue(res.headers, "location");
      if (location) {
        if (hop >= maxRedirects) {
          res.destroy();
          throw new AuthHttpError("TOO_MANY_REDIRECTS", `redirect limit exceeded (${maxRedirects})`);
        }
        await readBody(res, MAX_BODY_BYTES, signal).catch((error) => {
          if (error?.code === "CANCELLED") throw error;
        });
        const nextUrl = assertAllowedUrl(new URL(location, url), allowedOrigins);
        const crossOrigin = nextUrl.origin !== url.origin;
        let nextHeaders = { ...headers };
        if (status !== 307 && status !== 308) {
          method = "GET";
          body = undefined;
          nextHeaders = withoutHeaders(nextHeaders, ["content-type", "content-length", "transfer-encoding"]);
        }
        if (crossOrigin) {
          nextHeaders = withoutHeaders(nextHeaders, ["authorization", "proxy-authorization", "cookie"]);
        }
        headers = nextHeaders;
        url = nextUrl;
        continue;
      }
    }
    const responseHeaders = {};
    for (const [key, value] of Object.entries(res.headers)) {
      responseHeaders[key] = value;
    }
    return {
      status,
      url: url.toString(),
      headers: responseHeaders,
      bodyText: await readBody(res, MAX_BODY_BYTES, signal),
    };
  }
}

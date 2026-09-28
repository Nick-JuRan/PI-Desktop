import { rawRequest, cnkiHeaders } from "./http.mjs";
import { CnkiError, ERROR_CODES } from "./errors.mjs";

/**
 * CNKI session cookie, obtained without any user-facing tool.
 *
 * Order of precedence:
 * 1. `cookie` in the plugin's private settings file — a manual override for
 *    networks outside the CNKI IP whitelist. Never declared in
 *    `contributes.settings`, so it is never shown in the Settings UI.
 * 2. IP login: `POST https://login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo`
 *    with an empty JSON body, as CNKICrawlerMCP does it. CNKI answers with
 *    `IsSuccess` (the body may be wrapped in parentheses) and several
 *    `Set-Cookie` headers; the cookie header is the sorted `name=value` join
 *    of all of them and is sent verbatim on every later request.
 *
 * The manager logs in once, keeps the cookie in memory, dedupes concurrent
 * logins, and re-logs in when a tool reports `COOKIE_EXPIRED`. The plugin
 * starts the first login at load time so the first tool call finds it ready.
 */
export const IP_LOGIN_URL = "https://login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo";

export function parseSetCookie(line) {
  const first = String(line).split(";", 1)[0];
  const separator = first.indexOf("=");
  if (separator <= 0) return null;
  const name = first.slice(0, separator).trim();
  const value = first.slice(separator + 1).trim();
  if (!name) return null;
  return { name, value };
}

export function buildCookieHeader(setCookies) {
  const jar = new Map();
  for (const line of setCookies ?? []) {
    const parsed = parseSetCookie(line);
    if (parsed) jar.set(parsed.name, parsed.value);
  }
  return [...jar.keys()]
    .sort()
    .map((name) => `${name}=${jar.get(name)}`)
    .join("; ");
}

/** CNKI wraps some JSON answers in parentheses; tolerate both forms. */
export function parseLoginBody(bodyText) {
  const trimmed = String(bodyText ?? "").trim().replace(/^\(+/, "").replace(/\)+;?$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export async function ipLogin({ request, throttle, signal } = {}) {
  await throttle?.waitTurn(signal);
  let response;
  try {
    response = await rawRequest(
      {
        url: IP_LOGIN_URL,
        method: "POST",
        headers: cnkiHeaders("", { "Content-Type": "application/json" }),
        body: "{}",
        signal,
      },
      request ? { request } : undefined,
    );
  } catch (error) {
    if (error instanceof CnkiError) throw error;
    throw new CnkiError(ERROR_CODES.LOGIN_FAILED, `IP login request failed: ${error?.message ?? error}`, {
      url: IP_LOGIN_URL,
    });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new CnkiError(ERROR_CODES.LOGIN_FAILED, `IP login returned HTTP ${response.status}`, {
      url: IP_LOGIN_URL,
      status: response.status,
    });
  }
  const payload = parseLoginBody(response.bodyText);
  if (!payload || payload.IsSuccess !== true) {
    const reason = payload?.ErrorMsg || payload?.Msg || "IsSuccess was not true";
    throw new CnkiError(
      ERROR_CODES.LOGIN_FAILED,
      `IP login was rejected (${reason}). This network is probably not on the CNKI IP whitelist; set a cookie in the plugin settings file instead.`,
      { url: IP_LOGIN_URL, status: response.status },
    );
  }
  const cookie = buildCookieHeader(response.setCookies);
  if (!cookie) {
    throw new CnkiError(ERROR_CODES.LOGIN_FAILED, "IP login succeeded but set no cookies", {
      url: IP_LOGIN_URL,
    });
  }
  return { cookie, user: typeof payload.ShowName === "string" ? payload.ShowName : payload.UserName ?? "" };
}

export function createCookieManager({ readSettings, request, throttle, log = () => {} }) {
  let cookie = "";
  let source = "";
  let inFlight = null;

  async function overrideFromSettings() {
    if (!readSettings) return "";
    try {
      const settings = await readSettings();
      const value = typeof settings?.cookie === "string" ? settings.cookie.trim() : "";
      return value;
    } catch (error) {
      log(`settings unavailable, falling back to IP login: ${error?.message ?? error}`);
      return "";
    }
  }

  async function login(signal) {
    const override = await overrideFromSettings();
    if (override) {
      cookie = override;
      source = "settings";
      log("using the cookie from the plugin settings file");
      return cookie;
    }
    const result = await ipLogin({ request, throttle, signal });
    cookie = result.cookie;
    source = "ip-login";
    log(`IP login succeeded${result.user ? ` as ${result.user}` : ""}`);
    return cookie;
  }

  function refresh(signal) {
    if (!inFlight) {
      inFlight = login(signal).finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  return {
    /** The current cookie, logging in first when none is held yet. */
    async ensure(signal) {
      if (cookie) return cookie;
      return refresh(signal);
    },
    /** Force a new login (after a COOKIE_EXPIRED page) and return the cookie. */
    refresh,
    /** Start a login in the background; errors are logged, never thrown. */
    warmUp() {
      refresh().catch((error) => log(`cookie warm-up failed: ${error?.message ?? error}`));
    },
    get source() {
      return source;
    },
    dispose() {
      cookie = "";
      source = "";
    },
  };
}

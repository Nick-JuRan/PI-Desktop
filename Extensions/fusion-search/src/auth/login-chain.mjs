import { randomUUID } from "node:crypto";
import { aesEcbEncryptBase64, aesCbcEncryptBase64, b64encode } from "./crypto.mjs";
import { authFetch, CookieJar, AuthHttpError } from "./http-client.mjs";
import { locateSliderNotch, sliderJudgePayload } from "./slider.mjs";

/**
 * Port of the legacy auth_http_login.py chain, in the same order:
 *   GET  /am/ + /isLogin            (session warm-up; hands out k/i cookies)
 *   GET  /validate/behavior/{id}    (slider challenge)
 *   POST /validate/behavior/judge   (AES-encrypted notch answer)
 *   POST /oauth/login               (AES-CBC-encrypted credentials, multipart)
 *   POST searchlogin                (discover the OAuth authorize URL)
 *   GET  authorize chain -> uniLogin?code=...   (manual redirects, final URL)
 *   POST aoeeas {code}              (exchange the code for the JWT)
 *
 * The legacy script submits one slider attempt; this port retries a rejected
 * notch a few times before giving up, because the luminance heuristic is not
 * guaranteed per-challenge.
 */

export const AUTH_SERVER = "http://10.160.47.100:19090";
export const AUTHORIZE_SERVER = "http://10.160.47.100:6100";
export const SEARCH_SERVER = "http://10.160.28.16";

const DEVICE_KEY = "C661489473A6FBD1F427BF252ECB7344";
const MAX_SLIDER_ATTEMPTS = 4;

/** quote(value, safe="-_.!~*'()") — JS encodeURIComponent plus those chars. */
function jsComponent(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*~_.-]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function asciiB64(value) {
  return b64encode(Buffer.from(String(value), "ascii"));
}

export function makeDeviceId(username) {
  const encrypted = aesEcbEncryptBase64(`${username}${randomUUID()}`, DEVICE_KEY);
  // The legacy page URL-encodes the base64 for a query parameter.
  return encodeURIComponent(asciiB64(encrypted));
}

function requireOk(data, what) {
  if (data && typeof data === "object" && data.code === 0) return data;
  const message = data?.message ?? data?.repMsg ?? JSON.stringify(data).slice(0, 200);
  throw new AuthHttpError("AUTH_STEP_FAILED", `${what} failed: ${message}`);
}

async function fetchJson(promise) {
  const response = await promise;
  let data;
  try {
    data = JSON.parse(response.bodyText);
  } catch {
    throw new AuthHttpError("AUTH_PROTOCOL_ERROR", `auth endpoint returned non-JSON content (HTTP ${response.status})`);
  }
  return { response, data };
}

/**
 * Run the full login chain and return the raw JWT string.
 *
 * `credentials` is { username, password }. `allowedOrigins` and `servers` exist so
 * tests can point the chain at a local fake; production calls leave them
 * undefined and the frozen allowlist and real server addresses apply.
 * `locateNotch` and `authorizeUrlOverride` are test seams too.
 */
export async function loginForToken({
  credentials,
  signal,
  allowedOrigins,
  servers,
  locateNotch = locateSliderNotch,
  authorizeUrlOverride,
  maxSliderAttempts = MAX_SLIDER_ATTEMPTS,
} = {}) {
  const authServer = servers?.authServer ?? AUTH_SERVER;
  const authorizeServer = servers?.authorizeServer ?? AUTHORIZE_SERVER;
  const searchServer = servers?.searchServer ?? SEARCH_SERVER;

  const getChallenge = async ({ jar, signal: challengeSignal }, username) => {
    const deviceId = makeDeviceId(username);
    const { data } = await fetchJson(
      authFetch(`${authServer}/validate/behavior/${deviceId}?t=${Date.now()}`, {
        jar,
        timeoutMs: 15_000,
        signal: challengeSignal,
        allowedOrigins,
      }),
    );
    requireOk(data, "captcha init");
    const result = data.result;
    if (!result?.originalImageBase64 || !result?.jigsawImageBase64 || !result?.secretKey) {
      throw new AuthHttpError("AUTH_PROTOCOL_ERROR", "captcha init returned an incomplete challenge");
    }
    return { deviceId, challenge: result };
  };

  const username = String(credentials?.username ?? "").trim();
  const password = String(credentials?.password ?? "");
  if (!username || !password) {
    throw new AuthHttpError("AUTH_CONFIG_MISSING", "username and password are required in the plugin settings file");
  }

  const jar = new CookieJar();
  const options = { jar, signal, allowedOrigins };

  // Warm up: the auth page sets the k/i cookies these two GETs answer with.
  await authFetch(`${authServer}/am/`, { ...options, timeoutMs: 15_000 });
  // k/i are read by the client to encrypt loginText; the auth server scopes
  // them to /am, so they must not be attached to the separate login request.
  const challengeBootstrapUrl = `${authServer}/am/`;
  const key = jar.get("k", challengeBootstrapUrl);
  const iv = jar.get("i", challengeBootstrapUrl);
  if (!key || !iv || key.length !== 16 || iv.length !== 16) {
    throw new AuthHttpError("AUTH_PROTOCOL_ERROR", "the auth page did not hand out valid k/i cookies");
  }
  await authFetch(`${authServer}/isLogin?t=${Date.now()}`, { ...options, timeoutMs: 15_000 });

  let loginOk = false;
  let verifiedDeviceId = "";
  let lastCaptchaError = null;
  for (let attempt = 1; attempt <= maxSliderAttempts; attempt += 1) {
    const { deviceId, challenge } = await getChallenge(options, username);
    let notch;
    try {
      notch = locateNotch(challenge.originalImageBase64, challenge.jigsawImageBase64);
    } catch (error) {
      throw new AuthHttpError("AUTH_CAPTCHA_INVALID", `captcha image was not decodable: ${error.message}`);
    }
    const point = sliderJudgePayload(notch, challenge.secretKey);
    const { data: judgeData } = await fetchJson(
      authFetch(`${authServer}/validate/behavior/judge`, {
        ...options,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, point }),
        timeoutMs: 15_000,
      }),
    );
    if (judgeData && judgeData.code === 0) {
      loginOk = true;
      // The legacy page logs in with the same device id the captcha verified.
      verifiedDeviceId = deviceId;
      break;
    }
    lastCaptchaError = judgeData?.message ?? judgeData?.repMsg ?? "rejected";
  }
  if (!loginOk) {
    throw new AuthHttpError("AUTH_CAPTCHA_REJECTED", `slider captcha was rejected after ${maxSliderAttempts} attempts: ${lastCaptchaError}`);
  }

  // Login: AES-CBC-encrypted fields in the order the legacy page posts them.
  const fields = [
    `username=${asciiB64(jsComponent(username))}`,
    `password=${asciiB64(jsComponent(password))}`,
    `deviceId=${verifiedDeviceId}`,
    "loginMethod=CODE",
    `time=${Date.now()}`,
  ];
  const loginText = aesCbcEncryptBase64(fields.join("&"), key, iv);
  const boundary = `----pi${randomUUID().replace(/-/g, "")}`;
  const multipart = [
    `--${boundary}\r\nContent-Disposition: form-data; name="loginText"\r\n\r\n${loginText}\r\n`,
    `--${boundary}\r\nContent-Disposition: form-data; name="key"\r\n\r\nundefined\r\n`,
    `--${boundary}--\r\n`,
  ].join("");
  const { data: loginData } = await fetchJson(
    authFetch(`${authServer}/oauth/login`, {
      ...options,
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
      body: multipart,
      timeoutMs: 20_000,
    }),
  );
  requireOk(loginData, "login");

  // OAuth authorize URL discovery, with the legacy hardcoded fallback.
  let authorizeUrl = authorizeUrlOverride ??
    `${authorizeServer}/oauth/authorize?response_type=code&scope=openid&client_id=neusipo&redirect_uri=${encodeURIComponent(`${searchServer}/uniLogin`)}`;
  if (!authorizeUrlOverride) {
    try {
      const { data: searchLogin } = await fetchJson(
        authFetch(`${searchServer}/api/gateway/newauth/searchlogin`, {
          ...options,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ param: "" }),
          timeoutMs: 15_000,
        }),
      );
      if (searchLogin?.data?.url) authorizeUrl = searchLogin.data.url;
    } catch {
      // keep the fallback URL
    }
  }

  // If login answered with a redirect target, visit it first.
  const redirect = loginData?.result;
  if (typeof redirect === "string" && /^https?:\/\//.test(redirect)) {
    await authFetch(redirect, { ...options, timeoutMs: 20_000 });
  }

  // The chain lands on uniLogin?code=...; the code lives in the final URL.
  const authorizeResponse = await authFetch(authorizeUrl, { ...options, timeoutMs: 30_000 });
  const code = new URL(authorizeResponse.url).searchParams.get("code");
  if (!code) {
    throw new AuthHttpError("AUTH_PROTOCOL_ERROR", "the OAuth authorize chain did not return a code");
  }

  const { data: exchangeData } = await fetchJson(
    authFetch(`${searchServer}/api/gateway/newauth/aoeeas`, {
      ...options,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, param: "" }),
      timeoutMs: 20_000,
    }),
  );
  const token = exchangeData?.data;
  if (typeof token !== "string" || !token) {
    throw new AuthHttpError("AUTH_STEP_FAILED", `token exchange failed: ${exchangeData?.message ?? "no token in response"}`);
  }
  return token;
}

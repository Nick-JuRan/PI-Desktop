import { loginForToken } from "./auth/login-chain.mjs";
import { jwtExpiry } from "./auth/crypto.mjs";
import {
  readSettings,
  readCredentials,
  readStoredToken,
  normalizeAuthorizationHeader,
  persistToken,
} from "./settings-store.mjs";

/** Refresh when less than this many seconds remain. */
export const TOKEN_REFRESH_MARGIN_S = 30 * 60;

export function tokenNeedsRefresh(token, { nowMs = Date.now(), marginS = TOKEN_REFRESH_MARGIN_S } = {}) {
  const exp = jwtExpiry(token);
  if (exp === null) return true;
  return exp * 1000 - nowMs < marginS * 1000;
}

function cancelledError(message = "Fusion Search authentication was cancelled.") {
  return Object.assign(new Error(message), { code: "CANCELLED" });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw cancelledError();
}

function waitForFlight(flight, signal) {
  if (signal?.aborted) return Promise.reject(cancelledError());
  flight.waiters += 1;
  return new Promise((resolve, reject) => {
    let active = true;
    const finish = () => {
      if (!active) return false;
      active = false;
      flight.waiters -= 1;
      signal?.removeEventListener("abort", onAbort);
      if (flight.waiters === 0 && !flight.settled) flight.controller.abort();
      return true;
    };
    const onAbort = () => {
      if (finish()) reject(cancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    flight.promise.then(
      (value) => { if (finish()) resolve(value); },
      (error) => { if (finish()) reject(error); },
    );
  });
}

export function createTokenManager({
  pi,
  login = loginForToken,
  persist = persistToken,
  marginS = TOKEN_REFRESH_MARGIN_S,
} = {}) {
  let inFlight = null;
  let disposed = false;
  let lastIssuedToken = null;

  function assertActive(signal) {
    if (disposed) throw Object.assign(new Error("Fusion Search token manager has been unloaded."), { code: "PLUGIN_UNLOADED" });
    throwIfAborted(signal);
  }

  async function runLogin(signal) {
    assertActive(signal);
    const settings = await readSettings(pi);
    assertActive(signal);
    const credentials = readCredentials(settings);
    if (!credentials) {
      throw Object.assign(
        new Error(
          "Fusion Search credentials are missing. Put {\"username\": ..., \"password\": ...} in the plugin data directory settings.json",
        ),
        { code: "AUTH_CONFIG_MISSING" },
      );
    }
    const token = await login({ credentials, signal });
    assertActive(signal);
    await persist(pi, token);
    lastIssuedToken = token;
    return token;
  }

  function startFlight(signal) {
    const controller = new AbortController();
    const flight = { controller, waiters: 0, settled: false, promise: null };
    inFlight = flight;
    flight.promise = runLogin(controller.signal).then(
      (token) => {
        flight.settled = true;
        if (inFlight === flight) inFlight = null;
        return token;
      },
      (error) => {
        flight.settled = true;
        if (inFlight === flight) inFlight = null;
        throw error;
      },
    );
    return waitForFlight(flight, signal);
  }

  function loginOnce(signal) {
    if (!inFlight || inFlight.controller.signal.aborted) return startFlight(signal);
    return waitForFlight(inFlight, signal);
  }

  return {
    /** Authorization header value for one tool call. */
    async authorization({ signal } = {}) {
      assertActive(signal);
      const settings = await readSettings(pi);
      assertActive(signal);
      const stored = readStoredToken(settings);
      if (stored && !tokenNeedsRefresh(stored, { marginS })) {
        return { authorization: normalizeAuthorizationHeader(stored) };
      }
      const token = await loginOnce(signal);
      assertActive(signal);
      return { authorization: normalizeAuthorizationHeader(token) };
    },

    /**
     * Refresh after an auth rejection. If another request already replaced the
     * exact token that received the delayed 401, reuse the stored replacement.
     */
    async refresh({ signal, rejectedAuthorization } = {}) {
      assertActive(signal);
      if (rejectedAuthorization) {
        const settings = await readSettings(pi);
        assertActive(signal);
        const stored = readStoredToken(settings);
        if (
          stored &&
          !tokenNeedsRefresh(stored, { marginS }) &&
          normalizeAuthorizationHeader(stored) !== rejectedAuthorization
        ) {
          return { authorization: normalizeAuthorizationHeader(stored) };
        }
        if (
          lastIssuedToken &&
          !tokenNeedsRefresh(lastIssuedToken, { marginS }) &&
          normalizeAuthorizationHeader(lastIssuedToken) !== rejectedAuthorization
        ) {
          return { authorization: normalizeAuthorizationHeader(lastIssuedToken) };
        }
      }
      const token = await loginOnce(signal);
      assertActive(signal);
      return { authorization: normalizeAuthorizationHeader(token) };
    },

    /** Abort a shared login when the plugin is unloaded. */
    dispose() {
      disposed = true;
      if (inFlight && !inFlight.settled) inFlight.controller.abort();
    },
  };
}

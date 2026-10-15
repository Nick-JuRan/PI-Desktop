import { fail, toErrorResult } from "./errors.mjs";
import { parseFullTextHtml, renderFullText } from "./full-text-html.mjs";

export const FUSION_FULL_TEXT_BASE_URL = "http://10.160.28.16/api";
/** The quick-view page the deployment expects as the referrer of this call. */
export const FUSION_FULL_TEXT_REFERER = "http://10.160.28.16/quickView";
export const FUSION_FULL_TEXT_ENDPOINT = "/neusipo-app-view/fastFullText/queryFullText";
/** Whole documents take longer than a result page; stay inside the 110 s plugin budget. */
export const FUSION_FULL_TEXT_TIMEOUT_MS = 60_000;
/**
 * Upper bound for the caller's pnId. The listed value is the provider's own
 * `;`-joined family list; a 15-member family already runs ~210 characters, so
 * the cap only stops pathological input, never a real result row.
 */
export const FUSION_FULL_TEXT_MAX_PNID_LENGTH = 1000;
/**
 * Safety valve, not a reading window. Chinese patents run 5k–60k characters;
 * only a pathological response reaches this, and then the text ends with a
 * note instead of the provider request failing on context size.
 */
export const FUSION_FULL_TEXT_MAX_CHARS = 300_000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeInput(args) {
  if (!isObject(args)) fail("INVALID_INPUT", "tool arguments must be an object");
  if (Object.keys(args).some((key) => key !== "pnId")) {
    fail("INVALID_INPUT", "only pnId is accepted");
  }
  if (typeof args.pnId !== "string") fail("INVALID_INPUT", "pnId must be a string");
  const pnId = args.pnId.trim();
  if (!pnId || pnId.length > FUSION_FULL_TEXT_MAX_PNID_LENGTH) {
    fail("INVALID_INPUT", `pnId must contain 1 to ${FUSION_FULL_TEXT_MAX_PNID_LENGTH} characters`);
  }
  return { pnId };
}

export function validateFullTextInput(args) {
  try {
    normalizeInput(args);
    return null;
  } catch (error) {
    return toErrorResult(error);
  }
}

/** Provider payload; empty strings are what the original SDK sent for unknowns. */
export function fullTextPayload({ pnId, anId = "", database = "" }) {
  return {
    anid: anId,
    pnid: pnId,
    source: "GENERAL",
    patType: "PATENT",
    viewDb: database,
  };
}

function parseEnvelope(response) {
  if (!isObject(response) || typeof response.status !== "number") {
    fail("REMOTE_RESPONSE_INVALID", "The Fusion Search transport returned an invalid response", {
      endpoint: FUSION_FULL_TEXT_ENDPOINT,
    });
  }
  if (response.status === 401 || response.status === 403) {
    fail("REMOTE_AUTH_REJECTED", `Fusion Search rejected the current token (HTTP ${response.status})`, {
      endpoint: FUSION_FULL_TEXT_ENDPOINT,
      status: response.status,
    });
  }
  if (response.status >= 400) {
    fail("REMOTE_HTTP_ERROR", `${FUSION_FULL_TEXT_ENDPOINT} returned HTTP ${response.status}`, {
      endpoint: FUSION_FULL_TEXT_ENDPOINT,
      status: response.status,
    });
  }
  let envelope;
  try {
    envelope = JSON.parse(String(response.bodyText ?? ""));
  } catch {
    fail("REMOTE_RESPONSE_INVALID", "The Fusion Search full-text response was not JSON", {
      endpoint: FUSION_FULL_TEXT_ENDPOINT,
      status: response.status,
    });
  }
  if (!isObject(envelope)) {
    fail("REMOTE_RESPONSE_INVALID", "The Fusion Search full-text envelope was invalid", {
      endpoint: FUSION_FULL_TEXT_ENDPOINT,
      status: response.status,
    });
  }
  if (Number(envelope.status) !== 200) {
    fail("REMOTE_API_ERROR", String(envelope.message ?? "Fusion Search full-text request failed"), {
      endpoint: FUSION_FULL_TEXT_ENDPOINT,
      status: envelope.status,
    });
  }
  return envelope;
}

/**
 * The provider answers a record it has not indexed with status 200, `t: null`
 * and the reason only in `message`. That is "not available", never "bad
 * arguments", so the message is handed back as the error text.
 */
function unavailable(envelope) {
  const reason = String(envelope.message ?? "").trim();
  return {
    code: "FULL_TEXT_UNAVAILABLE",
    message: reason || "The quick-view store has no readable full text for this record.",
  };
}

export function createFusionFullTextApi({
  fetchImpl,
  authorization,
  baseUrl = FUSION_FULL_TEXT_BASE_URL,
  referer = FUSION_FULL_TEXT_REFERER,
  timeoutMs = FUSION_FULL_TEXT_TIMEOUT_MS,
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!String(authorization ?? "").trim()) {
    fail("AUTH_MISSING", "an authorization header is required before calling the Fusion Search API");
  }
  const normalizedBase = String(baseUrl).replace(/\/+$/u, "");

  return {
    /**
     * One quick-view request. Resolves to `{ html }` or `{ unavailable }`;
     * transport and envelope failures throw.
     */
    async fullText({ pnId, anId = "", database = "", sessionId = "" }) {
      if (signal?.aborted) fail("CANCELLED", "The full-text request was cancelled");
      const headers = {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: authorization,
        Referer: referer,
        "User-Agent": "fusion-search-plugin/0.5",
      };
      if (sessionId) headers.ssid = sessionId;
      let response;
      try {
        response = await fetchImpl({
          url: `${normalizedBase}${FUSION_FULL_TEXT_ENDPOINT}`,
          method: "POST",
          headers,
          body: JSON.stringify(fullTextPayload({ pnId, anId, database })),
          timeoutMs,
        });
      } catch (error) {
        if (signal?.aborted) fail("CANCELLED", "The full-text request was cancelled");
        throw error;
      }
      if (signal?.aborted) fail("CANCELLED", "The full-text request was cancelled");
      const envelope = parseEnvelope(response);
      const data = envelope.t;
      const html = isObject(data) ? data.fullTextHtml ?? data.full_text_html : undefined;
      if (typeof html !== "string" || !html.trim()) return { unavailable: unavailable(envelope) };
      return { html };
    },
  };
}

/** First member of a provider `;`-joined identifier list. */
function firstMember(value) {
  return String(value ?? "").split(";")[0].trim();
}

/**
 * Identities to try, in order, in the shapes the quick-view endpoint accepts.
 *
 * The endpoint resolves one identity per request: a single application number
 * (with the merged publication list alongside), or a single publication number
 * with no application number. A `;`-joined application number or a `;`-joined
 * publication number with an empty application number is answered with
 * "未检索到收录的文献！" even when the record has full text — verified live
 * against the deployment. The web QuickView page sends the same first shape.
 *
 * The web app derives the application number by taking the first `;` member of
 * the listed value, so the first candidate mirrors that. The second candidate
 * falls back to the first publication member alone, which the endpoint also
 * accepts; it also covers records whose stored application number is wrong or
 * empty.
 */
function identityCandidates(pnId, record) {
  const candidates = [];
  const anId = firstMember(record?.anId);
  const database = record?.database ?? "";
  const sessionId = record?.sessionId ?? "";
  if (anId) candidates.push({ pnId, anId, database, sessionId });
  candidates.push({ pnId: firstMember(pnId), anId: "", database, sessionId });
  return candidates;
}

/**
 * Read one patent's full text. Returns the reading text as a plain string on
 * success and the plugin's uniform `{ ok: false, error }` object otherwise.
 */
export async function executeFullText({
  args,
  authorization,
  fetchImpl,
  api,
  registry,
  signal,
  maxChars = FUSION_FULL_TEXT_MAX_CHARS,
} = {}) {
  try {
    const { pnId } = normalizeInput(args);
    const client = api ?? createFusionFullTextApi({ fetchImpl, authorization, signal });
    const record = registry?.resolve(pnId) ?? null;
    // The provider's own value (`CN1A;CN1B`) is what the original SDK sent; an
    // agent that typed one member still gets the record it saw listed.
    const requestPnId = record?.pnId || pnId;
    let unavailableReason = null;
    for (const candidate of identityCandidates(requestPnId, record)) {
      const result = await client.fullText(candidate);
      if (result.unavailable) {
        unavailableReason = result.unavailable;
        continue;
      }
      const document = parseFullTextHtml(result.html);
      if (document.claims.length === 0 && document.paragraphs.length === 0) {
        fail("FULL_TEXT_UNPARSED", "The full-text response contained no claim or description cells", {
          endpoint: FUSION_FULL_TEXT_ENDPOINT,
        });
      }
      return renderFullText({
        pnId: requestPnId,
        title: record?.title ?? "",
        claims: document.claims,
        paragraphs: document.paragraphs,
        maxChars,
      });
    }
    fail(unavailableReason.code, unavailableReason.message, { endpoint: FUSION_FULL_TEXT_ENDPOINT });
  } catch (error) {
    return toErrorResult(error);
  }
}

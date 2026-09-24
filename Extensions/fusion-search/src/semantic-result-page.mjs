import { fail, toErrorResult } from "./errors.mjs";

export const FUSION_RESULT_PAGE_BASE_URL = "http://10.160.28.16/api";
export const FUSION_RESULT_PAGE_TIMEOUT_MS = 25_000;
export const FUSION_RESULT_PAGE_SIZE = 20;
export const FUSION_RESULT_PAGE_MAX_SESSION_ID_LENGTH = 256;

export const FUSION_RESULT_PAGE_ENDPOINT = "/neusipo-app-search/fusionResult/results";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeInput(args) {
  if (!isObject(args)) fail("INVALID_INPUT", "tool arguments must be an object");
  if (Object.keys(args).some((key) => !["session_id", "page"].includes(key))) {
    fail("INVALID_INPUT", "only session_id and page are accepted");
  }
  if (typeof args.session_id !== "string") fail("INVALID_INPUT", "session_id must be a string");
  const sessionId = args.session_id.trim();
  if (!sessionId || sessionId.length > FUSION_RESULT_PAGE_MAX_SESSION_ID_LENGTH) {
    fail("INVALID_INPUT", `session_id must contain 1 to ${FUSION_RESULT_PAGE_MAX_SESSION_ID_LENGTH} characters`);
  }
  if (typeof args.page !== "number" || !Number.isSafeInteger(args.page) || args.page < 1) {
    fail("INVALID_INPUT", "page must be a positive integer");
  }
  const start = (args.page - 1) * FUSION_RESULT_PAGE_SIZE;
  if (!Number.isSafeInteger(start)) fail("INVALID_INPUT", "page is too large");
  return { sessionId, page: args.page, start };
}

export function validateSemanticResultPageInput(args) {
  try {
    normalizeInput(args);
    return null;
  } catch (error) {
    return toErrorResult(error);
  }
}

function parseCount(value, field) {
  const result = typeof value === "number"
    ? value
    : typeof value === "string" && /^\d+$/u.test(value)
      ? Number(value)
      : null;
  if (!Number.isSafeInteger(result) || result < 0) {
    fail("REMOTE_RESPONSE_INVALID", `${field} was not a valid non-negative integer`, {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  return result;
}

function parseFiniteNumber(value, field) {
  const result = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(result)) {
    fail("SEMANTIC_SORT_UNAVAILABLE", `A result is missing its numeric ${field} semantic-sort value`, {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  return result;
}

const HTML_ENTITIES = Object.freeze({
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  deg: "°",
  divide: "÷",
  emsp: " ",
  ensp: " ",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  micro: "µ",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  plusmn: "±",
  quot: "\"",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  thinsp: " ",
  times: "×",
  trade: "™",
});

function decodeHtmlEntities(value) {
  let text = value;
  for (let pass = 0; pass < 2; pass += 1) {
    const decoded = text.replace(/&(#(?:x[\da-f]+|\d+)|[a-z][a-z0-9]+);/giu, (entity, name) => {
      const normalizedName = name.toLowerCase();
      if (normalizedName.startsWith("#")) {
        const hexadecimal = normalizedName.startsWith("#x");
        const codePoint = Number.parseInt(normalizedName.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff
          || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return "\uFFFD";
        return String.fromCodePoint(codePoint);
      }
      return HTML_ENTITIES[normalizedName] ?? entity;
    });
    if (decoded === text) break;
    text = decoded;
  }
  return text;
}

function cleanMarkup(value) {
  if (value === null || value === undefined) return "";
  const text = decodeHtmlEntities(String(value)
    .replace(/<\?xml\b[\s\S]*?\?>/giu, "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/giu, "$1")
    .replace(/<!--[\s\S]*?-->/gu, ""))
    .replace(/<br\b[^>]*\/?\s*>/giu, "\n")
    .replace(/<hr\b[^>]*\/?\s*>/giu, "\n")
    .replace(/<\/?(?:address|article|blockquote|dd|div|dl|dt|figcaption|figure|h[1-6]|li|ol|p|pre|section|table|tbody|tfoot|thead|tr|ul)\b[^>]*>/giu, "\n")
    .replace(/<\/?(?:td|th)\b[^>]*>/giu, " ")
    .replace(/<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*?)?\s*\/?>/giu, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t\f\v]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{2,}/gu, "\n")
    .trim();
  return text;
}

function firstDetailText(value) {
  const entries = Array.isArray(value) ? value : [value];
  for (const entry of entries) {
    if (typeof entry === "string" || typeof entry === "number") {
      const text = cleanMarkup(entry);
      if (text) return text;
      continue;
    }
    if (!isObject(entry)) continue;
    const rawText = entry.value ?? entry.text ?? entry.content ?? entry.textContent;
    const text = cleanMarkup(rawText);
    if (text) return text;
  }
  return "";
}

function projectRecord(value, sessionId) {
  if (!isObject(value)) {
    fail("REMOTE_RESPONSE_INVALID", "The result page contains a non-object record", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  const recordSessionId = String(value.ssId ?? "").trim();
  if (recordSessionId && recordSessionId !== sessionId) {
    fail("RESULT_SESSION_MISMATCH", "A result row belongs to a different session", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  const pnId = String(value.pnId ?? "").trim();
  const title = String(value.ti ?? "").trim();
  if (!pnId || !title) {
    fail("REMOTE_RESPONSE_INVALID", "A result row is missing pnId or ti", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  const score = parseFiniteNumber(value.simVal, "simVal");
  const semanticRank = parseFiniteNumber(value.semanticSort, "semanticSort");
  if (!Number.isSafeInteger(semanticRank) || semanticRank < 1) {
    fail("SEMANTIC_SORT_UNAVAILABLE", "A result row is missing a positive integer semanticSort rank", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  return {
    pnId,
    ti: title,
    simVal: score,
    semanticSort: semanticRank,
    // Expose only the requested field content. The provider wraps these
    // values in grouped metadata and HTML/XML; labels vary across databases.
    abview: firstDetailText(value.abview),
    clms: firstDetailText(value.clms),
  };
}

function parseEnvelope(response) {
  if (!isObject(response) || typeof response.status !== "number") {
    fail("REMOTE_RESPONSE_INVALID", "The Fusion Search transport returned an invalid response", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  if (response.status === 401 || response.status === 403) {
    fail("REMOTE_AUTH_REJECTED", `Fusion Search rejected the current token (HTTP ${response.status})`, {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
      status: response.status,
    });
  }
  if (response.status >= 400) {
    fail("REMOTE_HTTP_ERROR", `${FUSION_RESULT_PAGE_ENDPOINT} returned HTTP ${response.status}`, {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
      status: response.status,
    });
  }

  let envelope;
  try {
    envelope = JSON.parse(String(response.bodyText ?? ""));
  } catch {
    fail("REMOTE_RESPONSE_INVALID", "The Fusion Search result page was not JSON", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
      status: response.status,
    });
  }
  if (!isObject(envelope)) {
    fail("REMOTE_RESPONSE_INVALID", "The Fusion Search result page envelope was invalid", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
      status: response.status,
    });
  }
  if (Number(envelope.status) !== 200) {
    fail("REMOTE_API_ERROR", String(envelope.message ?? "Fusion Search result page request failed"), {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
      status: envelope.status,
    });
  }
  if (!isObject(envelope.t)) {
    fail("REMOTE_RESPONSE_INVALID", "The Fusion Search result page data was invalid", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  return envelope.t;
}

function resultPayload({ sessionId, start }) {
  return {
    viewMode: "1",
    start,
    size: FUSION_RESULT_PAGE_SIZE,
    lang: "1",
    ssId: sessionId,
    statDbs: [],
    showAbsFlag: "1",
    showDescImageFlag: "0",
    statParams: [],
    ifStat: 0,
    sortField: ["", ""],
  };
}

export function createFusionResultPageApi({
  fetchImpl,
  authorization,
  baseUrl = FUSION_RESULT_PAGE_BASE_URL,
  timeoutMs = FUSION_RESULT_PAGE_TIMEOUT_MS,
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!String(authorization ?? "").trim()) {
    fail("AUTH_MISSING", "an authorization header is required before calling the Fusion Search API");
  }
  const normalizedBase = String(baseUrl).replace(/\/+$/u, "");

  return {
    async resultPage(input) {
      if (signal?.aborted) fail("CANCELLED", "The result-page request was cancelled");
      let response;
      try {
        response = await fetchImpl({
          url: `${normalizedBase}${FUSION_RESULT_PAGE_ENDPOINT}`,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: authorization,
            "User-Agent": "fusion-search-plugin/0.4",
          },
          body: JSON.stringify(resultPayload(input)),
          timeoutMs,
        });
      } catch (error) {
        if (signal?.aborted) fail("CANCELLED", "The result-page request was cancelled");
        throw error;
      }
      if (signal?.aborted) fail("CANCELLED", "The result-page request was cancelled");
      return parseEnvelope(response);
    },
  };
}

async function readPage(api, input, signal) {
  const data = await api.resultPage(input);
  const resultList = data.resultList;
  if (!Array.isArray(resultList)) {
    fail("REMOTE_RESPONSE_INVALID", "The result page did not contain a resultList array", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  const noResultCount = (data.listCounts === null || data.listCounts === undefined)
    && resultList.length === 0
    && (data.hitCounts === null || data.hitCounts === undefined || parseCount(data.hitCounts, "hitCounts") === 0);
  const totalCount = noResultCount ? 0 : parseCount(data.listCounts, "listCounts");
  const totalPage = Math.ceil(totalCount / FUSION_RESULT_PAGE_SIZE);
  if (resultList.length > FUSION_RESULT_PAGE_SIZE) {
    fail("REMOTE_RESPONSE_INVALID", "The result page exceeded the requested page size", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  if (data.ssId && String(data.ssId) !== input.sessionId) {
    fail("RESULT_SESSION_MISMATCH", "The result page belongs to a different session", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  const records = resultList.map((record) => projectRecord(record, input.sessionId));
  for (let index = 1; index < records.length; index += 1) {
    if (records[index].semanticSort <= records[index - 1].semanticSort) {
      fail("SEMANTIC_SORT_ORDER_INVALID", "The result page is not ordered by semanticSort rank", {
        endpoint: FUSION_RESULT_PAGE_ENDPOINT,
      });
    }
  }
  if (
    records.length === 0
    && totalCount > 0
    && input.page <= totalPage
    && String(data.fromSource ?? "").trim().toLowerCase() !== "boolean-semantic"
    && data.semSortCounts === undefined
  ) {
    fail("SEMANTIC_SORT_UNAVAILABLE", "The empty page did not confirm semantic-sorted session state", {
      endpoint: FUSION_RESULT_PAGE_ENDPOINT,
    });
  }
  if (signal?.aborted) fail("CANCELLED", "The result-page request was cancelled");
  return { ok: true, semantic_sorted: true, records, totalPage, page: input.page };
}

/** Read a page from an existing semantic-sorted session; never reruns its query. */
export async function executeSemanticResultPage({
  args,
  authorization,
  fetchImpl,
  api,
  signal,
} = {}) {
  try {
    const input = normalizeInput(args);
    const client = api ?? createFusionResultPageApi({ fetchImpl, authorization, signal });
    return await readPage(client, input, signal);
  } catch (error) {
    return toErrorResult(error);
  }
}

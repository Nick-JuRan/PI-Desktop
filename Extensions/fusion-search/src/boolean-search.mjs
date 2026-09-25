import { fail, toErrorResult } from "./errors.mjs";
import { FUSION_RESULT_PAGE_SIZE } from "./semantic-result-page.mjs";

export const FUSION_BOOLEAN_SEARCH_BASE_URL = "http://10.160.28.16/api";
export const FUSION_BOOLEAN_SEARCH_TIMEOUT_MS = 25_000;
export const FUSION_BOOLEAN_SEARCH_MAX_QUERY_LENGTH = 25_000;
export const FUSION_BOOLEAN_SEARCH_RESULT_LIMIT = 400;

const ENDPOINTS = Object.freeze({
  databases: "/neusipo-app-search/dbAll",
  validate: "/neusipo-app-search/fusionSearch/new/valid/boolterm",
  selectSemanticElement: "/neusipo-app-search/element/selectElement",
  execute: "/neusipo-app-search/fusionSearch/new/action/executeSearch",
  overview: "/neusipo-app-search/fusionSearch/new/forOverview",
});

const SUPPORTED_DATABASES = new Set(["CNTXT", "ENTXT", "ENTXTC", "VEN", "DWPI"]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeInput(args) {
  if (!isObject(args)) fail("INVALID_INPUT", "tool arguments must be an object");
  if (Object.keys(args).some((key) => !["database", "query"].includes(key))) {
    fail("INVALID_INPUT", "only database and query are accepted");
  }

  if (typeof args.database !== "string") {
    fail("INVALID_INPUT", "database must be one of CNTXT, ENTXT, ENTXTC, VEN, or DWPI");
  }
  const requestedDatabase = args.database.trim().toUpperCase();
  // The remote catalog and the existing SDK use CNTXT; accept the common
  // CTTXT spelling as an alias without sending it to the provider.
  const database = requestedDatabase === "CTTXT" ? "CNTXT" : requestedDatabase;
  if (!SUPPORTED_DATABASES.has(database)) {
    fail("INVALID_INPUT", "database must be one of CNTXT, ENTXT, ENTXTC, VEN, or DWPI");
  }

  if (typeof args.query !== "string") fail("INVALID_INPUT", "query must be a string");
  const query = args.query.trim();
  if (!query) fail("INVALID_INPUT", "query must not be empty");
  if (query.length > FUSION_BOOLEAN_SEARCH_MAX_QUERY_LENGTH) {
    fail("INVALID_INPUT", `query must not exceed ${FUSION_BOOLEAN_SEARCH_MAX_QUERY_LENGTH} characters`);
  }
  return { database, query };
}

export function validateBooleanSearchInput(args) {
  try {
    normalizeInput(args);
    return null;
  } catch (error) {
    return toErrorResult(error);
  }
}

function throwCancelled(path, submitted) {
  if (submitted) {
    fail(
      "REMOTE_OUTCOME_UNKNOWN",
      "The Boolean search may have been recorded remotely. Check search history before submitting it again.",
      { endpoint: path },
    );
  }
  fail("CANCELLED", "The Fusion Search request was cancelled before search execution.", { endpoint: path });
}

function statusError(path, responseStatus, envelope) {
  if (responseStatus === 401 || responseStatus === 403) {
    fail("REMOTE_AUTH_REJECTED", `Fusion Search rejected the current token (HTTP ${responseStatus})`, {
      endpoint: path,
      status: responseStatus,
    });
  }
  if (responseStatus >= 400) {
    fail("REMOTE_HTTP_ERROR", `${path} returned HTTP ${responseStatus}`, { endpoint: path, status: responseStatus });
  }
  if (Number(envelope.status) !== 200) {
    const businessStatus = envelope.status;
    if (businessStatus !== undefined && Number(businessStatus) >= 500) {
      fail(
        "REMOTE_OUTCOME_UNKNOWN",
        "The Boolean search may have been recorded remotely. Check search history before submitting it again.",
        { endpoint: path, status: businessStatus },
      );
    }
    fail("REMOTE_API_ERROR", String(envelope.message ?? `${path} failed`), {
      endpoint: path,
      status: businessStatus,
    });
  }
}

function parseEnvelope(path, response, { submitted = false } = {}) {
  if (!isObject(response) || typeof response.status !== "number") {
    if (submitted) {
      fail(
        "REMOTE_OUTCOME_UNKNOWN",
        "The Boolean search may have been recorded remotely. Check search history before submitting it again.",
        { endpoint: path },
      );
    }
    fail("REMOTE_RESPONSE_INVALID", `${path} returned an invalid transport response`, { endpoint: path });
  }

  if (response.status === 401 || response.status === 403) {
    fail("REMOTE_AUTH_REJECTED", `Fusion Search rejected the current token (HTTP ${response.status})`, {
      endpoint: path,
      status: response.status,
    });
  }
  if (response.status >= 400) {
    fail("REMOTE_HTTP_ERROR", `${path} returned HTTP ${response.status}`, { endpoint: path, status: response.status });
  }
  let envelope;
  try {
    envelope = JSON.parse(String(response.bodyText ?? ""));
  } catch {
    if (submitted) {
      fail(
        "REMOTE_OUTCOME_UNKNOWN",
        "The Boolean search may have been recorded remotely. Check search history before submitting it again.",
        { endpoint: path, status: response.status },
      );
    }
    fail("REMOTE_RESPONSE_INVALID", `${path} returned non-JSON content`, {
      endpoint: path,
      status: response.status,
    });
  }
  if (!isObject(envelope)) {
    if (submitted) {
      fail(
        "REMOTE_OUTCOME_UNKNOWN",
        "The Boolean search may have been recorded remotely. Check search history before submitting it again.",
        { endpoint: path, status: response.status },
      );
    }
    fail("REMOTE_RESPONSE_INVALID", `${path} returned an invalid JSON envelope`, {
      endpoint: path,
      status: response.status,
    });
  }
  statusError(path, response.status, envelope);
  return envelope.t;
}

function catalogRows(value) {
  if (Array.isArray(value)) return value.filter(isObject);
  if (!isObject(value)) return [];
  for (const key of ["allList", "list", "rows", "databases"]) {
    if (Array.isArray(value[key])) return value[key].filter(isObject);
  }
  for (const key of ["oneDatabaseBiz", "manyDatabaseBiz"]) {
    if (Array.isArray(value[key])) return value[key].filter(isObject);
  }
  if (isObject(value.data)) return catalogRows(value.data);
  return [];
}

function resolveDatabaseId(catalog, database) {
  const matches = catalogRows(catalog).filter((row) =>
    String(row.dbCode ?? row.code ?? "").trim().toUpperCase() === database
      && String(row.dbId ?? row.id ?? "").trim(),
  );
  const uniqueIds = [...new Set(matches.map((row) => String(row.dbId ?? row.id).trim()))];
  if (uniqueIds.length !== 1) {
    fail(
      uniqueIds.length === 0 ? "DATABASE_NOT_FOUND" : "DATABASE_CATALOG_AMBIGUOUS",
      uniqueIds.length === 0
        ? `The current Fusion Search catalog does not contain ${database}`
        : `The current Fusion Search catalog contains multiple IDs for ${database}`,
    );
  }
  return uniqueIds[0];
}

function readSessionId(value) {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (!isObject(value)) return "";
  for (const key of ["ssId", "session_id", "sessionId"]) {
    const candidate = value[key];
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  if (isObject(value.data)) return readSessionId(value.data);
  return "";
}

function readInteger(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return null;
}

function requestPayload({ databaseId, query, sessionId = "", semanticElementId, size = 1 }) {
  const shared = {
    dbs: [databaseId],
    start: 0,
    size,
    viewMode: "1",
    hitCounts: 0,
    ssId: sessionId,
    showAbsFlag: "0",
    showDescImageFlag: "0",
    rdiDate: "",
    complexChinese: true,
    rootSearch: "ENGLISH",
    twSearch: "ON",
    crossSearch: "OFF",
    searchModel: "TABLE_SEARCH",
    semanticParam: {
      top: String(FUSION_BOOLEAN_SEARCH_RESULT_LIMIT),
      boolterm: query,
      rdiflag: false,
      eid: semanticElementId,
    },
  };
  return sessionId
    ? { ...shared, searchType: "boolean-semantic", semanticParam: { ...shared.semanticParam, stxt: "" } }
    : { ...shared, searchType: "boolean", fromSource: "boolean" };
}

function normalizeSemanticElementId(value) {
  if (typeof value === "boolean" || value === null || value === undefined) return "";
  return String(value).trim();
}

function readSemanticElementId(value) {
  if (!isObject(value)) return "";
  return normalizeSemanticElementId(value.id ?? value.element_id ?? value.elementId ?? value.eid ?? value.eId);
}

export function createFusionBooleanSearchApi({
  fetchImpl,
  authorization,
  baseUrl = FUSION_BOOLEAN_SEARCH_BASE_URL,
  timeoutMs = FUSION_BOOLEAN_SEARCH_TIMEOUT_MS,
  signal,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!String(authorization ?? "").trim()) {
    fail("AUTH_MISSING", "an authorization header is required before calling the Fusion Search API");
  }
  const normalizedBase = String(baseUrl).replace(/\/+$/u, "");
  let executionSubmitted = false;

  return {
    async post(path, payload, { createsSearch = false } = {}) {
      if (signal?.aborted) throwCancelled(path, executionSubmitted);
      if (createsSearch) executionSubmitted = true;
      let response;
      try {
        response = await fetchImpl({
          url: `${normalizedBase}${path}`,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: authorization,
            "User-Agent": "fusion-search-plugin/0.4",
          },
          body: JSON.stringify(payload),
          timeoutMs,
        });
      } catch (error) {
        if (signal?.aborted) throwCancelled(path, executionSubmitted);
        if (createsSearch) {
          fail(
            "REMOTE_OUTCOME_UNKNOWN",
            "The Boolean search may have been recorded remotely. Check search history before submitting it again.",
            { endpoint: path },
          );
        }
        throw error;
      }
      if (signal?.aborted) throwCancelled(path, executionSubmitted);
      if (!isObject(response) || typeof response.status !== "number") {
        if (createsSearch) {
          fail(
            "REMOTE_OUTCOME_UNKNOWN",
            "The Boolean search may have been recorded remotely. Check search history before submitting it again.",
            { endpoint: path },
          );
        }
        fail("REMOTE_RESPONSE_INVALID", `${path} returned an invalid transport response`, { endpoint: path });
      }
      if (createsSearch && response.status >= 500) {
        fail(
          "REMOTE_OUTCOME_UNKNOWN",
          "The Boolean search may have been recorded remotely. Check search history before submitting it again.",
          { endpoint: path, status: response.status },
        );
      }
      return parseEnvelope(path, response, { submitted: createsSearch });
    },
  };
}

async function executeSearch(api, input, signal, onSessionCreated, preferredSemanticElementId) {
  if (signal?.aborted) fail("CANCELLED", "Fusion Search request was cancelled");
  const catalog = await api.post(ENDPOINTS.databases, {});
  const databaseId = resolveDatabaseId(catalog, input.database);

  if (signal?.aborted) fail("CANCELLED", "Fusion Search request was cancelled");
  const validation = await api.post(ENDPOINTS.validate, {
    dbIds: [databaseId],
    boolterm: input.query,
  });
  if (validation !== true) {
    fail("QUERY_VALIDATION_FAILED", "The Fusion Search service rejected the Boolean query.", {
      endpoint: ENDPOINTS.validate,
    });
  }

  let semanticElementId = normalizeSemanticElementId(preferredSemanticElementId);
  if (!semanticElementId) {
    const selected = await api.post(ENDPOINTS.selectSemanticElement, {});
    semanticElementId = readSemanticElementId(selected);
  }
  if (!semanticElementId) {
    fail(
      "SEMANTIC_BASELINE_REQUIRED",
      "No active semantic baseline is selected. Call fusion_semantic_baseline prepare first, then rerun the Boolean search.",
      { endpoint: ENDPOINTS.selectSemanticElement },
    );
  }

  if (signal?.aborted) fail("CANCELLED", "Fusion Search request was cancelled");
  const executed = await api.post(
    ENDPOINTS.execute,
    requestPayload({ databaseId, query: input.query, semanticElementId }),
    { createsSearch: true },
  );
  const sessionId = readSessionId(executed);
  if (!sessionId) {
    fail(
      "REMOTE_OUTCOME_UNKNOWN",
      "The Boolean search may have been recorded remotely but returned no session ID. Check search history before submitting it again.",
      { endpoint: ENDPOINTS.execute },
    );
  }
  onSessionCreated(sessionId);

  if (signal?.aborted) throwCancelled(ENDPOINTS.execute, true);
  let overview;
  try {
    overview = await api.post(
      ENDPOINTS.overview,
      requestPayload({
        databaseId,
        query: input.query,
        sessionId,
        semanticElementId,
        size: FUSION_RESULT_PAGE_SIZE,
      }),
    );
  } catch (error) {
    if (error?.code === "REMOTE_AUTH_REJECTED" || error?.code === "REMOTE_OUTCOME_UNKNOWN") {
      throw error;
    }
    fail(
      "RESULT_SESSION_READ_FAILED",
      "The search session was created, but its total hit count could not be read. Retry with the returned session_id instead of rerunning the query.",
      { endpoint: ENDPOINTS.overview, session_id: sessionId },
    );
  }
  if (!isObject(overview)) {
    fail("REMOTE_RESPONSE_INVALID", "The search overview response was invalid", {
      endpoint: ENDPOINTS.overview,
      session_id: sessionId,
    });
  }
  const responseSessionId = readSessionId(overview);
  if (responseSessionId && responseSessionId !== sessionId) {
    fail("RESULT_SESSION_MISMATCH", "The search overview returned a different session ID", {
      endpoint: ENDPOINTS.overview,
      session_id: sessionId,
    });
  }
  const isSemanticSorted =
    String(overview.fromSource ?? "").trim().toLowerCase() === "boolean-semantic"
    || overview.semSortCounts !== undefined
    || (Array.isArray(overview.resultList)
      && overview.resultList.some((record) => isObject(record) && record.semanticSort !== undefined));
  if (!isSemanticSorted) {
    fail(
      "SEMANTIC_SORT_UNAVAILABLE",
      "The service did not confirm semantic sorting for this session; no unranked session was returned.",
      { endpoint: ENDPOINTS.overview, session_id: sessionId },
    );
  }
  const totalHits = readInteger(overview.hitCounts);
  if (totalHits === null) {
    fail("REMOTE_RESPONSE_INVALID", "The search overview did not return a valid total hit count", {
      endpoint: ENDPOINTS.overview,
      session_id: sessionId,
    });
  }
  return { ok: true, database: input.database, total_hits: totalHits, session_id: sessionId };
}

/** Execute one non-replayed Boolean search and expose only its count and session handle. */
export async function executeBooleanSearch({
  args,
  authorization,
  fetchImpl,
  api,
  signal,
  semanticElementId,
} = {}) {
  let sessionId = "";
  try {
    const input = normalizeInput(args);
    const client = api ?? createFusionBooleanSearchApi({ fetchImpl, authorization, signal });
    return await executeSearch(
      client,
      input,
      signal,
      (createdSessionId) => { sessionId = createdSessionId; },
      semanticElementId,
    );
  } catch (error) {
    const result = toErrorResult(error);
    if (sessionId) result.error.session_id = sessionId;
    return result;
  }
}

export const FUSION_BOOLEAN_SEARCH_ENDPOINTS = ENDPOINTS;

export const FUSION_SEARCH_BASE_URL = "http://10.160.28.16/api";
export const FUSION_SEARCH_USER_AGENT = "fusion-search-plugin/0.2";
export const SEMANTIC_MAX_TERMS = 500;
export const SEMANTIC_MAX_TERM_LENGTH = 100;
export const SEMANTIC_MIN_TEXT_LENGTH = 20;
export const SEMANTIC_MAX_TEXT_LENGTH = 25_000;

/**
 * One search-server request stays well inside the plugin tool budget (110s
 * host-side); the longest tool action chains three requests, so the per-request
 * ceiling has to keep the worst chain (~3 x budget) under that budget.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

const ENDPOINTS = Object.freeze({
  addElement: "/neusipo-app-search/element/addElement",
  retrieval: "/neusipo-app-search/fusionSearch/element/retrieval",
  modify: "/neusipo-app-search/element/modify",
});

import { fail, toErrorResult } from "./errors.mjs";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const MUTATING_ENDPOINTS = new Set([ENDPOINTS.addElement, ENDPOINTS.modify]);

function throwCancelledRequest(path) {
  if (MUTATING_ENDPOINTS.has(path)) {
    fail("REMOTE_OUTCOME_UNKNOWN", "The remote mutation may have completed before cancellation. Review remote state before retrying.", { endpoint: path });
  }
  fail("CANCELLED", "The Fusion Search request was cancelled before its response was received.", { endpoint: path });
}

function checkNotAborted(signal) {
  if (signal?.aborted) fail("CANCELLED", "Fusion Search request was cancelled");
}

function normalizeElementId(value) {
  if (typeof value === "boolean" || value === null || value === undefined) {
    fail("INVALID_INPUT", "element_id is required");
  }
  const elementId = String(value).trim();
  if (!elementId || elementId.length > 128) {
    fail("INVALID_INPUT", "element_id must be a non-empty value of at most 128 characters");
  }
  return elementId;
}

function normalizeReferenceKind(value, reference) {
  if (value === undefined || value === null || value === "") {
    return /^(?=.*\d)[A-Za-z0-9./]{4,50}$/.test(reference)
      ? "application_number"
      : "text";
  }
  if (value !== "application_number" && value !== "publication_number" && value !== "text") {
    fail("INVALID_INPUT", "reference_kind must be application_number, publication_number, or text");
  }
  return value;
}

function normalizeReference(value, kind) {
  if (typeof value !== "string") fail("INVALID_INPUT", "reference must be a string");
  const source = value.trim();
  if (!source) fail("INVALID_INPUT", "reference must not be empty");

  if (kind === "application_number" || kind === "publication_number") {
    const normalized = source.replace(/[.\s]+/gu, "");
    if (normalized.length > 50 || !/^[A-Za-z0-9/]+$/.test(normalized)) {
      fail("INVALID_INPUT", `${kind} may contain only letters, digits, dots, spaces, or / and is limited to 50 characters`);
    }
    return normalized;
  }

  if (source.length < SEMANTIC_MIN_TEXT_LENGTH || source.length > SEMANTIC_MAX_TEXT_LENGTH) {
    fail("INVALID_INPUT", `text must contain ${SEMANTIC_MIN_TEXT_LENGTH} to ${SEMANTIC_MAX_TEXT_LENGTH} characters`);
  }
  if (/^[A-Za-z0-9]+$/.test(source)) {
    fail("INVALID_INPUT", "pure alphanumeric input must be submitted as application_number");
  }
  return source;
}

function summarizeReference(kind, value) {
  if (kind !== "text") return { kind, value };
  const preview = value.replace(/\s+/gu, " ").trim();
  return {
    kind,
    length: value.length,
    preview: preview.length > 120 ? `${preview.slice(0, 120)}...` : preview,
  };
}

function normalizeWeight(value) {
  if (typeof value === "boolean" || value === null || value === undefined) {
    fail("INVALID_INPUT", "semantic term weight must be an integer from 1 to 5");
  }
  const weight = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(weight) || weight < 1 || weight > 5) {
    fail("INVALID_INPUT", "semantic term weight must be an integer from 1 to 5");
  }
  return weight;
}

function normalizeTerm(item, language, index) {
  if (!isObject(item)) fail("INVALID_INPUT", `${language}[${index}] must be an object with term and weight`);
  const term = String(item.term ?? item.word ?? item.wd ?? "").trim();
  if (!term || term.length > SEMANTIC_MAX_TERM_LENGTH) {
    fail("INVALID_INPUT", `${language}[${index}].term must contain 1 to ${SEMANTIC_MAX_TERM_LENGTH} characters`);
  }
  return { term, weight: normalizeWeight(item.weight ?? item.wt) };
}

function normalizeTermList(value, language) {
  if (!Array.isArray(value)) fail("INVALID_INPUT", `${language} must be an array`);
  if (value.length > SEMANTIC_MAX_TERMS) {
    fail("INVALID_INPUT", `${language} accepts at most ${SEMANTIC_MAX_TERMS} terms`);
  }
  const seen = new Set();
  return value.map((item, index) => {
    const term = normalizeTerm(item, language, index);
    const key = term.term.toLocaleLowerCase();
    if (seen.has(key)) fail("INVALID_INPUT", `${language} must not contain duplicate terms: ${term.term}`);
    seen.add(key);
    return term;
  });
}

function normalizeTermsInput(value) {
  if (!isObject(value)) fail("INVALID_INPUT", "terms must be an object");
  const hasChinese = Object.hasOwn(value, "chinese");
  const hasEnglish = Object.hasOwn(value, "english");
  if (!hasChinese && !hasEnglish) fail("INVALID_INPUT", "terms must include chinese or english");
  return {
    chinese: hasChinese ? normalizeTermList(value.chinese, "chinese") : undefined,
    english: hasEnglish ? normalizeTermList(value.english, "english") : undefined,
  };
}

function normalizeLanguage(value) {
  const language = String(value ?? "").trim().toLowerCase();
  if (["cn", "zh", "chinese", "中文"].includes(language)) return "chinese";
  if (["en", "english", "英文"].includes(language)) return "english";
  return null;
}

function readTermFromProvider(value) {
  if (!isObject(value)) return null;
  const term = String(value.wd ?? value.word ?? value.term ?? "").trim();
  if (!term) return null;
  const rawWeight = value.wt ?? value.weight;
  const numericWeight = Number(rawWeight);
  if (numericWeight === 0) return { term, weight: 0 };
  if (!Number.isInteger(numericWeight) || numericWeight < 1 || numericWeight > 5) return null;
  return { term, weight: numericWeight };
}

function parseRetrievalTerms(elementId, envelope) {
  const outer = unwrapEnvelope(ENDPOINTS.retrieval, envelope).data;
  if (!isObject(outer)) fail("REMOTE_RESPONSE_INVALID", "semantic retrieval returned an invalid payload");

  const nestedCode = outer.code ?? outer.status;
  if (nestedCode !== undefined && nestedCode !== null && String(nestedCode) !== "200") {
    fail("REMOTE_API_ERROR", String(outer.message ?? "semantic retrieval failed"), { status: nestedCode });
  }

  const data = isObject(outer.data) ? outer.data : outer;
  const records = Array.isArray(data.records) ? data.records : [];
  const groups = [];
  for (const record of records) {
    if (!isObject(record)) continue;
    const sourceElements = record.srcEle ?? record.sourceElements;
    if (Array.isArray(sourceElements)) groups.push(...sourceElements);
  }
  if (outer.success === false && groups.length === 0) {
    fail("REMOTE_API_ERROR", "semantic retrieval was not confirmed and returned no term groups", { status: nestedCode });
  }

  const result = {
    chinese: [],
    english: [],
    deleted: { chinese: [], english: [] },
  };
  const seen = { chinese: new Set(), english: new Set() };
  const deletedSeen = { chinese: new Set(), english: new Set() };

  for (const group of groups) {
    if (!isObject(group)) continue;
    const language = normalizeLanguage(group.sec ?? group.type);
    if (!language) continue;
    const entries = group.eles ?? group.elements;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const term = readTermFromProvider(entry);
      if (!term) continue;
      const key = term.term.toLocaleLowerCase();
      if (term.weight === 0) {
        if (!deletedSeen[language].has(key)) {
          deletedSeen[language].add(key);
          result.deleted[language].push({ term: term.term });
        }
        continue;
      }
      if (!seen[language].has(key)) {
        seen[language].add(key);
        result[language].push({ term: term.term, weight: term.weight });
      }
    }
  }
  return { element_id: elementId, terms: { chinese: result.chinese, english: result.english }, deleted_terms: result.deleted };
}

function unwrapEnvelope(endpoint, envelope) {
  if (!isObject(envelope)) fail("REMOTE_RESPONSE_INVALID", `${endpoint} returned a non-object response`);
  if (Number(envelope.status) !== 200) {
    fail("REMOTE_API_ERROR", String(envelope.message ?? `${endpoint} failed`), {
      endpoint,
      status: envelope.status,
    });
  }
  return { endpoint, data: envelope.t };
}

function extractElementId(value) {
  if (value !== null && value !== undefined && !isObject(value)) {
    const primitive = String(value).trim();
    if (primitive) return primitive;
  }
  if (!isObject(value)) return "";
  for (const key of ["element_id", "elementId", "eId", "eid", "id"]) {
    const candidate = value[key];
    if (candidate !== null && candidate !== undefined && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return "";
}

function providerTermPayload(term, language, isNew) {
  return {
    wd: term.term,
    wt: term.weight,
    type: language === "chinese" ? "cn" : "en",
    isAdd: isNew ? "1" : 0,
  };
}

function buildUpdatePayload(current, desired) {
  const entries = [];
  for (const language of ["chinese", "english"]) {
    const oldTerms = current.terms[language];
    const oldKeys = new Set(oldTerms.map((term) => term.term.toLocaleLowerCase()));
    for (const term of desired[language]) {
      entries.push(providerTermPayload(term, language, !oldKeys.has(term.term.toLocaleLowerCase())));
    }
  }
  // The legacy UI submits all retained/new entries first, followed by
  // explicit zero-weight deletions for each language.
  for (const language of ["chinese", "english"]) {
    const oldTerms = current.terms[language];
    const newKeys = new Set(desired[language].map((term) => term.term.toLocaleLowerCase()));
    for (const term of oldTerms) {
      if (!newKeys.has(term.term.toLocaleLowerCase())) {
        entries.push({ wd: term.term, wt: 0, type: language === "chinese" ? "cn" : "en" });
      }
    }
  }
  return entries;
}

export function createFusionSearchApi({ fetchImpl, authorization, baseUrl = FUSION_SEARCH_BASE_URL, timeoutMs = REQUEST_TIMEOUT_MS, signal } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl is required");
  if (!String(authorization ?? "").trim()) fail("AUTH_MISSING", "an authorization header is required before calling the Fusion Search API");
  const normalizedBase = String(baseUrl).replace(/\/+$/u, "");

  return {
    async post(path, payload) {
      checkNotAborted(signal);
      let response;
      try {
        response = await fetchImpl({
          url: `${normalizedBase}${path}`,
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: authorization,
            "User-Agent": FUSION_SEARCH_USER_AGENT,
          },
          body: JSON.stringify(payload),
          timeoutMs,
        });
      } catch (error) {
        if (signal?.aborted) throwCancelledRequest(path);
        throw error;
      }
      if (signal?.aborted) throwCancelledRequest(path);
      checkNotAborted(signal);
      if (!isObject(response) || typeof response.status !== "number") {
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
        fail("REMOTE_RESPONSE_INVALID", `${path} returned non-JSON content`, { endpoint: path, status: response.status });
      }
      return envelope;
    },
  };
}

async function readTerms(api, elementId, signal) {
  checkNotAborted(signal);
  const envelope = await api.post(ENDPOINTS.retrieval, { eId: elementId });
  return parseRetrievalTerms(elementId, envelope);
}

async function prepare(api, args, signal) {
  const rawReference = args.reference;
  const source = typeof rawReference === "string" ? rawReference.trim() : "";
  const kind = normalizeReferenceKind(args.reference_kind, source);
  const reference = normalizeReference(source, kind);
  checkNotAborted(signal);
  const envelope = await api.post(ENDPOINTS.addElement, {
    sno: kind === "text" ? "" : reference,
    stxt: kind === "text" ? reference : "",
  });
  const elementId = extractElementId(unwrapEnvelope(ENDPOINTS.addElement, envelope).data);
  if (!elementId) fail("REMOTE_RESPONSE_INVALID", "semantic baseline creation did not return element_id");
  const terms = await readTerms(api, elementId, signal);
  return {
    ok: true,
    action: "prepare",
    element_id: elementId,
    reference: summarizeReference(kind, reference),
    terms: terms.terms,
    deleted_terms: terms.deleted_terms,
  };
}

async function updateTerms(api, args, signal) {
  const elementId = normalizeElementId(args.element_id);
  const input = normalizeTermsInput(args.terms);
  const current = await readTerms(api, elementId, signal);
  const desired = {
    chinese: input.chinese ?? current.terms.chinese,
    english: input.english ?? current.terms.english,
  };
  checkNotAborted(signal);
  const saved = await api.post(ENDPOINTS.modify, {
    eid: elementId,
    eleStat: buildUpdatePayload(current, desired),
  });
  const savedValue = unwrapEnvelope(ENDPOINTS.modify, saved).data;
  if (![true, 1, "1", "true", "True"].includes(savedValue)) {
    fail("REMOTE_API_ERROR", "semantic term update was not confirmed by the server");
  }
  const verify = args.verify !== false;
  if (verify) {
    const verified = await readTerms(api, elementId, signal);
    return { ok: true, action: "update_terms", verified: true, ...verified };
  }
  // Without verification, report exactly what was submitted and say so —
  // never invent a deleted_terms list the server never confirmed.
  return {
    ok: true,
    action: "update_terms",
    verified: false,
    element_id: elementId,
    terms: desired,
  };
}

async function runAction(api, args, signal) {
  if (!isObject(args)) fail("INVALID_INPUT", "tool arguments must be an object");
  const action = args.action;
  if (action === "prepare") return prepare(api, args, signal);
  if (action === "update_terms") return updateTerms(api, args, signal);
  fail("INVALID_INPUT", "action must be prepare or update_terms");
}

/**
 * Execute one semantic-baseline action. `authorization` is the header value a
 * token manager produced; the token itself never crosses the tool boundary.
 * Errors — invalid input, cancelled calls, remote failures — are wrapped into
 * the uniform { ok: false, error } result, so every caller gets one shape.
 */
export async function executeSemanticBaseline({ args, authorization, fetchImpl, api, signal } = {}) {
  try {
    const client = api ?? createFusionSearchApi({ fetchImpl, authorization, signal });
    return await runAction(client, args, signal);
  } catch (error) {
    return toErrorResult(error);
  }
}

export const SEMANTIC_BASELINE_ENDPOINTS = ENDPOINTS;

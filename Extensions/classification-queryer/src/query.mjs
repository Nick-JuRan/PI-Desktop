const MAX_ITEMS_PER_BUCKET = 20;
const MAX_TOTAL_ITEMS = 40;
const MAX_VALUE_LENGTH = 128;

const KEYWORD_PATTERN = /^[\p{L}\p{N}\u3400-\u9fff][\p{L}\p{N}\u3400-\u9fff_-]{0,31}$/u;
const CODE_PATTERN = /^[A-Z][A-Z0-9./-]{1,63}$/i;

const SYSTEMS = [
  { key: "ipc", system: "IPC" },
  { key: "cpc", system: "CPC" },
];

const LEGACY_BUCKETS = [
  { field: "ipc_codes", system: "IPC", kind: "code", flag: "--ipcno" },
  { field: "cpc_codes", system: "CPC", kind: "code", flag: "--ipcno" },
  { field: "ipc_keywords", system: "IPC", kind: "keyword", flag: "--content" },
  { field: "cpc_keywords", system: "CPC", kind: "keyword", flag: "--content" },
];

function invalidValue(message) {
  throw new Error(message);
}

function normalizeCode(value, field, index) {
  if (typeof value !== "string") invalidValue(`${field}[${index}] must be a string`);
  const normalized = value.trim().replace(/\s+/gu, "");
  if (!normalized || normalized.length > MAX_VALUE_LENGTH || !CODE_PATTERN.test(normalized)) {
    invalidValue(`${field}[${index}] must be a valid IPC/CPC code`);
  }
  return normalized.toUpperCase();
}

function normalizeKeyword(value, field, index) {
  if (typeof value !== "string") invalidValue(`${field}[${index}] must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_VALUE_LENGTH || !KEYWORD_PATTERN.test(normalized)) {
    invalidValue(`${field}[${index}] must be one short keyword without whitespace or operators`);
  }
  return normalized;
}

function normalizeBucket(values, field, system, kind, flag, seen) {
  if (values === undefined) return [];
  if (!Array.isArray(values)) invalidValue(`${field} must be an array`);
  if (values.length > MAX_ITEMS_PER_BUCKET) {
    invalidValue(`${field} accepts at most ${MAX_ITEMS_PER_BUCKET} items`);
  }

  return values
    .map((value, index) => (kind === "code"
      ? normalizeCode(value, field, index)
      : normalizeKeyword(value, field, index)))
    .filter((value) => {
      const key = `${system}:${kind}:${value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((value) => ({
      field,
      system,
      kind,
      flag,
      value,
    }));
}

function normalizeSystem(input, { key, system }, kind, seen) {
  const scope = input[key];
  if (scope === undefined) return [];
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    invalidValue(`${key} must be an object with codes and/or keywords`);
  }
  const field = kind === "code" ? "codes" : "keywords";
  const flag = kind === "code" ? "--ipcno" : "--content";
  return normalizeBucket(scope[field], `${key}.${field}`, system, kind, flag, seen);
}

function normalizeLegacyInput(input) {
  const seen = new Set();
  return LEGACY_BUCKETS.flatMap((bucket) =>
    normalizeBucket(
      input[bucket.field],
      bucket.field,
      bucket.system,
      bucket.kind,
      bucket.flag,
      seen,
    ),
  );
}

export function normalizeQueryInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    invalidValue("classification query input must be an object");
  }

  const seen = new Set();
  const hasConciseShape = Object.hasOwn(input, "ipc") || Object.hasOwn(input, "cpc");
  const requests = hasConciseShape
    ? [
      ...SYSTEMS.flatMap((system) => normalizeSystem(input, system, "code", seen)),
      ...SYSTEMS.flatMap((system) => normalizeSystem(input, system, "keyword", seen)),
    ]
    : normalizeLegacyInput(input);
  if (requests.length === 0) {
    invalidValue("provide at least one IPC/CPC code or keyword query");
  }
  if (requests.length > MAX_TOTAL_ITEMS) {
    invalidValue(`a single call accepts at most ${MAX_TOTAL_ITEMS} queries`);
  }
  return requests;
}

export function buildClassifierArgs(request) {
  return [
    "-X",
    "utf8",
    "ipc_api.py",
    "search",
    "--ipccpc",
    request.system,
    request.flag,
    request.value,
  ];
}

export function parseClassifierOutput(processResult) {
  const stdout = String(processResult?.stdout ?? "").trim();
  const stderr = String(processResult?.stderr ?? "").trim();
  const code = Number.isInteger(processResult?.code) ? processResult.code : 0;

  if (processResult?.killed) {
    return {
      ok: false,
      error: { type: "cancelled_or_timeout", message: "classifier process was stopped" },
    };
  }
  if (!stdout) {
    return {
      ok: false,
      error: {
        type: "process_error",
        message: stderr || `classifier exited with code ${code}`,
      },
    };
  }

  try {
    const payload = JSON.parse(stdout);
    if (!payload || typeof payload !== "object") {
      return { ok: false, error: { type: "invalid_response", message: "classifier returned a non-object JSON value" } };
    }
    return payload;
  } catch {
    return {
      ok: false,
      error: {
        type: "invalid_response",
        message: "classifier returned non-JSON output",
        stderr: stderr || undefined,
      },
    };
  }
}

export function summarizeResults(results) {
  const succeeded = results.filter((result) => result.response?.ok === true).length;
  return {
    requested: results.length,
    succeeded,
    failed: results.length - succeeded,
  };
}

export const limits = Object.freeze({
  maxItemsPerBucket: MAX_ITEMS_PER_BUCKET,
  maxTotalItems: MAX_TOTAL_ITEMS,
  maxValueLength: MAX_VALUE_LENGTH,
});

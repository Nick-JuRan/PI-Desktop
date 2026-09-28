/** Plugin-wide error shape and the uniform tool error result. */

export class CnkiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CnkiError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function fail(code, message, details) {
  throw new CnkiError(code, message, details);
}

/** Error codes every tool may surface; kept in one place for the README. */
export const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  LOGIN_FAILED: "LOGIN_FAILED",
  COOKIE_EXPIRED: "COOKIE_EXPIRED",
  BLOCKED: "BLOCKED",
  UNEXPECTED_PAGE: "UNEXPECTED_PAGE",
  HOST_NOT_ALLOWED: "HOST_NOT_ALLOWED",
  HTTP_ERROR: "HTTP_ERROR",
  MAIN_BODY_UNAVAILABLE: "MAIN_BODY_UNAVAILABLE",
  CANCELLED: "CANCELLED",
  UNEXPECTED_ERROR: "UNEXPECTED_ERROR",
});

/** Diagnostic fields an error may carry; copied to the tool result so the page can be reported. */
const DETAIL_FIELDS = ["url", "finalUrl", "status", "title", "snippet", "length"];

/** Map any thrown value to the tool's uniform error result. */
export function toErrorResult(error) {
  if (error && typeof error === "object" && typeof error.code === "string") {
    const details = {};
    for (const field of DETAIL_FIELDS) {
      if (error[field] !== undefined && error[field] !== "") details[field] = error[field];
    }
    return {
      ok: false,
      error: {
        code: error.code,
        message: error instanceof Error ? error.message : String(error),
        ...details,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: ERROR_CODES.UNEXPECTED_ERROR,
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

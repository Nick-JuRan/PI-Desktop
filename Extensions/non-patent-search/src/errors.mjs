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

/** Map any thrown value to the tool's uniform error result. */
export function toErrorResult(error) {
  if (error && typeof error === "object" && typeof error.code === "string") {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error instanceof Error ? error.message : String(error),
        ...(error.url ? { url: error.url } : {}),
        ...(error.status !== undefined ? { status: error.status } : {}),
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

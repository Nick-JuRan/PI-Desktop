/** Plugin-wide error shape and the uniform tool error result. */

export class FusionSearchError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "FusionSearchError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function fail(code, message, details) {
  throw new FusionSearchError(code, message, details);
}

/** Map any thrown value to the tool's uniform error result. */
export function toErrorResult(error) {
  if (error && typeof error === "object" && typeof error.code === "string") {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error instanceof Error ? error.message : String(error),
        ...(error.endpoint ? { endpoint: error.endpoint } : {}),
        ...(error.status !== undefined ? { status: error.status } : {}),
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

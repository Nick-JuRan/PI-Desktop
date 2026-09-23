import { executeSemanticBaseline } from "./semantic-baseline.mjs";

const ACTIONS = new Set(["prepare", "get_terms", "update_terms"]);

function invalidActionResult() {
  return {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message: "action must be prepare, get_terms, or update_terms",
    },
  };
}

function isRemoteAuthRejected(result) {
  return result?.ok === false && result.error?.code === "REMOTE_AUTH_REJECTED";
}

/** Execute one public tool call with bounded, action-aware auth recovery. */
export async function executeFusionTool({
  args,
  signal,
  tokenManager,
  fetchImpl,
  executeSemantic = executeSemanticBaseline,
} = {}) {
  const action = args && typeof args === "object" && !Array.isArray(args) ? args.action : undefined;
  if (!ACTIONS.has(action)) return invalidActionResult();

  const initialAuthorization = (await tokenManager.authorization({ signal })).authorization;
  const callSemantic = (authorization) => executeSemantic({
    args,
    authorization,
    signal,
    fetchImpl,
  });
  const first = await callSemantic(initialAuthorization);
  if (!isRemoteAuthRejected(first)) return first;

  const refreshed = await tokenManager.refresh({ signal, rejectedAuthorization: initialAuthorization });
  if (action !== "get_terms") {
    return {
      ...first,
      error: {
        ...first.error,
        code: "REMOTE_AUTH_REJECTED_NOT_RETRIED",
        message: "Authentication was refreshed, but this mutating action was not replayed. Review remote state before retrying it.",
      },
    };
  }
  return callSemantic(refreshed.authorization);
}

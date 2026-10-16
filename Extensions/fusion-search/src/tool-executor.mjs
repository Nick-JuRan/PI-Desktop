import { executeSemanticBaseline } from "./semantic-baseline.mjs";
import { executeBooleanSearch, validateBooleanSearchInput } from "./boolean-search.mjs";
import {
  executeSemanticResultPage,
  normalizeSemanticResultPageInput,
  validateSemanticResultPageInput,
} from "./semantic-result-page.mjs";
import { executeFullText, validateFullTextInput } from "./full-text.mjs";
import { pageResultSnapshot } from "./result-snapshot.mjs";

const ACTIONS = new Set(["prepare", "update_terms"]);

function invalidActionResult() {
  return {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message: "action must be prepare or update_terms",
    },
  };
}

function isRemoteAuthRejected(result) {
  return result?.ok === false && result.error?.code === "REMOTE_AUTH_REJECTED";
}

async function executeWithTokenRecovery({
  signal,
  tokenManager,
  invoke,
  refreshMessage,
  retryAfterRefresh = false,
}) {
  const initialAuthorization = (await tokenManager.authorization({ signal })).authorization;
  const first = await invoke(initialAuthorization);
  if (!isRemoteAuthRejected(first)) return first;

  const refreshed = await tokenManager.refresh({ signal, rejectedAuthorization: initialAuthorization });
  if (retryAfterRefresh) {
    const second = await invoke(refreshed.authorization);
    if (!isRemoteAuthRejected(second)) return second;
    await tokenManager.refresh({ signal, rejectedAuthorization: refreshed.authorization });
    return {
      ...second,
      error: {
        ...second.error,
        code: "REMOTE_AUTH_REJECTED_NOT_RETRIED",
        message: refreshMessage,
      },
    };
  }
  return {
    ...first,
    error: {
      ...first.error,
      code: "REMOTE_AUTH_REJECTED_NOT_RETRIED",
      message: refreshMessage,
    },
  };
}

/** Execute one semantic-baseline action with bounded authentication recovery. */
export async function executeFusionTool({
  args,
  signal,
  tokenManager,
  fetchImpl,
  executeSemantic = executeSemanticBaseline,
} = {}) {
  const action = args && typeof args === "object" && !Array.isArray(args) ? args.action : undefined;
  if (!ACTIONS.has(action)) return invalidActionResult();
  return executeWithTokenRecovery({
    signal,
    tokenManager,
    refreshMessage: "Authentication was refreshed, but this mutating action was not replayed. Review remote state before retrying it.",
    invoke: (authorization) => executeSemantic({ args, authorization, signal, fetchImpl }),
  });
}

/**
 * Execute a saved-history Boolean search without replaying an uncertain request.
 * With `snapshots` the session's full result set is frozen at search time so
 * result pages never depend on the provider's per-account semantic cache.
 */
export async function executeFusionBooleanTool({
  args,
  signal,
  tokenManager,
  fetchImpl,
  semanticElementId,
  searchLock,
  snapshots,
  registry,
  executeBoolean = executeBooleanSearch,
} = {}) {
  const invalid = validateBooleanSearchInput(args);
  if (invalid) return invalid;
  return executeWithTokenRecovery({
    signal,
    tokenManager,
    refreshMessage: "Authentication was refreshed, but the Boolean search was not replayed. Check search history before submitting the query again.",
    invoke: (authorization) => executeBoolean({
      args,
      authorization,
      signal,
      fetchImpl,
      semanticElementId,
      searchLock,
      snapshots,
      registry,
    }),
  });
}

/**
 * Serve one result page. A session frozen at search time is paged locally —
 * no token, no network — so parallel sessions never read each other's rows.
 * A session without a snapshot falls back to the live read with one
 * auth-refresh retry.
 */
export async function executeFusionResultPageTool({
  args,
  signal,
  tokenManager,
  fetchImpl,
  registry,
  snapshots,
  executeResultPage = executeSemanticResultPage,
} = {}) {
  const invalid = validateSemanticResultPageInput(args);
  if (invalid) return invalid;
  const input = normalizeSemanticResultPageInput(args);
  const snapshot = snapshots?.get(input.sessionId) ?? null;
  if (snapshot) return pageResultSnapshot(snapshot, input.page);
  return executeWithTokenRecovery({
    signal,
    tokenManager,
    retryAfterRefresh: true,
    refreshMessage: "Authentication was refreshed, but the result-page read still failed. Retry the same session_id/page request.",
    invoke: (authorization) => executeResultPage({ args, authorization, signal, fetchImpl, registry }),
  });
}

/** Execute one idempotent full-text read with a single auth-refresh retry. */
export async function executeFusionFullTextTool({
  args,
  signal,
  tokenManager,
  fetchImpl,
  registry,
  executeFullTextImpl = executeFullText,
} = {}) {
  const invalid = validateFullTextInput(args);
  if (invalid) return invalid;
  return executeWithTokenRecovery({
    signal,
    tokenManager,
    retryAfterRefresh: true,
    refreshMessage: "Authentication was refreshed, but the full-text read still failed. Retry the same pnId.",
    invoke: (authorization) => executeFullTextImpl({ args, authorization, signal, fetchImpl, registry }),
  });
}

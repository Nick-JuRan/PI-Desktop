/**
 * Bounds for a renderer `session/get`.
 *
 * The host answers an unbounded `session.get` with the whole transcript in one
 * reply. The sidecar needs that reply to rebuild model context; the renderer
 * never does, yet a renderer read that omitted `messageLimit` received every
 * message of the session in one structured clone — for a long delegation run
 * that is a few hundred MB of tool results — and the renderer process died of
 * it (V8 OOM, exit code -536870904). Every renderer read is therefore bounded
 * at this one IPC entrance, with the defaults the session-open path already
 * used; a caller that needs more pages with `messageBefore` / `messageAround`.
 *
 * The sidecar's own `session.get` reaches host-core through the sidecar proxy,
 * not through this handler, so model context stays lossless.
 */

/** Messages a renderer read returns when it did not ask for a window size. */
export const RENDERER_SESSION_MESSAGE_LIMIT = 200;
/** Per-message display cap when the renderer did not ask for one. */
export const RENDERER_SESSION_CONTENT_LIMIT = 64 * 1024;
/** The host clamps a window to this many messages; mirrored so paging math stays honest. */
export const RENDERER_SESSION_MESSAGE_LIMIT_MAX = 1000;

export type SessionReadRequest = Readonly<{
  messageBefore?: number;
  messageAround?: string;
  messageLimit?: number;
  contentLimit?: number;
  topLevelOnly?: boolean;
  delegateOf?: readonly string[];
}>;

export type BoundedSessionRead = Readonly<{
  messageBefore?: number;
  messageAround?: string;
  messageLimit: number;
  contentLimit: number;
  topLevelOnly?: true;
  delegateOf?: string[];
}>;

/** The host accepts at most this many delegate call ids in one read. */
export const DELEGATE_READ_MAX_CALLS = 64;

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Normalize a renderer read into a window the renderer process can always hold. */
export function boundSessionRead(request: SessionReadRequest): BoundedSessionRead {
  const messageLimit = Math.min(
    positiveInteger(request.messageLimit) ?? RENDERER_SESSION_MESSAGE_LIMIT,
    RENDERER_SESSION_MESSAGE_LIMIT_MAX,
  );
  const contentLimit = positiveInteger(request.contentLimit) ?? RENDERER_SESSION_CONTENT_LIMIT;
  const messageAround =
    typeof request.messageAround === "string" && request.messageAround.trim()
      ? request.messageAround
      : undefined;
  const messageBefore =
    typeof request.messageBefore === "number" &&
    Number.isInteger(request.messageBefore) &&
    request.messageBefore >= 0
      ? request.messageBefore
      : undefined;
  // The row space: the rows of named delegate calls win over the top-level
  // rows; both are windowed like any other read.
  const delegateOf = Array.isArray(request.delegateOf)
    ? request.delegateOf
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
        .slice(0, DELEGATE_READ_MAX_CALLS)
    : [];
  return {
    ...(messageAround !== undefined ? { messageAround } : {}),
    ...(messageBefore !== undefined ? { messageBefore } : {}),
    messageLimit,
    contentLimit,
    ...(delegateOf.length > 0
      ? { delegateOf }
      : request.topLevelOnly === true
        ? { topLevelOnly: true as const }
        : {}),
  };
}

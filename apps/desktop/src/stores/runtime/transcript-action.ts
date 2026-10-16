import type { SessionRuntime } from "./session-runtime";
import type { StoreAccess } from "../slices/types";

/**
 * Make `messageId` canonical action input in the store before an explicit
 * action (edit, retry) reads it.
 *
 * The visible window is paged and display-capped, so its copy of a message is
 * not what the action may send. One bounded read centred on the message gets
 * the canonical copy: the host keeps the focused message's own text complete
 * and caps only its neighbours. A visible message is then replaced in place and
 * the window stays as it was; a message outside the window re-anchors the
 * window around it. Neither path reads the whole transcript — a long session
 * cannot be held by the renderer, and the action itself names ids to the host
 * (`truncateFromMessageId`), never an array of messages.
 */
export async function prepareTranscriptAction(
  { get, set }: StoreAccess,
  runtime: Pick<SessionRuntime, "readActionWindow" | "cacheSessionTranscript">,
  messageId: string,
  signal?: AbortSignal,
) {
  const state = get();
  const id = state.activeSessionId;
  if (signal?.aborted || !id || state.isRunning) return null;
  const history = state.sessionHistory[id];
  if (!history?.hasMoreBefore && !history?.contentLimited &&
    state.messages.some((message) => message.id === messageId)) return state;
  let session;
  try {
    // Cache ownership is checked after this asynchronous read, too: a new
    // turn may have already appended a live tail while the read was pending.
    session = await runtime.readActionWindow(id, messageId);
  } catch (error) {
    if (!signal?.aborted && get().activeSessionId === id)
      get().showToast(error instanceof Error ? error.message : String(error), { variant: "error" });
    return null;
  }
  const current = get();
  if (signal?.aborted || !session || current.activeSessionId !== id || current.isRunning || current.selectingSessionId ||
    current.messages !== state.messages) return null;
  const canonical = session.messages.find((message) => message.id === messageId);
  if (!canonical) return null;
  const visibleIndex = current.messages.findIndex((message) => message.id === messageId);
  if (visibleIndex >= 0) {
    const messages = current.messages.slice();
    messages[visibleIndex] = canonical;
    const window = current.sessionHistory[id];
    runtime.cacheSessionTranscript(id, messages, window);
    set({ messages });
    return get();
  }
  const window = {
    messageStart: session.messageStart ?? 0,
    hasMoreBefore: session.hasMoreBefore === true,
    contentLimited: true,
  };
  runtime.cacheSessionTranscript(id, session.messages, window);
  set({ messages: session.messages, sessionHistory: {
    ...current.sessionHistory, [id]: window,
  } });
  return get();
}

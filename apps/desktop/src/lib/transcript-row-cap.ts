import type { UiMessage } from "@pi-desktop/shared";
import type { SessionHistoryWindow } from "../stores/app-state";
import { TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET } from "./transcript-scroll";

/**
 * Rows a live transcript may hold in the renderer before its oldest rows are
 * released back to the host.
 *
 * A delegation run appends a tool row every second or two for an hour; each
 * row is already display-capped, but a few thousand of them — kept twice as
 * `content` and `toolResult`, mirrored into derived entries, and re-rendered
 * on every event — still exhaust the renderer. The transcript on disk keeps
 * every row; this only bounds the renderer's copy. Trimming runs back to the
 * auto-history budget so it fires once per few hundred rows, not per event.
 */
export const TRANSCRIPT_LIVE_ROW_CAP = 800;
export const TRANSCRIPT_LIVE_ROW_TRIM_TO = TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET;

export type TrimmedTranscript = {
  messages: UiMessage[];
  window: SessionHistoryWindow;
  dropped: number;
};

/**
 * Release the oldest rows of a transcript that grew past the cap at its tail.
 *
 * Only growth at the tail is trimmed: a page the reader just fetched prepends
 * rows, changes the first row, and must never be taken away again. The window
 * moves forward by the dropped count — those rows are durable or have long
 * since been persisted — and `hasMoreBefore` turns on, so the released history
 * is one page fetch away. Returns null when nothing has to change.
 */
export function trimLiveTranscriptTail(
  messages: UiMessage[],
  previous: UiMessage[] | undefined,
  window: SessionHistoryWindow | undefined,
  options: { cap?: number; trimTo?: number } = {},
): TrimmedTranscript | null {
  const cap = options.cap ?? TRANSCRIPT_LIVE_ROW_CAP;
  const trimTo = Math.min(options.trimTo ?? TRANSCRIPT_LIVE_ROW_TRIM_TO, cap);
  if (messages.length <= cap) return null;
  // Growth at the tail keeps the first row; a prepended page replaces it.
  if (previous && previous.length > 0 && previous[0]?.id !== messages[0]?.id) return null;
  const dropped = messages.length - trimTo;
  if (dropped <= 0) return null;
  return {
    messages: messages.slice(dropped),
    window: {
      messageStart: (window?.messageStart ?? 0) + dropped,
      hasMoreBefore: true,
      contentLimited: window?.contentLimited ?? true,
    },
    dropped,
  };
}

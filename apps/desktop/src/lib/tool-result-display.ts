import { formatToolValue } from "./tool-display";
import { TRANSCRIPT_CONTENT_LIMIT } from "./transcript-reading";

/**
 * Display caps for live tool results, mirroring what host-core applies to a
 * history page read with `contentLimit` (`record_to_ui_for_display`).
 *
 * A reloaded session never shows a tool payload beyond `contentLimit`, but the
 * live stream used to hand the renderer every `tool_end` result whole and keep
 * it twice (as `content` and as `toolResult`). A background delegation that
 * reads one patent full text every few seconds therefore grew the renderer heap
 * by the entire transcript while the session stayed open, until V8 ran out of
 * memory. The transcript keeps the full result; only the renderer's copy is
 * bounded, with the same marker text the host uses so the two paths read alike.
 */
export const DISPLAY_TRUNCATION_MARKER =
  "\n\n[truncated for display; the full content remains in the transcript]";
const VALUE_TRUNCATION_MARKER = "[truncated for display]";
/** Entries kept per array or object before the rest is replaced by a marker. */
const MAX_PREVIEW_ENTRIES = 256;

/** Characters of one live tool result the renderer keeps. */
export const LIVE_TOOL_RESULT_DISPLAY_LIMIT = TRANSCRIPT_CONTENT_LIMIT;

/**
 * Count the code points of `text`, stopping once `stopAt` have been seen.
 * Returns the count and the UTF-16 offset reached, so a caller can both decide
 * whether a string fits and know where to cut it without walking the rest of a
 * multi-MB payload or allocating one array element per character.
 */
function scanCodePoints(text: string, stopAt: number): { count: number; offset: number } {
  let offset = 0;
  let count = 0;
  while (offset < text.length && count < stopAt) {
    const code = text.charCodeAt(offset);
    // A high surrogate followed by a low surrogate is one code point.
    offset +=
      code >= 0xd800 && code <= 0xdbff && offset + 1 < text.length ? 2 : 1;
    count += 1;
  }
  return { count, offset };
}

/**
 * Code points in `text`, exact up to `limit`; a longer string reports
 * `limit + 1`, so the scan never walks past what the caller can use.
 */
export function countCodePoints(text: string, limit: number = Number.POSITIVE_INFINITY): number {
  return scanCodePoints(text, Math.min(text.length, limit + 1)).count;
}

/** Keep the head of `text` within `limit` characters (code points), marker included. */
export function truncateDisplayText(text: string, limit: number): string {
  // The UTF-16 length bounds the code point count, so a string this short fits
  // without a scan — the common case for every row that is not a huge payload.
  if (text.length <= limit) return text;
  // Scan only as far as the limit: a multi-MB tool result costs O(limit).
  const reach = scanCodePoints(text, limit + 1);
  if (reach.count <= limit) return text;
  const markerLength = DISPLAY_TRUNCATION_MARKER.length; // ASCII: one unit per code point
  if (limit <= markerLength) return DISPLAY_TRUNCATION_MARKER.slice(0, limit);
  const head = scanCodePoints(text, limit - markerLength);
  return text.slice(0, head.offset) + DISPLAY_TRUNCATION_MARKER;
}

/**
 * Bound a structured value by one shared character budget, keeping its shape:
 * strings are clipped, long arrays and objects are cut with a marker, and any
 * value met after the budget is spent becomes the marker.
 */
export function previewValue(value: unknown, limit: number): unknown {
  const budget = { left: Math.max(1, limit) };
  const walk = (node: unknown): unknown => {
    if (budget.left === 0) return VALUE_TRUNCATION_MARKER;
    if (typeof node === "string") {
      const clipped = truncateDisplayText(node, budget.left);
      budget.left = Math.max(0, budget.left - countCodePoints(clipped, budget.left));
      return clipped;
    }
    if (Array.isArray(node)) {
      const output: unknown[] = [];
      for (const item of node) {
        if (budget.left === 0 || output.length >= MAX_PREVIEW_ENTRIES) {
          output.push(VALUE_TRUNCATION_MARKER);
          break;
        }
        output.push(walk(item));
      }
      return output;
    }
    if (node && typeof node === "object") {
      const output: Record<string, unknown> = {};
      let kept = 0;
      for (const [key, item] of Object.entries(node)) {
        if (budget.left === 0 || kept >= MAX_PREVIEW_ENTRIES) {
          output._truncated = true;
          break;
        }
        output[key] = walk(item);
        kept += 1;
      }
      return output;
    }
    return node;
  };
  return walk(value);
}

/** The renderer's copy of a live tool result: display text plus a bounded value. */
export function capToolResultForDisplay(
  result: unknown,
  limit: number = LIVE_TOOL_RESULT_DISPLAY_LIMIT,
): { content: string; toolResult: unknown } {
  if (typeof result === "string") {
    const content = truncateDisplayText(result, limit);
    return { content, toolResult: content };
  }
  const toolResult = previewValue(result, limit);
  return { content: truncateDisplayText(formatToolValue(toolResult), limit), toolResult };
}

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

/** Keep the head of `text` within `limit` characters, marker included. */
export function truncateDisplayText(text: string, limit: number): string {
  const chars = Array.from(text);
  if (chars.length <= limit) return text;
  const marker = Array.from(DISPLAY_TRUNCATION_MARKER);
  if (limit <= marker.length) return marker.slice(0, limit).join("");
  return chars.slice(0, limit - marker.length).join("") + DISPLAY_TRUNCATION_MARKER;
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
      budget.left = Math.max(0, budget.left - Array.from(clipped).length);
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

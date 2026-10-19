import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readTranscriptSource } from "./helpers/source-contracts.mjs";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  autoHistoryFetchAllowed,
  TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET,
} = await import("../src/lib/transcript-scroll.ts");
const { TRANSCRIPT_PAGE_SIZE } = await import("../src/lib/transcript-reading.ts");
const {
  countCodePoints,
  DISPLAY_TRUNCATION_MARKER,
  truncateDisplayText,
} = await import("../src/lib/tool-result-display.ts");

test("automatic history progression stops at the row budget; the budget is a few pages", () => {
  assert.equal(autoHistoryFetchAllowed(0), true);
  assert.equal(autoHistoryFetchAllowed(TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET - 1), true);
  assert.equal(autoHistoryFetchAllowed(TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET), false);
  assert.equal(autoHistoryFetchAllowed(10_000), false);
  assert.ok(TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET >= 3 * TRANSCRIPT_PAGE_SIZE, "at least three pages load on their own");
  assert.ok(TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET <= 10 * TRANSCRIPT_PAGE_SIZE, "but not a whole long session");
});

test("the hook budgets only automatic progression and keeps every reader gesture", async () => {
  const source = await readTranscriptSource();
  // The history-boundary observer (D269) is automatic; a scroll event the
  // reader produced, the minimap control, and the explicit button are gestures.
  assert.match(source, /reachTop\("auto"\);\s*\}\);\s*\};/, "the boundary observer advances as automatic progression");
  assert.match(source, /reachTop\(gesturing \? "gesture" : "auto"\)/);
  assert.match(source, /if \(isHistoryRevealPosition\(el\)\) \{\s*reachTop\("gesture"\);/);
  assert.match(source, /const loadEarlierHistory = useCallback\(\(\) => \{[\s\S]*?loadOlder\("gesture"\);/);
  assert.match(source, /if \(source === "auto" && !autoHistoryFetchAllowed\(messages\.length\)\) return;/);
  // Growing the mounted window is never budgeted: it comes before the fetch.
  assert.match(source, /const grown = growTranscriptWindow\(windowSize, historyLengthRef\.current\);[\s\S]*?setWindowSize\(grown\);\s*return;\s*\}\s*loadOlder\(source\);/);
  // The paused state is surfaced as an explicit control, one page per press.
  assert.match(source, /historyFetchPaused && !loadingOlder \? \([\s\S]*?onClick=\{loadEarlierHistory\}[\s\S]*?chat\.loadEarlierMessages/);
});

test("the paused boundary offers the conversation start, and an explicit load keeps the viewport at the top", async () => {
  const source = await readTranscriptSource();
  // Two controls once automatic progression paused: the next older page, and the
  // start of the conversation in one request. The latter is absent when the
  // source cannot seek by offset (remote history).
  assert.match(
    source,
    /historyFetchPaused && !loadingOlder \? \([\s\S]*?onClick=\{loadEarlierHistory\}[\s\S]*?\{onOpenStart \? \([\s\S]*?onClick=\{onOpenStart\}[\s\S]*?chat\.openConversationStart/,
  );
  // The explicit press holds the viewport at the top through the page landing
  // and the window growth, and releases follow; a reader gesture ends the hold.
  assert.match(source, /const loadEarlierHistory = useCallback\(\(\) => \{\s*holdTopRef\.current = true;\s*releaseFollow\(\);\s*loadOlder\("gesture"\);/);
  assert.match(source, /if \(holdTopRef\.current\) \{\s*el\.scrollTop = 0;[\s\S]*?return;\s*\}\s*const delta = el\.scrollHeight - previousHeight;/);
  assert.match(source, /if \(gesturing\) holdTopRef\.current = false;/);
  assert.match(source, /const jumpToLatest = useCallback\(\(\) => \{[\s\S]*?pinnedRef\.current = true;\s*holdTopRef\.current = false;/);
});

test("the session pane wires the conversation start for local sessions only", async () => {
  const { readFile } = await import("node:fs/promises");
  const pane = await readFile(new URL("../src/components/SessionPane.tsx", import.meta.url), "utf8");
  assert.match(pane, /onOpenStart=\{isRemoteSession\(\{ id: sessionId \}\) \? undefined : \(\) => void openTranscriptStart\(sessionId\)\}/);
});

test("display truncation costs O(limit) on a multi-MB payload and counts code points", () => {
  const huge = "x".repeat(8 * 1024 * 1024);
  const started = performance.now();
  const clipped = truncateDisplayText(huge, 1_000);
  const elapsed = performance.now() - started;
  assert.ok(clipped.endsWith(DISPLAY_TRUNCATION_MARKER));
  assert.equal(clipped.length, 1_000);
  assert.ok(elapsed < 200, `truncating 8 MB took ${elapsed.toFixed(1)} ms`);

  // Astral characters are one code point each: six emoji (12 UTF-16 units) fit a limit of 6.
  const emoji = "😀".repeat(6);
  assert.equal(truncateDisplayText(emoji, 6), emoji);
  assert.equal(countCodePoints(emoji), 6);
  assert.equal(countCodePoints(emoji, 3), 4, "a longer string reports limit + 1");
  // A cut never splits a surrogate pair.
  const cut = truncateDisplayText("😀".repeat(200), DISPLAY_TRUNCATION_MARKER.length + 5);
  assert.equal(cut, "😀".repeat(5) + DISPLAY_TRUNCATION_MARKER);
  assert.equal(truncateDisplayText("short", 10), "short");
  assert.equal(truncateDisplayText("abcdef", 3), DISPLAY_TRUNCATION_MARKER.slice(0, 3));
});

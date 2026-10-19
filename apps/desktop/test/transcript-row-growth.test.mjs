import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readStoreModule, readTranscriptSource } from "./helpers/source-contracts.mjs";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  autoHistoryFetchAllowed,
  TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET,
} = await import("../src/lib/transcript-scroll.ts");
const {
  trimLiveTranscriptTail,
  TRANSCRIPT_LIVE_ROW_CAP,
  TRANSCRIPT_LIVE_ROW_TRIM_TO,
} = await import("../src/lib/transcript-row-cap.ts");
const { TRANSCRIPT_PAGE_SIZE } = await import("../src/lib/transcript-reading.ts");
const {
  countCodePoints,
  DISPLAY_TRUNCATION_MARKER,
  truncateDisplayText,
} = await import("../src/lib/tool-result-display.ts");

const row = (id, role = "tool") => ({ id, role, content: id, createdAt: "2026-10-19T00:00:00Z" });
const rows = (count, prefix = "m") => Array.from({ length: count }, (_, index) => row(`${prefix}${index}`));

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
  assert.match(source, /const loadEarlierHistory = useCallback\(\(\) => \{\s*loadOlder\("gesture"\);/);
  assert.match(source, /if \(source === "auto" && !autoHistoryFetchAllowed\(messages\.length\)\) return;/);
  // Growing the mounted window is never budgeted: it comes before the fetch.
  assert.match(source, /const grown = growTranscriptWindow\(windowSize, historyLengthRef\.current\);[\s\S]*?setWindowSize\(grown\);\s*return;\s*\}\s*loadOlder\(source\);/);
  // The paused state is surfaced as an explicit control, one page per press.
  assert.match(source, /historyFetchPaused && !loadingOlder \? \([\s\S]*?onClick=\{loadEarlierHistory\}[\s\S]*?chat\.loadEarlierMessages/);
});

test("a live tail that grows past the cap releases its oldest rows and keeps them one page away", () => {
  const previous = rows(TRANSCRIPT_LIVE_ROW_CAP);
  const grown = [...previous, row("fresh")];
  const window = { messageStart: 40, hasMoreBefore: false, contentLimited: true };
  const trimmed = trimLiveTranscriptTail(grown, previous, window);
  assert.ok(trimmed);
  assert.equal(trimmed.messages.length, TRANSCRIPT_LIVE_ROW_TRIM_TO);
  assert.equal(trimmed.messages.at(-1).id, "fresh", "the newest rows stay");
  assert.equal(trimmed.messages[0].id, grown[trimmed.dropped].id);
  assert.deepEqual(trimmed.window, {
    messageStart: 40 + trimmed.dropped,
    hasMoreBefore: true,
    contentLimited: true,
  });
  assert.ok(TRANSCRIPT_LIVE_ROW_TRIM_TO < TRANSCRIPT_LIVE_ROW_CAP, "hysteresis: trimming is not per event");
});

test("a fetched older page is never trimmed away, and a transcript under the cap is left alone", () => {
  const tail = rows(TRANSCRIPT_LIVE_ROW_CAP - 50, "t");
  // Paging prepends rows and changes the first row: the reader asked for them.
  const paged = [...rows(TRANSCRIPT_PAGE_SIZE, "older"), ...tail];
  assert.equal(trimLiveTranscriptTail(paged, tail, { messageStart: 100, hasMoreBefore: true }), null);
  // Growth that stays under the cap costs nothing.
  assert.equal(trimLiveTranscriptTail([...tail, row("x")], tail, { messageStart: 0, hasMoreBefore: false }), null);
  // A first publication (no previous rows) past the cap is trimmed too.
  const big = rows(TRANSCRIPT_LIVE_ROW_CAP + 10);
  assert.equal(trimLiveTranscriptTail(big, undefined, undefined)?.messages.length, TRANSCRIPT_LIVE_ROW_TRIM_TO);
  assert.equal(trimLiveTranscriptTail(big, [], undefined)?.window.messageStart, 10 + (TRANSCRIPT_LIVE_ROW_CAP - TRANSCRIPT_LIVE_ROW_TRIM_TO));
});

test("the live tail is released only while the reader follows it, and never from a reading window", async () => {
  const transcript = await readTranscriptSource();
  const store = await readStoreModule("slices/transcript-slice.ts");
  const runtimeSource = await readStoreModule("runtime/session-runtime.ts");
  // The hook decides when: pane on screen, no historical window, reader pinned
  // to the bottom, and the tail over the cap.
  assert.match(
    transcript,
    /useEffect\(\(\) => \{\s*if \(!paneVisible \|\| readingWindow \|\| !onReleaseOlder\) return;\s*if \(!pinnedRef\.current \|\| messages\.length <= TRANSCRIPT_LIVE_ROW_CAP\) return;\s*onReleaseOlder\(\);\s*\}, \[messages\.length, onReleaseOlder, paneVisible, readingWindow\]\);/,
  );
  // The store does the release for the active session only, moving the window
  // forward so the rows stay one page away; the cache follows the store.
  assert.match(
    store,
    /releaseLiveTranscriptHead: \(sessionId\) => \{[\s\S]*?if \(state\.activeSessionId !== sessionId\) return;[\s\S]*?trimLiveTranscriptTail\(state\.messages, undefined, state\.sessionHistory\[sessionId\]\)[\s\S]*?runtime\.cacheSessionTranscript\(sessionId, trimmed\.messages, trimmed\.window\)[\s\S]*?messages: trimmed\.messages,\s*sessionHistory: \{ \.\.\.current\.sessionHistory, \[sessionId\]: trimmed\.window \}/,
  );
  // A background session has no reader; its cache is bounded where it streams.
  assert.match(
    runtimeSource,
    /function cacheBackgroundTranscriptEvent\([\s\S]*?const trimmed = trimLiveTranscriptTail\(next, current, window\);[\s\S]*?trimmed \? trimmed\.messages : next,\s*trimmed \? trimmed\.window : window,/,
  );
  // The store subscriber that mirrors every publication does not trim: a reader
  // scrolled up in a live session must keep the rows under their viewport.
  const projection = runtimeSource.match(/function syncTranscriptProjection\([\s\S]*?\n  \}\n/)?.[0];
  assert.ok(projection, "syncTranscriptProjection must exist");
  assert.doesNotMatch(projection, /trimLiveTranscriptTail/);
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

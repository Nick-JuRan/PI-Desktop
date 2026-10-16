import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readStoreModule } from "./helpers/source-contracts.mjs";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const {
  capToolResultForDisplay,
  DISPLAY_TRUNCATION_MARKER,
  LIVE_TOOL_RESULT_DISPLAY_LIMIT,
  previewValue,
  truncateDisplayText,
} = await import("../src/lib/tool-result-display.ts");
const { TRANSCRIPT_CONTENT_LIMIT } = await import("../src/lib/transcript-reading.ts");

test("live tool results are capped at the same display limit a reloaded page uses", () => {
  assert.equal(LIVE_TOOL_RESULT_DISPLAY_LIMIT, TRANSCRIPT_CONTENT_LIMIT);
  const huge = "x".repeat(LIVE_TOOL_RESULT_DISPLAY_LIMIT * 20);
  const { content, toolResult } = capToolResultForDisplay(huge);
  assert.ok(content.length <= LIVE_TOOL_RESULT_DISPLAY_LIMIT, "content stays within the limit");
  assert.ok(content.endsWith(DISPLAY_TRUNCATION_MARKER), "the host's marker names the cut");
  assert.equal(toolResult, content, "a string result is kept once, not twice");
});

test("short results pass through untouched", () => {
  const small = { path: "a.ts", content: "let a = 1;", truncated: false };
  const { content, toolResult } = capToolResultForDisplay(small);
  assert.deepEqual(toolResult, small);
  assert.equal(content, JSON.stringify(small, null, 2));
  assert.equal(truncateDisplayText("short", 10), "short");
});

test("structured results keep their shape and clip their strings under one shared budget", () => {
  const result = {
    content: "y".repeat(5_000),
    path: "patent.txt",
    list: Array.from({ length: 400 }, (_, index) => `item ${index}`),
  };
  const preview = previewValue(result, 1_000);
  assert.ok(typeof preview.content === "string" && preview.content.length <= 1_000);
  assert.ok(preview.content.endsWith(DISPLAY_TRUNCATION_MARKER));
  // Once the budget is spent the object is cut and flagged, as host-core does.
  assert.equal(preview._truncated, true);
  assert.equal("path" in preview, false);
  assert.deepEqual(previewValue(["a".repeat(10), "b"], 10), ["a".repeat(10), "[truncated for display]"]);

  const roomy = previewValue(result, 1_000_000);
  assert.equal(roomy.path, "patent.txt");
  assert.equal(roomy.list.length, 257, "long arrays are cut at 256 entries plus a marker");
  assert.equal(roomy.list.at(-1), "[truncated for display]");
  const wide = previewValue(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`k${i}`, i])), 1_000_000);
  assert.equal(Object.keys(wide).length, 257);
  assert.equal(wide._truncated, true);
});

test("the live stream stores only the display copy of a tool result", async () => {
  const eventsSource = await readStoreModule("slices/events-slice.ts");
  const runtimeSource = await readStoreModule("runtime/session-runtime.ts");
  for (const source of [eventsSource, runtimeSource]) {
    // tool_end and tool_update both go through the cap; neither keeps the raw
    // `event.result` / `event.partialResult` as content or toolResult.
    assert.match(source, /capToolResultForDisplay\(event\.result\)/);
    assert.match(source, /capToolResultForDisplay\(event\.partialResult\)/);
    assert.doesNotMatch(source, /toolResult:\s*event\.(result|partialResult)/);
    assert.doesNotMatch(source, /JSON\.stringify\(event\.result/);
  }
});

import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readStoreModule, readMainSource } from "./helpers/source-contracts.mjs";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { mergeLiveSessionMessages } = await import("../src/lib/session-transcript.ts");

test("deleteMessage names the row to the host and never rewrites the transcript from a renderer array", async () => {
  const sliceSource = await readStoreModule("slices/transcript-slice.ts");
  const deleteSource = sliceSource.match(/deleteMessage:\s*async\s*\(messageId\)\s*=>\s*\{[\s\S]*?\n    \},\n/)?.[0];
  assert.ok(deleteSource, "deleteMessage action must exist");

  // The host applies the turn rule and rewrites the transcript itself. A
  // paged, display-capped window must never become the next transcript, and
  // the whole transcript must never be read into the renderer to delete one
  // turn of it (a 200 MB session killed the renderer on exactly that read).
  assert.match(deleteSource, /await\s+api\.deleteSessionMessage\(sessionId,\s*messageId\)/);
  assert.doesNotMatch(deleteSource, /loadFullSessionMessages|replaceSessionMessages|api\.getSession\(/);

  // Outputs that land during the await (#1614) are not merged from a renderer
  // snapshot any more: the host drains the outbox before it cuts, and the
  // renderer reconciles its window with the ids the host actually removed,
  // after re-reading the store and re-checking the active session.
  assert.match(
    deleteSource,
    /const \{ deletedIds \} = await api\.deleteSessionMessage[\s\S]*?const current = get\(\);\s*if \(current\.activeSessionId !== sessionId\) return;[\s\S]*?mergeLiveSessionMessages\(previous, current\.messages\)\.filter\(/,
    "deleteMessage must reconcile the post-await store with the host's deletedIds",
  );
  // A host refusal (a turn started meanwhile: AGENT_BUSY) restores the window.
  assert.match(deleteSource, /catch \(error\) \{[\s\S]*?runtime\.cacheSessionTranscript\(sessionId, previous, window\)/);
});

test("the renderer never asks the host for an unbounded transcript", async () => {
  const runtimeSource = await readStoreModule("runtime/session-runtime.ts");
  const sliceSource = await readStoreModule("slices/transcript-slice.ts");
  const actionSource = await readStoreModule("runtime/transcript-action.ts");
  for (const source of [runtimeSource, sliceSource, actionSource]) {
    assert.doesNotMatch(source, /api\.getSession\([a-zA-Z.]+\)/, "every renderer detail read passes a window");
    assert.doesNotMatch(source, /loadFullSessionMessages/);
  }
  assert.match(runtimeSource, /readSettledTail[\s\S]*?messageLimit: TRANSCRIPT_PAGE_SIZE,\s*contentLimit: TRANSCRIPT_CONTENT_LIMIT/);
  assert.match(runtimeSource, /readActionWindow[\s\S]*?messageAround: messageId,\s*messageLimit: TRANSCRIPT_PAGE_SIZE,\s*contentLimit: TRANSCRIPT_CONTENT_LIMIT/);
});

test("sessionReplaceMessages and sessionActivateRevision share one rewrite boundary with drain and guards", async () => {
  const sessionIpcSource = await readMainSource("ipc/session-ipc.ts");

  // The shared gate: refuse while a turn runs, serialize overlapping
  // operations, then drain the outbox before the callers' rewrite runs (#1612, #1613).
  assert.match(
    sessionIpcSource,
    /const\s+runTranscriptRewrite\s*=\s*async[\s\S]*?acquireSessionOperation\(sessionId\)[\s\S]*?activeTurns\.has\(sessionId\)[\s\S]*?AGENT_BUSY[\s\S]*?await\s+persistenceOutbox\.prepareSessionReplacement\(sessionId,[\s\S]*?finally\s*\{[\s\S]*?releaseSessionOperation\(\);/,
    "the rewrite gate must serialize per session, refuse running turns, and drain the outbox",
  );
  assert.match(
    sessionIpcSource,
    /beginTranscriptRewrite\(sessionId\)[\s\S]*?await\s+persistenceOutbox\.prepareSessionReplacement[\s\S]*?const\s+result\s*=\s*await\s+run\(\);[\s\S]*?rewriteFence\.commit\(\);[\s\S]*?catch\s*\(error\)\s*\{\s*rewriteFence\?\.rollback\(\);/,
    "the rewrite gate must fence late appends before draining and settle the fence according to the host rewrite result",
  );

  // Both rewrite entrances route through the gate — activation had no drain
  // before #1612, and overlapping replaces could interleave (#1613).
  assert.match(
    sessionIpcSource,
    /IPC\.invoke\.sessionReplaceMessages[\s\S]*?runTranscriptRewrite\(\s*sessionId,\s*"transcript replacement"[\s\S]*?session\.replaceMessages/,
    "sessionReplaceMessages must go through the shared rewrite gate",
  );
  assert.match(
    sessionIpcSource,
    /IPC\.invoke\.sessionActivateRevision[\s\S]*?runTranscriptRewrite\(\s*sessionId,\s*"revision activation"[\s\S]*?session\.activateRevision/,
    "sessionActivateRevision must go through the shared rewrite gate (it rewrites the same transcript rows)",
  );
  assert.match(
    sessionIpcSource,
    /IPC\.invoke\.sessionDeleteMessage[\s\S]*?runTranscriptRewrite\(\s*sessionId,\s*"message deletion"[\s\S]*?session\.deleteMessage/,
    "sessionDeleteMessage must go through the shared rewrite gate (the host rewrites the transcript for it)",
  );
  // The rewritten transcript never travels back to the renderer: activation
  // answers with an acknowledgement and the renderer re-reads a bounded page.
  assert.match(
    sessionIpcSource,
    /"revision activation"[\s\S]*?\);\s*return \{ ok: true as const \};/,
  );
});

test("every renderer session/get is a bounded window", async () => {
  const sessionIpcSource = await readMainSource("ipc/session-ipc.ts");
  assert.match(
    sessionIpcSource,
    /IPC\.invoke\.sessionGet,[\s\S]*?const window = boundSessionRead\(request\);[\s\S]*?host\.call<\{ session\?: RuntimeSession \| null \}>\("session\.get", \{ id, \.\.\.window \}\)/,
    "the renderer-facing session/get must pass the bounded window to the host",
  );
});

test("mergeLiveSessionMessages preserves live AI outputs when backend disk is missing them, and only deleted turn is removed", () => {
  // Simulate backend host-core having only user messages persisted (e.g. outbox was pending or full)
  const durableMessages = [
    { id: "u1", role: "user", content: "first task", status: "complete" },
    { id: "u2", role: "user", content: "second task", status: "complete" },
    { id: "u3", role: "user", content: "third task", status: "complete" },
  ];

  // Live messages currently in renderer UI (containing streaming/completed AI outputs for all turns)
  const liveMessages = [
    { id: "u1", role: "user", content: "first task", status: "complete" },
    { id: "a1", role: "assistant", content: "first ai answer", status: "complete" },
    { id: "u2", role: "user", content: "second task", status: "complete" },
    { id: "t2", role: "tool", content: "tool result for second task", status: "complete" },
    { id: "a2", role: "assistant", content: "second ai answer", status: "complete" },
    { id: "u3", role: "user", content: "third task", status: "complete" },
    { id: "a3", role: "assistant", content: "third ai answer", status: "complete" },
  ];

  // 1. Merge must preserve all live AI outputs
  const merged = mergeLiveSessionMessages(durableMessages, liveMessages);
  assert.equal(merged.length, 7, "All 7 messages must be preserved after merging");

  // 2. Perform the turn rule the host applies in `sessions::delete_message` on turn 2 ("u2")
  const index = merged.findIndex((m) => m.id === "u2");
  assert.equal(index, 2);

  let end = index + 1;
  while (end < merged.length && merged[end].role !== "user") {
    end += 1;
  }
  assert.equal(end, 5, "Turn 2 covers u2, t2, a2 (indices 2, 3, 4)");

  const next = [...merged.slice(0, index), ...merged.slice(end)];
  const nextIds = next.map((m) => m.id);

  // 3. Assert that turn 1 (u1, a1) and turn 3 (u3, a3) retain their complete user + AI messages!
  assert.deepEqual(nextIds, ["u1", "a1", "u3", "a3"]);
  assert.equal(next[0].role, "user");
  assert.equal(next[1].role, "assistant");
  assert.equal(next[2].role, "user");
  assert.equal(next[3].role, "assistant");
});

test("outputs that arrive during a reload survive a durable/live merge", () => {
  // Durable transcript (host has the pre-tail state); the store already saw
  // the aborted turn's final output, which lands during the reload await.
  const durableAtLoadEnd = [
    { id: "u1", role: "user", content: "task", status: "complete" },
    { id: "u2", role: "user", content: "second task", status: "complete" },
    { id: "a2", role: "assistant", content: "second answer", status: "complete" },
  ];
  const storeAfterAwait = [
    ...durableAtLoadEnd,
    { id: "t2", role: "tool", content: "late tool_end for the aborted turn", status: "complete" },
  ];

  // The pre-await snapshot (#1614 bug shape) missed the late tool row:
  const staleMerged = mergeLiveSessionMessages(durableAtLoadEnd, durableAtLoadEnd.slice(0, 2));
  assert.ok(
    !staleMerged.some((m) => m.id === "t2"),
    "reproduces the bug shape: the stale snapshot drops the arriving output",
  );

  // The fix reads the store after the await, so the late output survives the
  // merge that feeds both the view and the persistence payload.
  const merged = mergeLiveSessionMessages(durableAtLoadEnd, storeAfterAwait);
  assert.ok(merged.some((m) => m.id === "t2"), "late-arriving output survives the merge");
});

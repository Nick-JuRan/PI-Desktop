import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readStoreModule, readTranscriptSource } from "./helpers/source-contracts.mjs";
import { boundSessionRead, DELEGATE_READ_MAX_CALLS } from "../electron/main/ipc/session-read-bounds.ts";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createTranscriptSlice } = await import("../src/stores/slices/transcript-slice.ts");
const { api } = await import("../src/lib/api.ts");
const { buildSubagentTranscript } = await import("../src/lib/subagent-transcript.ts");
const { TRANSCRIPT_CONTENT_LIMIT, TRANSCRIPT_DELEGATE_ROW_LIMIT } = await import("../src/lib/transcript-reading.ts");

const row = (id, extra = {}) => ({ id, role: "tool", content: id, createdAt: "2026-10-19T00:00:00Z", status: "complete", ...extra });
const user = (id) => ({ id, role: "user", content: id, createdAt: "2026-10-19T00:00:00Z", status: "complete" });
const task = (id, delegationId) =>
  row(id, { toolName: "Task", toolCallId: id, toolStatus: "success", toolArgs: { task: `brief ${id}` },
    toolResult: { details: { delegationId, status: "completed" } } });

function stateHarness(state) {
  return { get: () => state, set: (update) => { Object.assign(state, typeof update === "function" ? update(state) : update); } };
}

test("the IPC bound passes the row space through: top-level, or the rows of named delegate calls", () => {
  assert.deepEqual(boundSessionRead({ messageLimit: 100, contentLimit: 4096, topLevelOnly: true }), {
    messageLimit: 100, contentLimit: 4096, topLevelOnly: true,
  });
  // A delegate read names its calls and wins over a top-level flag; ids are
  // trimmed, blanks dropped, and the list is capped at the host's limit.
  assert.deepEqual(
    boundSessionRead({ messageLimit: 50, contentLimit: 4096, topLevelOnly: true, delegateOf: [" task-1 ", "", "task-2"] }),
    { messageLimit: 50, contentLimit: 4096, delegateOf: ["task-1", "task-2"] },
  );
  const many = Array.from({ length: DELEGATE_READ_MAX_CALLS + 5 }, (_, index) => `call-${index}`);
  assert.equal(boundSessionRead({ messageLimit: 10, delegateOf: many }).delegateOf.length, DELEGATE_READ_MAX_CALLS);
  // Neither flag appears unless asked for, so a physical read stays physical.
  assert.deepEqual(Object.keys(boundSessionRead({ messageLimit: 10 })).sort(), ["contentLimit", "messageLimit"]);
  assert.deepEqual(Object.keys(boundSessionRead({ messageLimit: 10, topLevelOnly: false, delegateOf: [] })).sort(), ["contentLimit", "messageLimit"]);
});

test("opening a delegation reads its rows once and merges them under their Task", async () => {
  const id = "s1";
  const state = {
    activeSessionId: id,
    sessions: [{ id }],
    messages: [user("u1"), task("task-1", "delegation-1"), row("a1", { role: "assistant" })],
    retainedTranscripts: {},
    sessionHistory: { [id]: { messageStart: 40, hasMoreBefore: true, contentLimited: true } },
    runningSessions: {},
    isRunning: false,
    showToast: () => assert.fail("a successful read shows no toast"),
  };
  const reads = [];
  const originalGet = api.getSession;
  api.getSession = async (sessionId, options) => {
    reads.push({ sessionId, options });
    return { session: { id: sessionId, messages: [
      row("d1", { parentToolCallId: "task-1", agentName: "patent-reader" }),
      row("d2", { parentToolCallId: "task-1", agentName: "patent-reader" }),
    ], messageStart: 0, hasMoreBefore: false } };
  };
  const cached = [];
  const runtime = { cacheSessionTranscript: (_id, rows, window) => cached.push({ rows, window }) };
  try {
    const slice = createTranscriptSlice({ ...stateHarness(state), runtime });
    // Before the read the delegation has a turn with no rows: the shape a
    // reopened session shows, since history pages are top-level only.
    assert.deepEqual(buildSubagentTranscript(state.messages, "delegation-1").turns.map((turn) => turn.rows.length), [0]);
    await Promise.all([
      slice.loadDelegateRows(id, ["task-1"]),
      slice.loadDelegateRows(id, ["task-1"]),
    ]);
    assert.equal(reads.length, 1, "concurrent opens share one read");
    assert.deepEqual(reads[0], {
      sessionId: id,
      options: { delegateOf: ["task-1"], messageLimit: TRANSCRIPT_DELEGATE_ROW_LIMIT, contentLimit: TRANSCRIPT_CONTENT_LIMIT },
    });
    assert.deepEqual(state.messages.map((message) => message.id), ["u1", "task-1", "a1", "d1", "d2"]);
    // The window is untouched: delegate rows are not part of the top-level space.
    assert.deepEqual(state.sessionHistory[id], { messageStart: 40, hasMoreBefore: true, contentLimited: true });
    assert.equal(cached.at(-1).rows, state.messages);
    assert.deepEqual(buildSubagentTranscript(state.messages, "delegation-1").turns.map((turn) => turn.rows.map((item) => item.message.id)), [["d1", "d2"]]);
    // Opening again later asks nothing more.
    await slice.loadDelegateRows(id, ["task-1"]);
    assert.equal(reads.length, 1);
    // A delegation that is not the active session lands in its retained pane.
    state.activeSessionId = "other";
    state.retainedTranscripts = { [id]: state.messages };
    api.getSession = async () => ({ session: { id, messages: [row("d3", { parentToolCallId: "task-2" })], messageStart: 0, hasMoreBefore: false } });
    await slice.loadDelegateRows(id, ["task-2"]);
    assert.deepEqual(state.retainedTranscripts[id].map((message) => message.id), ["u1", "task-1", "a1", "d1", "d2", "d3"]);
  } finally {
    api.getSession = originalGet;
  }
});

test("a failed delegate read is reported once and retried on the next open", async () => {
  const id = "s1";
  const toasts = [];
  const state = {
    activeSessionId: id, sessions: [{ id }], messages: [task("task-1", "delegation-1")],
    retainedTranscripts: {}, sessionHistory: {}, runningSessions: {}, isRunning: false,
    showToast: (message) => toasts.push(message),
  };
  const originalGet = api.getSession;
  let attempts = 0;
  api.getSession = async () => { attempts += 1; throw new Error("host unavailable"); };
  try {
    const slice = createTranscriptSlice({ ...stateHarness(state), runtime: { cacheSessionTranscript() {} } });
    await slice.loadDelegateRows(id, ["task-1"]);
    await slice.loadDelegateRows(id, ["task-1"]);
    assert.equal(attempts, 2, "a failure does not pin the key");
    assert.deepEqual(toasts, ["host unavailable", "host unavailable"]);
    assert.equal(state.messages.length, 1);
  } finally {
    api.getSession = originalGet;
  }
});

test("every main-view read is top-level; search keeps every row; the two open paths request delegate rows", async () => {
  const sessionSlice = await readStoreModule("slices/session-slice.ts");
  const runtimeSource = await readStoreModule("runtime/session-runtime.ts");
  const readingSource = await readStoreModule("runtime/transcript-reading-runtime.ts");
  const transcript = await readTranscriptSource();
  const { readFile } = await import("node:fs/promises");
  const tab = await readFile(new URL("../src/components/workpanel/SubagentTranscriptTab.tsx", import.meta.url), "utf8");

  assert.equal((sessionSlice.match(/contentLimit: 64 \* 1024,\s*topLevelOnly: true,/g) ?? []).length, 3, "open, prefetch and the empty-read retry page top-level rows");
  assert.match(runtimeSource, /readSettledTail[\s\S]*?contentLimit: TRANSCRIPT_CONTENT_LIMIT,\s*topLevelOnly: true,/);
  assert.match(runtimeSource, /readActionWindow[\s\S]*?messageAround: messageId,[\s\S]*?topLevelOnly: true,/);
  assert.match(readingSource, /\.\.\.\(view\.focus \? \{\} : \{ topLevelOnly: true \}\)/, "paging follows the view's space: search stays physical");
  // The search jump itself never narrows: a hit inside a delegation needs its rows.
  assert.match(readingSource, /navigateTranscript: async \(input\) => \{[\s\S]*?messageAround: focus\.messageId,\s*messageLimit: TRANSCRIPT_SEARCH_PAGE_SIZE,\s*contentLimit: TRANSCRIPT_CONTENT_LIMIT,\s*\}\)/);
  // Opening a delegation — the work-panel tab, or a Task row expanded inline —
  // asks for the rows the pages left out.
  assert.match(tab, /\.filter\(\(turn\) => turn\.rows\.length === 0\)\.map\(\(turn\) => turn\.callId\)/);
  assert.match(tab, /void loadDelegateRows\(activeSessionId, missingCalls\);/);
  assert.match(transcript, /const delegateRowsMissing =\s*inlineOpen && action === "delegate" && Boolean\(message\.toolCallId\) && !delegate\?\.items\.length;/);
  assert.match(transcript, /void loadDelegateRows\(activeSessionId, \[message\.toolCallId\]\);/);
});

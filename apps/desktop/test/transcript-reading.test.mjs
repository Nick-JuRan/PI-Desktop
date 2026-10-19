import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { createTranscriptReadingRuntime } = await import(
  "../src/stores/runtime/transcript-reading-runtime.ts"
);
const { transcriptViewMessages, transcriptViewFromSession, TRANSCRIPT_PAGE_SIZE, TRANSCRIPT_CONTENT_LIMIT } = await import("../src/lib/transcript-reading.ts");
const { getSessionMessageSnapshot } = await import("../src/lib/session-transcript-updates.ts");
const { mergeLiveSessionMessages, upsertLiveSessionMessage, projectMessageEnd, removeLiveSessionMessage } = await import("../src/lib/session-transcript.ts");
const { buildTranscriptEntries } = await import("../src/lib/assistant-turns.ts");
const { prepareTranscriptAction } = await import("../src/stores/runtime/transcript-action.ts");

const target = (messageId) => ({ sessionId: "s", messageId, query: "needle" });
const message = (id, content = id, extra = {}) => ({
  id,
  role: "user",
  content,
  createdAt: `2026-09-13T00:00:00Z`,
  ...extra,
});
const page = (messages, options = {}) => ({
  session: {
    id: "s",
    messages,
    messageStart: 20,
    messageEnd: 80,
    hasMoreBefore: true,
    hasMoreAfter: true,
    ...options,
  },
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function reader(read, overrides = {}) {
  const errors = [];
  let runtime;
  let state = {
    activeSessionId: "s",
    messages: [message("tail")],
    sessionHistory: { s: { messageStart: 120, hasMoreBefore: true } },
    transcriptViews: {},
    retainedSessionIds: ["s"],
    retainedTranscripts: {},
    runningSessions: {},
    showToast: (error) => errors.push(error),
    ...overrides,
  };
  const access = {
    get: () => state,
    set: (patch) => {
      const previous = state;
      state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
      runtime?.reconcile(state, previous);
    },
  };
  runtime = createTranscriptReadingRuntime(access, read);
  return {
    ...access,
    ...runtime.actions,
    errors,
    view: () => state.transcriptViews.s,
    visible: () => transcriptViewMessages(state.messages, state.transcriptViews.s),
  };
}

test("a search jump keeps complete focused text without changing live/model input", async () => {
  const calls = [];
  const content = `${"prefix ".repeat(15_000)}needle`;
  const r = reader(async (...args) => {
    calls.push(args);
    return page([message("old", content)]);
  });
  const live = r.get().messages;
  await r.navigateTranscript(target("old"));
  assert.deepEqual(calls, [["s", { messageAround: "old", messageLimit: 60, contentLimit: 65536 }]]);
  assert.equal(r.visible()[0].content, content);
  assert.equal(r.view().focus.messageId, "old");
  assert.equal(r.view().loading, null);
  assert.equal(r.get().messages, live);
});

test("the latest click owns completion and obsolete errors", async () => {
  const first = deferred();
  const second = deferred();
  let count = 0;
  const r = reader(() => (++count === 1 ? first : second).promise);
  const a = r.navigateTranscript(target("a"));
  const b = r.navigateTranscript(target("b"));
  second.resolve(page([message("b")]));
  await b;
  first.reject(new Error("obsolete request"));
  await a;
  assert.equal(r.view().focus.messageId, "b");
  assert.deepEqual(r.errors, []);
});

test("both directions use physical cursors, deduplicate overlap, and preserve focused text", async () => {
  const calls = [];
  const responses = [
    page([message("a"), message("b", "full needle"), message("c")]),
    page([message("b", "clipped"), message("c"), message("d")], {
      messageStart: 70,
      messageEnd: 130,
      hasMoreAfter: false,
    }),
    page([message("z"), message("a")], { messageStart: 0, messageEnd: 20, hasMoreBefore: false }),
  ];
  const r = reader(async (_id, options) => {
    calls.push(options);
    return responses.shift();
  });
  await r.navigateTranscript(target("b"));
  await r.loadTranscriptPage("s", "after");
  assert.equal(calls[1].messageBefore, 140);
  await r.loadTranscriptPage("s", "before");
  assert.equal(calls[2].messageBefore, 20);
  assert.deepEqual(
    r.visible().map((item) => item.id),
    ["z", "a", "b", "c", "d"],
  );
  assert.equal(r.visible()[2].content, "full needle");
  assert.equal(r.view().hasMoreBefore, false);
  assert.equal(r.view().hasMoreAfter, false);
  await r.loadTranscriptPage("s", "after");
  assert.equal(calls.length, 3);
});

test("ordinary history uses the same page ownership and keeps receiving live output", async () => {
  const calls = [];
  const first = deferred();
  const r = reader(async (_id, options) => {
    calls.push(options);
    return calls.length === 1
      ? first.promise
      : page([message("oldest")], {
          messageStart: 0,
          messageEnd: 20,
          hasMoreBefore: false,
          hasMoreAfter: true,
        });
  });
  const live = r.get().messages;
  const loading = r.loadTranscriptPage("s", "before");
  await r.loadTranscriptPage("s", "before");
  assert.equal(calls.length, 1, "coalesce repeated top-boundary events");
  first.resolve(page([message("older")], { messageStart: 20, messageEnd: 120 }));
  await loading;
  assert.equal(r.get().messages, live, "reading does not hydrate model input");
  assert.deepEqual(
    r.visible().map((m) => m.id),
    ["older", "tail"],
  );
  r.set({
    runningSessions: { s: true },
    messages: [...live, message("stream", "partial", { status: "streaming" })],
  });
  await r.loadTranscriptPage("s", "before");
  assert.equal(
    calls[1].messageBefore,
    20,
    "continue the reading cursor, not the live cache cursor",
  );
  assert.equal(calls[1].messageLimit, 100);
  assert.deepEqual(
    r.visible().map((m) => m.id),
    ["oldest", "older", "tail", "stream"],
  );
  assert.equal(r.visible().at(-1).content, "partial");
});

test("search supersedes an ordinary page and return-to-latest cancels historical paging", async () => {
  const older = deferred();
  const later = deferred();
  let count = 0;
  const r = reader(() => {
    count += 1;
    return count === 1
      ? older.promise
      : count === 2
        ? Promise.resolve(page([message("hit")]))
        : later.promise;
  });
  const normal = r.loadTranscriptPage("s", "before");
  await r.navigateTranscript(target("hit"));
  older.resolve(page([message("obsolete")]));
  await normal;
  assert.deepEqual(
    r.visible().map((m) => m.id),
    ["hit"],
  );
  const load = r.loadTranscriptPage("s", "after");
  r.returnToLatestTranscript("s");
  later.resolve(page([message("obsolete-later")]));
  await load;
  assert.equal(r.view(), undefined);
  assert.deepEqual(
    r.visible().map((m) => m.id),
    ["tail"],
  );
});

test("a nested result opens its real Task and exposes its answer even outside the page", async () => {
  const child = message("child", "needle", {
    role: "assistant",
    parentToolCallId: "task-call",
    agentName: "reviewer",
  });
  const parent = message("parent-row", "", {
    role: "tool",
    toolName: "Task",
    toolCallId: "task-call",
  });
  const r = reader(async () => page([child], { navigationParent: parent }));
  await r.navigateTranscript(target("child"));
  assert.equal(r.view().focus.messageId, "child");
  const { entries } = buildTranscriptEntries(r.visible());
  const task = entries[0].parts[0].items[0];
  assert.equal(task.message.id, parent.id);
  assert.equal(task.delegate.items[0].message.id, child.id);
  assert.equal(r.view().messageStart, 20, "parent context does not move physical cursors");
  r.returnToLatestTranscript("s");
});

test("a failed search cannot restore a cancelled page's loading state or ownership", async () => {
  const older = deferred();
  const search = deferred();
  let calls = 0;
  const r = reader(() => (++calls === 1 ? older.promise : search.promise));
  const loading = r.loadTranscriptPage("s", "before");
  const navigation = r.navigateTranscript(target("missing"));
  older.resolve(page([message("discarded")]));
  await loading;
  search.resolve({ session: null });
  await navigation;
  assert.equal(r.view().loading, null);
  assert.equal(r.view().focus, null);
  assert.deepEqual(
    r.visible().map((m) => m.id),
    ["tail"],
  );
});

test("deleted targets and missing parent tasks report failure and preserve the previous view", async () => {
  for (const response of [
    page([message("different")]),
    page([message("deleted", "needle", { parentToolCallId: "missing" })]),
  ]) {
    const r = reader(async () => response);
    await r.navigateTranscript(target("deleted"));
    assert.deepEqual(
      r.visible().map((m) => m.id),
      ["tail"],
    );
    assert.equal(r.view().focus, null);
    assert.match(r.errors[0], /no longer exists/);
  }
});

test("new turns, pane eviction, and canonical edits invalidate pending reads", async () => {
  for (const change of [
    { runningSessions: { s: true } },
    { retainedSessionIds: [] },
    { messages: [message("tail", "edited with the same id")] },
    { messages: [] },
  ]) {
    const pending = deferred();
    const r = reader(() => pending.promise);
    const navigation = r.navigateTranscript(target("old"));
    r.set(change);
    pending.resolve(page([message("old")]));
    await navigation;
    assert.equal(r.view(), undefined);
    assert.deepEqual(r.errors, []);
  }
});

test("a session switch cannot let an old nested search open the new session's panel", async () => {
  const pending = deferred();
  const r = reader(() => pending.promise);
  const navigation = r.navigateTranscript(target("child"));
  r.set({ activeSessionId: "other", retainedSessionIds: ["other", "s"] });
  pending.resolve(
    page([message("child", "needle", { parentToolCallId: "task" })], {
      navigationParent: message("task", "", { role: "tool", toolName: "Task", toolCallId: "task" }),
    }),
  );
  await navigation;
  assert.equal(r.view(), undefined);
});

test("an explicit old-message action reads one bounded window and never the whole transcript", async () => {
  let state = {
    activeSessionId: "s",
    messages: [message("tail")],
    sessionHistory: { s: { hasMoreBefore: false } },
  };
  const access = {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
    },
  };
  // The host answers `messageAround` with a window centred on the target whose
  // own text is complete; the renderer re-anchors on it.
  const around = [message("older"), message("old", "complete original content"), message("tail")];
  const reads = [];
  let cached;
  const runtime = {
    readActionWindow: async (_id, messageId) => {
      reads.push(messageId);
      return { id: "s", messages: around, messageStart: 7, hasMoreBefore: true };
    },
    cacheSessionTranscript: (_id, messages) => {
      cached = messages;
    },
  };
  assert.equal(await prepareTranscriptAction(access, runtime, "tail"), state);
  assert.deepEqual(reads, []);
  await prepareTranscriptAction(access, runtime, "old");
  assert.deepEqual(reads, ["old"]);
  assert.equal(state.messages, around);
  assert.equal(cached, around);
  assert.deepEqual(state.sessionHistory.s, { messageStart: 7, hasMoreBefore: true, contentLimited: true });
});

test("action preparation cannot overwrite a later navigation or newly started turn", async () => {
  for (const change of [
    { activeSessionId: "other" },
    { isRunning: true },
    { messages: [message("tail", "edited")] },
  ]) {
    let state = { activeSessionId: "s", messages: [message("tail")], sessionHistory: {} };
    const pending = deferred();
    const read = prepareTranscriptAction(
      { get: () => state, set: () => assert.fail("stale action must not write") },
      {
        readActionWindow: () => pending.promise,
        cacheSessionTranscript: () => assert.fail("stale action must not replace the live cache"),
      },
      "old",
    );
    state = { ...state, ...change };
    pending.resolve({ id: "s", messages: [message("old")], messageStart: 0, hasMoreBefore: false });
    assert.equal(await read, null);
  }
});

test("a visible message still hydrates canonical input in place when the tail is bounded or clipped", async () => {
  for (const history of [{ hasMoreBefore: true, messageStart: 40 }, { hasMoreBefore: false, contentLimited: true }]) {
    let state = {
      activeSessionId: "s",
      messages: [message("earlier", "neighbour"), message("visible", "clipped")],
      sessionHistory: { s: history },
    };
    const canonical = message("visible", "complete original content");
    const access = {
      get: () => state,
      set: (patch) => {
        state = { ...state, ...patch };
      },
    };
    let cached;
    await prepareTranscriptAction(
      access,
      {
        // The window the host returns around the target may differ from the
        // one on screen; only the target's canonical copy is taken from it.
        readActionWindow: async () => ({
          id: "s",
          messages: [message("much-older"), canonical, message("later")],
          messageStart: 3,
          hasMoreBefore: true,
        }),
        cacheSessionTranscript: (_id, messages) => {
          cached = messages;
        },
      },
      "visible",
    );
    assert.deepEqual(state.messages.map((item) => item.id), ["earlier", "visible"]);
    assert.equal(state.messages[1], canonical);
    assert.equal(cached, state.messages);
    // The reading window itself is untouched: paging state stays what it was.
    assert.deepEqual(state.sessionHistory.s, history);
  }
});

test("action preparation gives up when the host no longer has the message", async () => {
  let state = { activeSessionId: "s", messages: [message("tail")], sessionHistory: { s: { contentLimited: true } } };
  const result = await prepareTranscriptAction(
    { get: () => state, set: () => assert.fail("a missing message must not write") },
    {
      readActionWindow: async () => ({ id: "s", messages: [message("other")], messageStart: 0, hasMoreBefore: false }),
      cacheSessionTranscript: () => assert.fail("a missing message must not replace the cache"),
    },
    "tail",
  );
  assert.equal(result, null);
});

test("opening the conversation start reads one first page as a historical window and pages forward", async () => {
  const calls = [];
  const r = reader(async (...args) => {
    calls.push(args[1]);
    if (args[1].messageBefore === TRANSCRIPT_PAGE_SIZE) {
      return page([message("first"), message("second")], {
        messageStart: 0, messageEnd: 2, hasMoreBefore: false, hasMoreAfter: true,
      });
    }
    return page([message("third")], { messageStart: 2, messageEnd: 3, hasMoreBefore: false, hasMoreAfter: true });
  });
  await r.openTranscriptStart("s");
  // One bounded request for the first page: offset 0 .. PAGE_SIZE of the
  // top-level rows, display-capped.
  assert.deepEqual(calls, [{
    messageBefore: TRANSCRIPT_PAGE_SIZE,
    messageLimit: TRANSCRIPT_PAGE_SIZE,
    contentLimit: TRANSCRIPT_CONTENT_LIMIT,
    topLevelOnly: true,
  }]);
  const view = r.view();
  assert.equal(view.restored, true, "the start is a historical reading window");
  assert.equal(view.loading, null);
  assert.deepEqual(view.messages.map((item) => item.id), ["first", "second"]);
  assert.equal(view.messageStart, 0);
  assert.equal(view.hasMoreBefore, false);
  assert.equal(view.hasMoreAfter, true);
  // A historical window shows its own snapshot, never merged with the live tail.
  assert.deepEqual(r.visible().map((item) => item.id), ["first", "second"]);
  // Forward paging continues from the window's end, in the same space.
  await r.loadTranscriptPage("s", "after");
  assert.deepEqual(calls.at(-1), {
    messageBefore: 2 + TRANSCRIPT_PAGE_SIZE,
    messageLimit: TRANSCRIPT_PAGE_SIZE,
    contentLimit: TRANSCRIPT_CONTENT_LIMIT,
    topLevelOnly: true,
  });
  assert.deepEqual(r.visible().map((item) => item.id), ["first", "second", "third"]);
  // Returning to the latest turn releases the window and shows the live tail again.
  r.returnToLatestTranscript("s");
  assert.equal(r.view(), undefined);
  assert.deepEqual(r.visible().map((item) => item.id), ["tail"]);
  assert.deepEqual(r.errors, []);
});

test("opening the start is refused for remote sessions and rolls back on a failed read", async () => {
  let reads = 0;
  const remote = reader(async () => { reads += 1; return page([]); }, {
    activeSessionId: "remote:host/1",
    sessionHistory: { "remote:host/1": { messageStart: 7, hasMoreBefore: true } },
  });
  await remote.openTranscriptStart("remote:host/1");
  assert.equal(reads, 0, "remote history has cursors, not offsets");

  const failing = reader(async () => { throw new Error("host unavailable"); });
  await failing.openTranscriptStart("s");
  assert.equal(failing.view(), undefined, "a failed read leaves no reading window behind");
  assert.deepEqual(failing.errors, ["host unavailable"]);
  assert.deepEqual(failing.visible().map((item) => item.id), ["tail"]);

  const other = reader(async () => page([message("first")], { messageStart: 0, hasMoreBefore: false }));
  await other.openTranscriptStart("other-session");
  assert.equal(other.view(), undefined, "only the active session opens its start");
});

test("paging during an existing stream never freezes its snapshot over newer tokens or completion", async () => {
  const delayed = deferred();
  const initial = message("reply", "first token", { role: "assistant", status: "streaming" });
  const r = reader(() => delayed.promise, { messages: [initial], runningSessions: { s: true } });
  const loading = r.loadTranscriptPage("s", "before");
  const streaming = { ...initial, content: "more tokens" };
  r.set({ messages: [streaming] });
  assert.equal(r.visible().at(-1), streaming);
  delayed.resolve(page([message("older"), initial], { messageStart: 0, hasMoreBefore: false }));
  await loading;
  assert.equal(r.visible().at(-1), streaming);
  const complete = { ...streaming, content: "complete answer", status: "complete" };
  r.set({ messages: [complete], runningSessions: {} });
  assert.deepEqual(
    r.visible().map((item) => item.id),
    ["older", "reply"],
  );
  assert.equal(r.visible().at(-1), complete);
});

function fullReadingProjection(live, view) {
  const current = new Map(live.map((row) => [row.id, row]));
  return mergeLiveSessionMessages(view.messages, live).map((row) => current.get(row.id) ?? row);
}

test("ordinary reading replaces only changed overlap without rereading historical ids", () => {
  let reads = 0;
  const rows = Array.from({ length: 10_000 }, (_, index) => ({
    ...message(`old-${index}`),
    get id() { reads++; return `old-${index}`; },
  }));
  const live = [...rows, message("tail", "partial", { role: "assistant", status: "streaming" })];
  const view = transcriptViewFromSession(page([message("earlier"), ...live]).session);
  const first = transcriptViewMessages(live, view);
  assert.equal(transcriptViewMessages(live, view), first);
  reads = 0;
  const nextLive = upsertLiveSessionMessage(live, message("tail", "final", { role: "assistant", status: "complete" }));
  const next = transcriptViewMessages(nextLive, view);
  assert.equal(reads, 0);
  assert.equal(next.at(-1), nextLive.at(-1));
  assert.equal(first.at(-1).content, "partial");
  const before = getSessionMessageSnapshot(first);
  const after = getSessionMessageSnapshot(next);
  assert.equal(before.owner, after.owner);
  assert.equal(before.positions, after.positions);
  assert.equal(before.blocks[0], after.blocks[0]);
  assert.notEqual(before.blocks.at(-1), after.blocks.at(-1));
});

test("reading overlap includes skipped non-tail updates and remains safe for older renders", () => {
  const live = Array.from({ length: 200 }, (_, index) => message(`row-${index}`));
  const view = transcriptViewFromSession(page([message("older"), ...live.slice(0, 5)]).session);
  const first = transcriptViewMessages(live, view);
  const early = upsertLiveSessionMessage(live, message("row-2", "changed early"));
  const late = upsertLiveSessionMessage(early, message("row-150", "changed late"));
  const latest = transcriptViewMessages(late, view);
  assert.deepEqual(latest, fullReadingProjection(late, view));
  assert.equal(latest[3].content, "changed early");
  assert.equal(latest[151].content, "changed late");
  assert.equal(first[3].content, "row-2");
  assert.deepEqual(transcriptViewMessages(early, view), fullReadingProjection(early, view));
  assert.deepEqual(transcriptViewMessages(late, view), latest);
});

test("reading cache invalidates structural changes, unrelated sources and changed view owners", () => {
  const view = transcriptViewFromSession(page([message("older")]).session);
  const initial = [message("a"), message("provisional", "partial", { role: "assistant" })];
  const first = transcriptViewMessages(initial, view);
  const appended = upsertLiveSessionMessage(initial, message("b"));
  assert.deepEqual(transcriptViewMessages(appended, view), fullReadingProjection(appended, view));
  const rekeyed = projectMessageEnd(appended, {
    type: "message_end", replacesMessageId: "provisional",
    message: message("durable", "final", { role: "assistant", status: "complete" }),
  });
  assert.deepEqual(transcriptViewMessages(rekeyed, view), fullReadingProjection(rekeyed, view));
  const removed = removeLiveSessionMessage(rekeyed, "a");
  assert.deepEqual(transcriptViewMessages(removed, view), fullReadingProjection(removed, view));
  const unknown = [message("replacement"), message("replacement", "last duplicate")];
  assert.deepEqual(transcriptViewMessages(unknown, view), fullReadingProjection(unknown, view));
  const changedView = { ...view, messages: [message("different history")] };
  assert.deepEqual(transcriptViewMessages(removed, changedView), fullReadingProjection(removed, changedView));
  assert.deepEqual(first.map((row) => row.id), ["older", "a", "provisional"]);
  assert.equal(transcriptViewMessages(removed), removed, "return to latest bypasses the reading cache");
});

test("timestamp corrections remerge chronological positions instead of patching stale order", () => {
  const at = (id, day) => message(id, id, { createdAt: `2026-09-${day}T00:00:00Z` });
  const keep = at("keep", 20);
  const live = [keep, at("old", 10), at("tail", 30)];
  const view = transcriptViewFromSession(page([keep]).session);
  assert.deepEqual(transcriptViewMessages(live, view).map((row) => row.id), ["old", "keep", "tail"]);
  const corrected = upsertLiveSessionMessage(live, at("old", 25));
  assert.deepEqual(transcriptViewMessages(corrected, view), fullReadingProjection(corrected, view));
  assert.deepEqual(transcriptViewMessages(corrected, view).map((row) => row.id), ["keep", "old", "tail"]);
});

test("focused search never reads unused live identities, including parent context", () => {
  const live = [{ ...message("unused"), get id() { assert.fail("historical search indexed live rows"); } }];
  const parent = message("task", "latest parent", { role: "tool" });
  const view = transcriptViewFromSession(page([message("hit")], { navigationParent: parent }).session, target("hit"));
  assert.deepEqual(transcriptViewMessages(live, view), [parent, view.messages[0]]);
  const overlapping = { ...view, messages: [message("task", "old parent"), ...view.messages] };
  assert.deepEqual(transcriptViewMessages(live, overlapping), [parent, view.messages[0]]);
});

test("ordinary parent context stays authoritative over tracked live changes", () => {
  const parent = message("task", "navigation parent", { role: "tool" });
  const view = transcriptViewFromSession(page([message("hit")], { navigationParent: parent }).session);
  const live = [message("task", "live parent", { role: "tool" }), message("tail")];
  const initial = transcriptViewMessages(live, view);
  const updated = upsertLiveSessionMessage(live, message("task", "new live parent", { role: "tool" }));
  const next = transcriptViewMessages(updated, view);
  assert.equal(next, initial);
  assert.equal(next.find((row) => row.id === "task"), parent);
});

const bookmark = { pinned: false, messageId: "old", offset: -35, scrollTop: 650, windowSize: 100 };
test("an evicted reading position loads its message without search focus or live-cache writes", async () => {
  const calls = [];
  const r = reader(async (...args) => { calls.push(args); return page([message("old")]); });
  const live = r.get().messages;
  assert.equal(await r.restoreTranscriptReading("s", bookmark, new AbortController().signal), true);
  // A reading position is a top-level row, restored in the top-level space;
  // a search jump (above) keeps every physical row around its hit.
  assert.deepEqual(calls, [["s", { messageAround: "old", messageLimit: 60, contentLimit: 65536, topLevelOnly: true }]]);
  assert.equal(r.view().focus, null);
  assert.equal(r.view().restored, true);
  assert.deepEqual(r.visible().map((row) => row.id), ["old"]);
  assert.equal(r.get().messages, live);
  await r.loadTranscriptPage("s", "after");
  assert.equal(r.view().restored, true);
  r.returnToLatestTranscript("s");
  assert.equal(r.view(), undefined);
});

test("a loaded reading anchor does not fetch or replace the existing reading range", async () => {
  const r = reader(async () => { throw new Error("unexpected read"); }, { messages: [message("old")] });
  assert.equal(await r.restoreTranscriptReading("s", bookmark, new AbortController().signal), true);
  assert.equal(r.view(), undefined);
});

test("input cancellation prevents a delayed restoration from replacing the current view", async () => {
  const pending = deferred();
  const r = reader(() => pending.promise);
  const controller = new AbortController();
  const request = r.restoreTranscriptReading("s", bookmark, controller.signal);
  controller.abort();
  assert.equal(r.view(), undefined);
  pending.resolve(page([message("old")]));
  assert.equal(await request, false);
  assert.equal(r.view(), undefined);
});

test("search navigation owns a delayed reading restoration", async () => {
  const pending = deferred();
  let calls = 0;
  const r = reader(() => ++calls === 1 ? pending.promise : Promise.resolve(page([message("hit")])));
  const request = r.restoreTranscriptReading("s", bookmark, new AbortController().signal);
  await r.navigateTranscript(target("hit"));
  pending.resolve(page([message("old")]));
  assert.equal(await request, false);
  assert.equal(r.view().focus.messageId, "hit");
});

test("session changes, eviction and new turns invalidate a delayed reading restoration", async () => {
  for (const patch of [
    { activeSessionId: "other" }, { retainedSessionIds: [] }, { runningSessions: { s: true } },
  ]) {
    const pending = deferred();
    const r = reader(() => pending.promise);
    const request = r.restoreTranscriptReading("s", bookmark, new AbortController().signal);
    r.set(patch);
    pending.resolve(page([message("old")]));
    assert.equal(await request, false);
    assert.equal(r.view(), undefined);
  }
});

test("missing reading anchors and IO failures fall back without a stuck loading view", async () => {
  for (const read of [async () => page([message("different")]), async () => { throw new Error("read failed"); }]) {
    const r = reader(read);
    assert.equal(await r.restoreTranscriptReading("s", bookmark, new AbortController().signal), false);
    assert.equal(r.view(), undefined);
  }
});

test("selection revalidation cannot remove a restored range, but an explicit rewrite can", async () => {
  const r = reader(async () => page([message("old")]), {
    messages: [message("stale-tail")], selectingSessionId: "s",
  });
  assert.equal(await r.restoreTranscriptReading("s", bookmark, new AbortController().signal), true);
  r.set({ messages: [message("tail")], selectingSessionId: undefined });
  assert.equal(r.view().restored, true);
  r.set({ messages: [message("tail", "edited")] });
  assert.equal(r.view(), undefined);
});

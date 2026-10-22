# 90-07. Bounded transcript reads and top-level history pages

Fork feature. The renderer never holds a whole transcript: every read it makes
is a bounded window, every transcript rewrite is performed by the host, and the
pages behind the main conversation contain top-level rows only — a
delegation's rows are read when the delegation is opened. The work was driven
by one session that kept failing to open: 3,794 rows and 331 MB, of which
3,645 rows (96%) and 315 MB (99.7%) were produced under `Task` calls while the
main agent's own conversation was 150 rows and about 1 MB. Every page the
renderer fetched was 5–15 MB of a delegate's tool payloads, parsed on the host
for 64 KiB previews of rows the turn stream does not show.

This page amends upstream D199, D390, D269, ADR 0120, ADR 0216 and ADR 0279 for
the fork. It records fork decisions that were first written into
`08-meta/decisions-log.md` as D660 / D665–D669 and collided twice with
upstream's numbering; fork decisions live here now, as `FORK-STANDARD.md` B4
requires, and the log stays upstream's.

## 1. Bounded renderer reads and host-side mutations

- A renderer `session/get` that omits `messageLimit` / `contentLimit` is bounded
  by Electron main (`ipc/session-read-bounds.ts`: 200 messages, 64 KiB per
  message, clamped to the host's 1000-message cap). The renderer therefore never
  receives a whole transcript in one reply. The sidecar rebuilds model context
  through its own host proxy with the unbounded `session.get`, which this change
  does not touch: what the model sees — in the running turn, on the next turn,
  and on a delegate `resume` — is byte-for-byte what it saw before.
- The live stream stores only a display copy of each tool result. `tool_end`
  and `tool_update` go through `lib/tool-result-display.ts`, which mirrors
  host-core's `record_to_ui_for_display` (same 64 KiB budget, same marker
  text), so an open session no longer grows the renderer heap by every full
  tool payload a background delegation produces. The transcript on disk and the
  `tool_end` the main process persists are unchanged.
- Renderer-owned transcript rewrites are gone. Message delete and the Stop undo
  of an unanswered prompt call `session.deleteMessage({ sessionId, messageId })`,
  which applies the user-turn rule on the host (a user row takes every
  following row up to the next user row; any other row goes alone), rewrites
  through the `session.replaceMessages` path, and returns `deletedIds` for the
  renderer to reconcile its window with. `session.activateRevision` takes an
  optional `prefix`; the renderer sends none and re-reads a bounded page, and a
  root missing from the transcript is `NOT_FOUND` instead of a rewrite from an
  empty or partial prefix. Edit and retry hydrate their target through one
  `messageAround` window (the focused message keeps its complete text); copy
  conversation walks bounded pages and copies the display form.
- Why the order matters: bounding reads first would have fed a partial,
  display-capped window into the renderer's `replaceMessages` write-backs and
  rewritten the transcript from it — a user-data loss. The mutations moved to
  the host in the same change, so no renderer array crosses IPC in either
  direction.
- These bounds stay in force even though the interim history controls of
  section 3 were withdrawn: without them Stop, delete, retry and edit would
  read the whole transcript into the renderer again, and a delete on a large
  session would exceed the host's 64 MiB request limit.

## 2. History pages are top-level; a delegation's rows are read when it is opened

- The transcript layout cache (format 3) records each message line's delegate
  parent — the `parentToolCallId` in its `meta`, `-` for a top-level row —
  beside its offset. The scan reads it from the line it already has: no key, no
  parsing; a key, parsed ignoring `blocks`; a payload that merely mentions the
  key parses to a row without a parent. A version-2 cache is ignored and rebuilt
  once.
- `session.get` takes `topLevelOnly: true`: the window's row space is the rows
  without a delegate parent, `messageBefore` / `messageStart` / `messageEnd` /
  `hasMore*` index that space, and a `messageAround` target inside a delegation
  centres the window on its parent `Task` row. It also takes
  `delegateOf: [callId, …]` (1–64 ids, requires `messageLimit`, exclusive with
  `topLevelOnly`): the rows produced under those calls, in file order, windowed
  over that set. In either space the rows left out are neither read nor
  deserialized.
- Every read behind the main transcript is top-level: open, prefetch, the
  empty-read retry, the settled refresh after abort/delete/revision, edit and
  retry hydration, reading-position restore, and copy. A search jump and the
  paging of its window keep every physical row, because a hit inside a
  delegation needs its rows.
- Opening a delegation reads what the pages left out: the work-panel tab asks
  for the chain's calls whose turns have no rows, an inline `Task` expansion
  asks for its own call, both through `loadDelegateRows` — one bounded read of
  up to 1000 rows per set of calls, merged under their `Task`, shared while in
  flight and settled once so a delegate that produced nothing is not asked
  again. A failed read is reported and may be retried on the next open. While a
  delegate runs its rows still arrive live.
- With history pages top-level, the session the work was written for opens and
  pages at the cost of its 150 own rows. A renderer that keeps running out of
  memory is a regression of this section to diagnose, not a state to detect.
- The earlier count that attributed the rows to the main agent came from
  Windows `findstr`, which does not match lines over 8 KiB — nearly every line
  of such a session.

## 3. Withdrawn interim designs

Two workarounds shipped between the bounds of section 1 and the top-level pages
of section 2 and were withdrawn once section 2 removed the symptom at its
cause. They are recorded so the strings, tests and controls they introduced are
not mistaken for missing features.

- Budgeted history progression: the top boundary observer fetched older pages
  only while fewer than `TRANSCRIPT_AUTO_HISTORY_ROW_BUDGET` (600) rows were
  loaded, and past the budget the boundary showed a `chat.loadEarlierMessages`
  control. Withdrawn: automatic history progression is unbudgeted again (D269),
  the boundary observer and a scroll to the top fetch the next older page, and
  the viewport anchors to the row the reader was on.
- Opening the conversation start from the boundary: a `chat.openConversationStart`
  control read the first page as a historical reading window, and an explicit
  older-page press held `scrollTop` at 0 while the page landed. Withdrawn
  together with the budget; the `openTranscriptStart` action, the hold-at-top,
  and both strings are removed.
- A renderer-recovery breaker (stop after three automatic reloads within five
  minutes, `recovery: "crash-loop"` on the `renderer.process.gone` entry, a
  dialog asking to reload or quit) shipped with section 1 and was withdrawn with
  the two controls: renderer recovery is the upstream module again — a gone main
  renderer is reloaded after the 2 s cooldown, and the entry carries `reason`,
  `exitCode`, and `reloaded`.

## 4. What is unchanged

- The transcript on disk, the persistence outbox, and the sidecar's model
  context are untouched by every part of this page.
- Protocol version stays at 11; `topLevelOnly` and `delegateOf` are additive
  options of `session.get`.
- A loaded canonical history stays loaded: the long-history E2E invariant
  (selection and background deltas never discard loaded rows) is unchanged.
  Bounding the live tail's row count — releasing the oldest rows of a followed
  live transcript back to the host — conflicts with that invariant and is left
  to a decision of its own.
- `truncateDisplayText` / `previewValue` scan at most `limit` code points and
  never materialize a character array for a multi-MB payload; a 64 KiB cap on a
  1 MB tool result is O(64 KiB).

## 5. Islands and integration points

- Islands (fork-only files, never conflict):
  `apps/desktop/electron/main/ipc/session-read-bounds.ts`,
  `apps/desktop/src/lib/tool-result-display.ts`,
  `apps/desktop/src/lib/conversation-read.ts`, and their tests
  `apps/desktop/test/session-read-bounds.test.mjs`,
  `apps/desktop/test/tool-result-display.test.mjs`,
  `apps/desktop/test/conversation-read.test.mjs`,
  `apps/desktop/test/delegate-rows-on-demand.test.mjs`.
- Integration points (upstream files the fork changes; the complete list with
  line counts is the "transcript reads / history pages" group of `FORK.md`):
  `crates/host-core/src/sessions.rs` (top-level and delegate windows,
  `session.deleteMessage`), `crates/host-core/src/transcripts/layout.rs`
  (layout format 3 with the delegate parent), `crates/host-core/src/transcripts.rs`,
  `apps/desktop/electron/main/ipc/session-ipc.ts` (bounded `session/get`,
  `sessionDeleteMessage`), `apps/desktop/src/stores/slices/transcript-slice.ts`
  and `apps/desktop/src/stores/runtime/session-runtime.ts` (top-level reads,
  `loadDelegateRows`, display-capped live results),
  `apps/desktop/src/stores/slices/events-slice.ts`,
  `apps/desktop/src/features/chat/transcript/ChatTranscript.tsx` and
  `ToolRow.tsx` (delegate rows on open), `apps/desktop/src/lib/remote-project-session.ts`,
  `apps/desktop/src/lib/transcript-reading.ts`, and the upstream tests adjusted
  for the bounded contracts.
- Upstream pages that carry fork paragraphs for this feature:
  `03-runtime/01-ipc-protocol.md`, `03-runtime/04-data-storage.md`,
  `03-runtime/06-host-rpc-protocol.md`, and `04-ux/08-component-spec.md`. Each
  points back here instead of to a decision number.

## 6. Tests

- Host: `crates/host-core/src/sessions.rs` (`delete_message_*`,
  `activate_message_revision_without_a_prefix_*`, `a_top_level_window_*`,
  `a_delegate_window_*`), `crates/host-core/src/transcripts_layout_tests.rs`
  (`the_layout_records_each_lines_delegate_parent_and_persists_it`).
- Desktop: `apps/desktop/test/session-read-bounds.test.mjs`,
  `apps/desktop/test/tool-result-display.test.mjs`,
  `apps/desktop/test/conversation-read.test.mjs`,
  `apps/desktop/test/delete-message-preserves-transcript.test.mjs`,
  `apps/desktop/test/transcript-reading.test.mjs`,
  `apps/desktop/test/delegate-rows-on-demand.test.mjs`,
  `apps/desktop/test/transcript-window.test.mjs`,
  `apps/desktop/test/session-switch-performance.test.mjs`, and
  `apps/desktop/test/renderer-recovery.test.mjs` (the upstream contracts).

## 7. Related upstream pages

`03-runtime/01-ipc-protocol.md` (renderer `session/get` and
`sessionDeleteMessage`), `03-runtime/04-data-storage.md` (layout cache format
3), `03-runtime/06-host-rpc-protocol.md` (`session.get` options,
`session.deleteMessage`, `session.activateRevision`),
`03-runtime/09-logging-and-observability.md` (`renderer.process.gone`), and
`04-ux/08-component-spec.md` (conversation minimap and transcript history).

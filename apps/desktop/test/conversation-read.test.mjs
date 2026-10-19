import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import { readTranscriptSource } from "./helpers/source-contracts.mjs";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const { readConversationPages, CONVERSATION_READ_PAGE_SIZE } = await import("../src/lib/conversation-read.ts");
const { TRANSCRIPT_CONTENT_LIMIT } = await import("../src/lib/transcript-reading.ts");

const message = (id) => ({ id, role: "user", content: id, createdAt: "2026-09-13T00:00:00Z" });

test("a whole conversation is read as bounded pages, newest page first, and returned oldest first", async () => {
  // 7 messages, page size 3: the transcript is [m0 .. m6].
  const all = Array.from({ length: 7 }, (_, index) => message(`m${index}`));
  const reads = [];
  const read = async (options) => {
    reads.push(options);
    const end = options.messageBefore ?? all.length;
    const start = Math.max(0, end - options.messageLimit);
    return {
      session: { id: "s", messages: all.slice(start, end), messageStart: start, hasMoreBefore: start > 0 },
    };
  };
  const messages = await readConversationPages(read, { pageSize: 3, contentLimit: 64 });
  assert.deepEqual(messages.map((item) => item.id), all.map((item) => item.id));
  // Every page reads the top-level rows: a delegate's rows are not part of the
  // copied conversation and are the bulk of a long session's bytes.
  assert.deepEqual(reads, [
    { messageLimit: 3, contentLimit: 64, topLevelOnly: true },
    { messageBefore: 4, messageLimit: 3, contentLimit: 64, topLevelOnly: true },
    { messageBefore: 1, messageLimit: 3, contentLimit: 64, topLevelOnly: true },
  ]);
});

test("the defaults are the host's page cap and the transcript display cap", async () => {
  let seen;
  await readConversationPages(async (options) => {
    seen = options;
    return { session: { id: "s", messages: [message("only")], messageStart: 0, hasMoreBefore: false } };
  });
  assert.deepEqual(seen, { messageLimit: CONVERSATION_READ_PAGE_SIZE, contentLimit: TRANSCRIPT_CONTENT_LIMIT, topLevelOnly: true });
  assert.equal(CONVERSATION_READ_PAGE_SIZE, 1000);
});

test("a page that reports more history without an earlier offset ends the walk instead of looping", async () => {
  let reads = 0;
  const messages = await readConversationPages(async () => {
    reads += 1;
    return { session: { id: "s", messages: [message("stuck")], messageStart: 5, hasMoreBefore: true } };
  }, { pageSize: 2 });
  // First page at offset 5 asks for the page before 5; the host answers with
  // the same offset, so the reader stops rather than reading it forever.
  assert.equal(reads, 2);
  assert.deepEqual(messages.map((item) => item.id), ["stuck", "stuck"]);
});

test("a session that disappears mid-walk reports null only when nothing was read", async () => {
  assert.equal(await readConversationPages(async () => ({ session: null })), null);
  let reads = 0;
  const partial = await readConversationPages(async () => {
    reads += 1;
    return reads === 1
      ? { session: { id: "s", messages: [message("tail")], messageStart: 3, hasMoreBefore: true } }
      : { session: null };
  });
  assert.deepEqual(partial.map((item) => item.id), ["tail"]);
});

test("copying a conversation walks pages rather than reading the whole transcript", async () => {
  const source = await readTranscriptSource();
  assert.match(source, /readConversationPages\(\(options\) => api\.getSession\(sessionId, options\)\)/);
  assert.doesNotMatch(source, /api\.getSession\(sessionId\)/);
});

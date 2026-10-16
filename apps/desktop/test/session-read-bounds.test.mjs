import assert from "node:assert/strict";
import test from "node:test";
import {
  boundSessionRead,
  RENDERER_SESSION_CONTENT_LIMIT,
  RENDERER_SESSION_MESSAGE_LIMIT,
  RENDERER_SESSION_MESSAGE_LIMIT_MAX,
} from "../electron/main/ipc/session-read-bounds.ts";

test("a renderer read that names no window gets the default bounded window", () => {
  // The shape of the OOM: `api.getSession(id)` with nothing else used to reach
  // the host as an unbounded read and come back as the whole transcript.
  assert.deepEqual(boundSessionRead({}), {
    messageLimit: RENDERER_SESSION_MESSAGE_LIMIT,
    contentLimit: RENDERER_SESSION_CONTENT_LIMIT,
  });
  assert.ok(RENDERER_SESSION_MESSAGE_LIMIT > 0 && RENDERER_SESSION_MESSAGE_LIMIT <= RENDERER_SESSION_MESSAGE_LIMIT_MAX);
});

test("explicit window parameters pass through, clamped to what the host will honour", () => {
  assert.deepEqual(boundSessionRead({ messageLimit: 60, contentLimit: 4096, messageBefore: 120 }), {
    messageBefore: 120,
    messageLimit: 60,
    contentLimit: 4096,
  });
  assert.deepEqual(boundSessionRead({ messageAround: "m-1", messageLimit: 5_000 }), {
    messageAround: "m-1",
    messageLimit: RENDERER_SESSION_MESSAGE_LIMIT_MAX,
    contentLimit: RENDERER_SESSION_CONTENT_LIMIT,
  });
});

test("malformed parameters fall back to the defaults instead of lifting the bound", () => {
  for (const bad of [0, -5, 1.5, Number.NaN, "100"]) {
    const window = boundSessionRead({ messageLimit: bad, contentLimit: bad, messageBefore: bad });
    assert.equal(window.messageLimit, RENDERER_SESSION_MESSAGE_LIMIT, `messageLimit ${String(bad)}`);
    assert.equal(window.contentLimit, RENDERER_SESSION_CONTENT_LIMIT, `contentLimit ${String(bad)}`);
    assert.equal("messageBefore" in window, bad === 0, `messageBefore ${String(bad)}`);
  }
  assert.equal("messageAround" in boundSessionRead({ messageAround: "   " }), false);
  // A zero offset is a valid "before the first message" cursor.
  assert.equal(boundSessionRead({ messageBefore: 0 }).messageBefore, 0);
});

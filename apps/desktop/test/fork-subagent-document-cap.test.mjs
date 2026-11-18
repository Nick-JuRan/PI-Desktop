/**
 * Fork contract: the subagent document cap exists twice — host-core rejects a
 * document above `MAX_SUBAGENT_BYTES` (scan, create, update, read) and the
 * Subagents editor refuses to save, and shows the `used / max KB` counter,
 * from its own `MAX_SUBAGENT_BYTES`. PR #81 raised only the host side, so the
 * editor kept saying "33 / 32 KB" for a brief host-core already accepted.
 *
 * Both files are upstream's, so the value cannot be imported from one shared
 * island; the test reads the two literals off the source instead and fails
 * the moment they drift apart (source-contract test, no React, no .tsx import).
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const editorSource = await readFile(
  new URL("../src/components/settings/SubagentEditorSheet.tsx", import.meta.url),
  "utf8",
);
const hostSource = await readFile(
  new URL("../../../crates/host-core/src/user_subagents.rs", import.meta.url),
  "utf8",
);

const FORK_SUBAGENT_DOCUMENT_CAP_BYTES = 64 * 1024;

function literal(source, pattern, label) {
  const match = source.match(pattern);
  assert.ok(match, `${label}: MAX_SUBAGENT_BYTES literal not found`);
  return Number(match[1]) * 1024;
}

test("the editor's MAX_SUBAGENT_BYTES equals host-core's", () => {
  const editor = literal(
    editorSource,
    /^export const MAX_SUBAGENT_BYTES = (\d+) \* 1024;$/m,
    "SubagentEditorSheet.tsx",
  );
  const host = literal(
    hostSource,
    /^pub const MAX_SUBAGENT_BYTES: usize = (\d+) \* 1024;$/m,
    "user_subagents.rs",
  );
  assert.equal(editor, host, "editor and host-core caps drifted apart");
});

test("the fork cap is 64 KiB on both sides", () => {
  const editor = literal(
    editorSource,
    /^export const MAX_SUBAGENT_BYTES = (\d+) \* 1024;$/m,
    "SubagentEditorSheet.tsx",
  );
  assert.equal(editor, FORK_SUBAGENT_DOCUMENT_CAP_BYTES);
});

test("the editor validates the body and renders the counter from that one constant", () => {
  // Save validation: a body above the cap maps to the i18n error key.
  assert.match(
    editorSource,
    /new TextEncoder\(\)\.encode\(draft\.body\)\.length > MAX_SUBAGENT_BYTES\) \{\s*\n\s*return "extensions\.subagents\.errorTooBig";/,
  );
  // Counter: `used / max KB` derives its maximum from the same constant.
  assert.match(editorSource, /max: Math\.round\(MAX_SUBAGENT_BYTES \/ 1024\)/);
  // No second literal cap survives anywhere in the editor.
  assert.equal(
    editorSource.match(/\b32 \* 1024\b/g),
    null,
    "a 32 KiB literal is still in the editor",
  );
});

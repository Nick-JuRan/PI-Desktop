import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const [voiceService, protocol] = await Promise.all([
  readFile(new URL("../electron/main/voice-service.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../../../packages/shared/src/protocol.ts", import.meta.url),
    "utf8",
  ),
]);

test("voice state and model progress use allowlisted IPC event channels", () => {
  assert.match(
    protocol,
    /voiceStateChanged:\s*"pi-desktop\/voice\/event\/stateChanged"/,
  );
  assert.match(
    protocol,
    /voiceModelProgress:\s*"pi-desktop\/voice\/event\/modelProgress"/,
  );
  assert.match(
    voiceService,
    /sendToRenderer\(IPC\.event\.voiceStateChanged,\s*state\)/,
  );
  assert.match(
    voiceService,
    /sendToRenderer\(IPC\.event\.voiceModelProgress,\s*\{\s*modelId,\s*progress\s*\}\)/,
  );
  assert.doesNotMatch(voiceService, /sendToRenderer\(["']voice:/);
});

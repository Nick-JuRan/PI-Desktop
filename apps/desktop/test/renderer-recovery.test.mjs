import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import {
  CRASH_LOOP_MAX_RELOADS,
  CRASH_LOOP_WINDOW_MS,
  recoverRendererAfterGone,
  resetRendererRecoveryHistory,
  _resetCooldownForTest,
} from "../electron/main/renderer-recovery.ts";

function recovery(overrides = {}) {
  const calls = { reload: 0, logs: [], crashLoops: 0 };
  const dependencies = {
    isCurrentWindow: true,
    quitting: false,
    windowCloseAccepted: false,
    windowDestroyed: false,
    webContentsDestroyed: false,
    reload: () => calls.reload++,
    log: (details, reloaded) => calls.logs.push({ details, reloaded }),
    onCrashLoop: () => calls.crashLoops++,
    ...overrides,
  };
  return { calls, dependencies };
}

describe("recoverRendererAfterGone", () => {
  afterEach(() => {
    _resetCooldownForTest();
    mock.timers.reset();
  });

  it("unexpected renderer exits reload the live main window and preserve diagnostics", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    mock.timers.tick(10_000);

    const { calls, dependencies } = recovery();
    const details = { reason: "crashed", exitCode: 73 };

    assert.equal(recoverRendererAfterGone(details, dependencies), true);
    assert.equal(calls.reload, 1);
    assert.deepEqual(calls.logs, [{ details, reloaded: true }]);
  });

  it("clean exits and windows outside the live main lifecycle are not reloaded", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    mock.timers.tick(10_000);

    const cases = [
      [{ reason: "clean-exit", exitCode: 0 }, {}],
      [{ reason: "crashed", exitCode: 1 }, { isCurrentWindow: false }],
      [{ reason: "crashed", exitCode: 1 }, { quitting: true }],
      [{ reason: "crashed", exitCode: 1 }, { windowCloseAccepted: true }],
      [{ reason: "crashed", exitCode: 1 }, { windowDestroyed: true }],
      [{ reason: "crashed", exitCode: 1 }, { webContentsDestroyed: true }],
    ];

    for (const [details, overrides] of cases) {
      // Advance clock so cooldown does not interfere.
      mock.timers.tick(10_000);
      const { calls, dependencies } = recovery(overrides);
      assert.equal(recoverRendererAfterGone(details, dependencies), false);
      assert.equal(calls.reload, 0);
      assert.deepEqual(calls.logs, [{ details, reloaded: false }]);
    }
  });

  it("new renderer exit reasons remain recoverable by default", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    mock.timers.tick(10_000);

    const { calls, dependencies } = recovery();
    assert.equal(
      recoverRendererAfterGone({ reason: "future-electron-reason", exitCode: 2 }, dependencies),
      true,
    );
    assert.equal(calls.reload, 1);
  });

  it("rapid consecutive crashes delay the reload instead of looping", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    mock.timers.tick(10_000);

    const first = recovery();
    const details = { reason: "crashed", exitCode: 1 };

    // First crash reloads immediately.
    assert.equal(recoverRendererAfterGone(details, first.dependencies), true);
    assert.equal(first.calls.reload, 1);

    // Second crash within cooldown window — reload is scheduled, not immediate.
    mock.timers.tick(500);
    const second = recovery();
    assert.equal(recoverRendererAfterGone(details, second.dependencies), true);
    assert.equal(second.calls.reload, 0, "should not reload synchronously during cooldown");

    // After the remaining cooldown elapses, the delayed reload fires.
    mock.timers.tick(1_500);
    assert.equal(second.calls.reload, 1, "delayed reload should have fired");
  });

  it("crashes after the cooldown window reload immediately", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    mock.timers.tick(10_000);

    const first = recovery();
    const details = { reason: "crashed", exitCode: 1 };
    recoverRendererAfterGone(details, first.dependencies);

    // Wait longer than cooldown.
    mock.timers.tick(3_000);
    const second = recovery();
    assert.equal(recoverRendererAfterGone(details, second.dependencies), true);
    assert.equal(second.calls.reload, 1, "should reload immediately after cooldown");
  });

  it("stops reloading after repeated crashes inside the window and hands the choice to the user", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    mock.timers.tick(10_000);

    // The shape of the field report: a renderer that dies of the same
    // out-of-memory session it reopens after every reload. Each exit arrives
    // well after the cooldown, so plain throttling never engaged.
    const details = { reason: "oom", exitCode: -536870904 };
    const outcomes = [];
    for (let crash = 0; crash < CRASH_LOOP_MAX_RELOADS; crash += 1) {
      const { calls, dependencies } = recovery({
        log: (_details, reloaded, outcome) => outcomes.push({ reloaded, outcome }),
      });
      assert.equal(recoverRendererAfterGone(details, dependencies), true);
      assert.equal(calls.reload, 1);
      assert.equal(calls.crashLoops, 0);
      mock.timers.tick(30_000);
    }
    assert.deepEqual(outcomes, Array(CRASH_LOOP_MAX_RELOADS).fill({ reloaded: true, outcome: "reloaded" }));

    const { calls, dependencies } = recovery({
      log: (_details, reloaded, outcome) => outcomes.push({ reloaded, outcome }),
    });
    assert.equal(recoverRendererAfterGone(details, dependencies), false);
    assert.equal(calls.reload, 0, "the breaker must not reload again");
    assert.equal(calls.crashLoops, 1, "the window is asked to involve the user");
    assert.deepEqual(outcomes.at(-1), { reloaded: false, outcome: "crash-loop" });
  });

  it("the breaker counts only reloads inside its window and a user-chosen reload starts over", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    mock.timers.tick(10_000);
    const details = { reason: "crashed", exitCode: 1 };

    for (let crash = 0; crash < CRASH_LOOP_MAX_RELOADS; crash += 1) {
      assert.equal(recoverRendererAfterGone(details, recovery().dependencies), true);
      mock.timers.tick(5_000);
    }
    // Once the earliest reload leaves the window, recovery resumes on its own.
    mock.timers.tick(CRASH_LOOP_WINDOW_MS);
    const later = recovery();
    assert.equal(recoverRendererAfterGone(details, later.dependencies), true);
    assert.equal(later.calls.reload, 1);

    // Fill the window again, trip the breaker, then let the user reload.
    for (let crash = 1; crash < CRASH_LOOP_MAX_RELOADS; crash += 1) {
      mock.timers.tick(5_000);
      recoverRendererAfterGone(details, recovery().dependencies);
    }
    mock.timers.tick(5_000);
    const tripped = recovery();
    assert.equal(recoverRendererAfterGone(details, tripped.dependencies), false);
    assert.equal(tripped.calls.crashLoops, 1);

    resetRendererRecoveryHistory();
    mock.timers.tick(5_000);
    const fresh = recovery();
    assert.equal(recoverRendererAfterGone(details, fresh.dependencies), true);
    assert.equal(fresh.calls.reload, 1);
  });

  it("skipped exits report why they were not reloaded", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"] });
    mock.timers.tick(10_000);
    const outcomes = [];
    const { dependencies } = recovery({
      log: (_details, reloaded, outcome) => outcomes.push({ reloaded, outcome }),
    });
    recoverRendererAfterGone({ reason: "clean-exit", exitCode: 0 }, dependencies);
    assert.deepEqual(outcomes, [{ reloaded: false, outcome: "skipped" }]);
  });
});

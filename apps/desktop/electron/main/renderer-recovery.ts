export type RendererGoneDetails = Readonly<{
  reason: string;
  exitCode: number;
}>;

/** What recovery did with one renderer exit, for diagnostics. */
export type RendererRecoveryOutcome =
  | "reloaded"
  /** Reloaded after the cooldown rather than at once. */
  | "delayed"
  /** A clean exit, or a window outside the live main lifecycle. */
  | "skipped"
  /** Too many reloads inside the window; the user decides what happens next. */
  | "crash-loop";

export type RendererRecoveryDependencies = Readonly<{
  isCurrentWindow: boolean;
  quitting: boolean;
  windowCloseAccepted: boolean;
  windowDestroyed: boolean;
  webContentsDestroyed: boolean;
  reload: () => void;
  log: (details: RendererGoneDetails, reloaded: boolean, outcome: RendererRecoveryOutcome) => void;
  /**
   * Called instead of `reload` once the renderer has been reloaded
   * `CRASH_LOOP_MAX_RELOADS` times inside `CRASH_LOOP_WINDOW_MS`. The embedding
   * window asks the user whether to reload or quit; a renderer that dies of the
   * same cause every time (an out-of-memory session it reopens on every start)
   * must not be reloaded into that cause forever.
   */
  onCrashLoop?: (details: RendererGoneDetails) => void;
}>;

/**
 * Minimum milliseconds between automatic reloads. A renderer that crashes
 * again within this window is still reloaded, but the reload is delayed so
 * the process is not spinning in a tight crash loop.
 */
const CRASH_COOLDOWN_MS = 2_000;

/** Automatic reloads tolerated inside `CRASH_LOOP_WINDOW_MS`. */
export const CRASH_LOOP_MAX_RELOADS = 3;
/** The window over which reloads are counted. */
export const CRASH_LOOP_WINDOW_MS = 5 * 60_000;

/** Tracks the last reload timestamp per recovery call site. */
let lastReloadTimestamp = 0;
/** When each automatic reload inside the current window was issued. */
let reloadTimestamps: number[] = [];

/**
 * Reset internal cooldown state. Exposed exclusively for deterministic tests;
 * production code must never call this.
 */
export function _resetCooldownForTest(): void {
  lastReloadTimestamp = 0;
  reloadTimestamps = [];
}

/**
 * Forget the reload history after the user chose to reload from the crash-loop
 * prompt: that reload is theirs, and the count starts over from it.
 */
export function resetRendererRecoveryHistory(): void {
  reloadTimestamps = [];
}

/** Reload an unexpectedly exited renderer while its owning app window is live. */
export function recoverRendererAfterGone(
  details: RendererGoneDetails,
  dependencies: RendererRecoveryDependencies,
): boolean {
  const shouldReload =
    details.reason !== "clean-exit" &&
    dependencies.isCurrentWindow &&
    !dependencies.quitting &&
    !dependencies.windowCloseAccepted &&
    !dependencies.windowDestroyed &&
    !dependencies.webContentsDestroyed;

  if (!shouldReload) {
    dependencies.log(details, false, "skipped");
    return false;
  }

  const now = Date.now();
  reloadTimestamps = reloadTimestamps.filter((at) => now - at < CRASH_LOOP_WINDOW_MS);
  if (reloadTimestamps.length >= CRASH_LOOP_MAX_RELOADS) {
    dependencies.log(details, false, "crash-loop");
    dependencies.onCrashLoop?.(details);
    return false;
  }
  reloadTimestamps.push(now);

  const elapsed = now - lastReloadTimestamp;
  lastReloadTimestamp = now;

  if (elapsed < CRASH_COOLDOWN_MS) {
    // Delay the reload to avoid a tight crash loop. The timer is short
    // enough that the user sees a brief blank rather than a frozen app.
    dependencies.log(details, true, "delayed");
    setTimeout(() => dependencies.reload(), CRASH_COOLDOWN_MS - elapsed);
  } else {
    dependencies.log(details, true, "reloaded");
    dependencies.reload();
  }

  return true;
}

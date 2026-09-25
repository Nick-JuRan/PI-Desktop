/**
 * Fork feature: maximum subagent delegation depth.
 *
 * `AppSettings.maxSubagentDepth` is validated at every process boundary with
 * these rules; host-core mirrors the same range in Rust. Depth one is the
 * upstream behavior (direct delegates only), zero disables delegation.
 */
export const DEFAULT_SUBAGENT_MAX_DEPTH = 1;
export const MIN_SUBAGENT_MAX_DEPTH = 0;
export const MAX_SUBAGENT_DEPTH = 5;

export function isValidSubagentMaxDepth(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_SUBAGENT_MAX_DEPTH &&
    value <= MAX_SUBAGENT_DEPTH
  );
}

/** Normalize the persisted maximum delegation depth at a process boundary. */
export function normalizeSubagentMaxDepth(value: unknown): number {
  return isValidSubagentMaxDepth(value) ? value : DEFAULT_SUBAGENT_MAX_DEPTH;
}

/**
 * Fork-only shared exports, published as `@pi-desktop/shared/fork`.
 *
 * Fork code imports its own symbols from here instead of adding lines to
 * upstream's alphabetized import lists, so an upstream rename next to a fork
 * import no longer produces a merge conflict. Upstream symbols keep coming
 * from `@pi-desktop/shared`.
 */
export * from "./subagent-depth.js";
export {
  resolveSubagentSkillIds,
  type SubagentToolResolutionContext,
} from "../subagent-definition.js";
export * from "../subagent-tools.js";

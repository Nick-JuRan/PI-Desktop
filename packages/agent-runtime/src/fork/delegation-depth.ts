/**
 * Fork-owned nested-delegation support (fork feature: subagent depth).
 *
 * Everything the depth rule needs lives here so `runtime.ts` only carries
 * one-line hooks into upstream code. Keep upstream's prompt text untouched:
 * `withNestedDelegationGuidance` receives it and only appends when the
 * configured depth actually allows nesting.
 */
import {
  SUBAGENT_LIST_TOOL_NAME,
  SUBAGENT_STOP_TOOL_NAME,
  SUBAGENT_TOOL_NAME,
  SUBAGENT_WAIT_TOOL_NAME,
} from "../subagent.js";

export type DelegationScope = {
  /** The direct parent delegation, or undefined for the main agent. */
  ownerDelegationId?: string;
  /** Zero for the main agent; a first-level delegate runs at depth one. */
  depth: number;
};

export const ROOT_DELEGATION_SCOPE: DelegationScope = Object.freeze({ depth: 0 });

/** Tools that start, await, list, or stop delegations. Never reuse the root
 * instances for a child: each instance closes over its ownership boundary. */
export const DELEGATION_CONTROL_TOOL_NAMES = [
  SUBAGENT_TOOL_NAME,
  SUBAGENT_WAIT_TOOL_NAME,
  SUBAGENT_LIST_TOOL_NAME,
  SUBAGENT_STOP_TOOL_NAME,
] as const;

const DELEGATION_CONTROL_TOOL_SET = new Set<string>(DELEGATION_CONTROL_TOOL_NAMES);

export function isDelegationControlTool(name: string): boolean {
  return DELEGATION_CONTROL_TOOL_SET.has(name);
}

/** Delegation exists at all only with definitions and a non-zero depth. */
export function delegationEnabled(subagentCount: number, maxDepth: number): boolean {
  return subagentCount > 0 && maxDepth > 0;
}

/** A scope may start another delegation while it sits above the configured depth. */
export function canDelegateFrom(scope: DelegationScope, maxDepth: number): boolean {
  return scope.depth < maxDepth;
}

/**
 * Strip the control tools from a delegate's selected tool names and re-add
 * them only while that delegate is still allowed to delegate further.
 */
export function withDelegationControls(
  names: readonly string[],
  depth: number,
  maxDepth: number,
): string[] {
  const base = names.filter((name) => !DELEGATION_CONTROL_TOOL_SET.has(name));
  if (depth >= maxDepth) return base;
  return [...base, ...DELEGATION_CONTROL_TOOL_NAMES];
}

/** Upstream's sentence that is only true while depth is one. */
const NO_RECURSION_SENTENCE = "No recursive delegation, duplicate work, or agent debates.";

/**
 * Append the fork's nested-delegation guidance to upstream's `## Delegation`
 * block. At depth one (the upstream default) the block is returned unchanged,
 * so the composed prompt stays byte-identical to upstream.
 */
export function withNestedDelegationGuidance(maxDepth: number, upstreamBlock: string): string {
  if (maxDepth <= 1) return upstreamBlock;
  const base = upstreamBlock.replace(
    NO_RECURSION_SENTENCE,
    "Avoid duplicate work and agent debates.",
  );
  return `${base}
Nested delegation: up to ${maxDepth} levels are configured. A delegate may itself delegate only while its Task tools are exposed; never exceed that boundary. Child reports return through TaskWait to their direct parent, which integrates them before finishing.`;
}

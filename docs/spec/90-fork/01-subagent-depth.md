# 90-01. Subagent depth

Fork feature. Extends `03-runtime/02-agent-runtime.md` §5f (delegation),
`03-runtime/01-ipc-protocol.md` (settings payload), `03-runtime/04-data-storage.md`,
`03-runtime/06-host-rpc-protocol.md` (`settings.set`), `04-ux/06-settings-ia.md`
(Subagents page), and `04-ux/08-component-spec.md` (delegation topology card).
Upstream forbids nested `Task`; this feature allows it up to a configured depth.

## 1. Setting

- `AppSettings.maxSubagentDepth` is an integer in `0..5`, default `1`.
- `0` disables delegation: the root runtime exposes no `Task` control tools and
  composes no delegation prompt block.
- `1` is upstream's behavior: only the main agent may create direct children.
- `2` and above let a first-level delegate create children of its own, down to
  the configured level.
- Host-core reads a missing or malformed value as `1`; `settings.set`
  validates the integer range and rejects anything else with `INVALID_PARAMS`.
  The value follows the additive JSON settings path, so no database schema
  migration is required and existing settings keep the direct-only default.
- `settings.get` returns the persisted value so the renderer can show it.
- The shared constants and normalizer live in `packages/shared/src/fork/subagent-depth.ts`
  and are exported from `@pi-desktop/shared/fork`; host-core mirrors the range in
  `crates/host-core/src/rpc/mod.rs`.

## 2. Runtime routing

- Every delegation records its one-based depth and its direct
  `parentDelegationId`. The main agent runs at depth `0`.
- A delegate receives scoped `Task`, `TaskWait`, `TaskList`, and `TaskStop`
  tools only while its depth is below the configured maximum. Each delegate
  gets its own tool instances closed over its ownership scope; the root
  instances are never reused for a child.
- Those scoped tools address only the calling agent's direct children:
  `TaskWait` converges on direct children, `TaskList` reports direct
  delegations, `TaskStop` stops direct children and their descendants, and
  `Task(resume)` must refer to a settled chain owned by the same direct
  parent — a root parent cannot resume a nested chain by id.
- A nested report therefore returns to the first-level parent, never directly
  to the main agent, and a second-level delegate has no user or main-agent
  communication path. A main-agent wait never consumes a second-level report
  directly.
- A parent must `TaskWait` for child reports before it finishes; terminal
  parent settlement aborts any remaining descendants rather than leaving an
  orphaned run.
- Changing the setting retires the live runtime so the next prompt rebuilds
  the tool set with the new depth.

## 3. Prompt

- At depth `1` the composed system prompt is byte-identical to upstream.
- At depth `2` and above, `withNestedDelegationGuidance` in
  `packages/agent-runtime/src/fork/delegation-depth.ts` replaces upstream's
  "no recursive delegation" sentence and appends a paragraph stating the
  configured depth, that a delegate may itself delegate only while its `Task`
  tools are exposed, and that child reports return through `TaskWait` to the
  direct parent.
- Nested delegates receive a prompt naming their direct parent and explicitly
  excluding the user and main agent. A delegate that may create children is
  told to use the scoped four-tool lifecycle and to wait for those reports
  before returning its own report.

## 4. Settings UI

The Subagents page includes a **Subagent execution** card with a **Maximum
subagent depth** setting. The persisted values are `0` (delegation disabled),
`1` (the main agent may create direct subagents), and `2` (a first-level
subagent may also create a second-level child); higher bounded levels are
available for deeper nested workflows. The description explains that child
communication is direct-parent scoped, so nested reports return through
`TaskWait` to the first-level parent rather than directly to the main agent.
The strings are the fork block at the top of each locale file
(`settings.subagentExecutionTitle`, `settings.subagentDepth*`).

## 5. Conversation topology card

The expanded delegation card renders a low-noise connector graph with one
main-agent root connected to the `Task` nodes in parent-row order. When a
delegate emits another `Task`, that row becomes a child branch directly after
its parent node. The child uses the same agent/model/description/status/
runtime/step treatment and the same side-panel selection behavior as a
first-level node. Ordinary delegate tools remain process rows rather than
topology nodes, and the rendered branch depth follows the configured maximum
subagent depth. Replayed `Task` snapshots with the same `delegationId` remain
one topology node; the latest snapshot supplies the visible status while
retaining the linked child process.

## 6. E2E scenarios

#### E2E-SUBAGENT-nested-depth-direct-parent-rounds: Nested delegation is depth-bounded and resumes through the direct parent

- **Preconditions**: A deterministic Agent runtime fixture has at least one
  enabled subagent definition and a local provider fixture. Settings → Agent →
  Subagents is reachable.
- **Steps**: 1) Set **Maximum subagent depth** to `1` and start a root `Task`;
  confirm the first-level tool set has no `Task` control tools. 2) Set it to
  `2`, start a root `Task`, then have that first-level delegate start a child
  `Task`. 3) From the first-level delegate, use `TaskWait` and read the child
  report. 4) Resume the settled child with its `delegationId` from the same
  first-level parent and complete a second round. 5) Attempt to list, wait for,
  or resume the nested child from the main agent. 6) In the conversation UI,
  expand the delegation card, select the first-level node, then select its
  second-level child node. 7) Set the value to `0` and start a new root prompt.
- **Expected**: At depth `1`, only the main agent can create direct children.
  At depth `2`, the first-level delegate can create and repeatedly resume its
  own direct child, while `TaskWait`, `TaskList`, and `TaskStop` expose only
  that direct-parent scope. The second-level delegate's prompt has no main-agent
  or user channel, and the main agent cannot consume its report directly.
  The conversation graph shows the main-agent root, the first-level node, and
  a connected second-level child node in order. The child has the same status,
  model, duration, step-count and side-panel behavior as the first-level node;
  selecting it opens its own live process and repeated child rounds. A replayed
  `Task` snapshot with the same `delegationId` does not create a second visual
  child card; the latest snapshot remains connected to the existing process.
  Depth `0` removes delegation controls from the root runtime. A parent that
  finishes without waiting aborts unfinished descendants, so no orphaned child
  remains.
- **Specs linked**: this page; `03-runtime/02-agent-runtime.md` §5f;
  `04-ux/06-settings-ia.md` Agent capability destinations
- **Acceptance**: C (conversation), Quality (bounded delegation and lifecycle)
- **Status**: Runtime and prompt boundaries are covered by
  `packages/agent-runtime/src/runtime.test.ts` and
  `packages/agent-runtime/src/subagent.test.ts`; the normalizer by
  `packages/shared/src/fork/subagent-depth.test.ts`; settings persistence is
  covered by the host-core RPC test. The topology rendering and tab selection
  steps run in a real hidden Electron window through the fork-owned runner
  `node scripts/e2e-fork-nested-topology.mjs` (probe
  `scripts/e2e/fork-nested-topology.tsx`). The remaining Settings journey
  should run only in the repository's integration environment.

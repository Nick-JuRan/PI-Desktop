# FORK.md — upstream files touched by the fork

Registry required by `FORK-STANDARD.md` D3. Every **upstream** file that differs from `vastsa/PI-Desktop` main in this fork, grouped by the fork feature that owns the change. Fork-only files (islands: `packages/*/src/fork/`, `Extensions/`, `docs/spec/90-fork/`, `docs/zh-CN/spec/90-fork/`, `apps/desktop/test/subagent-tool-catalog.test.mjs`, `apps/desktop/test/voice-ipc-contract.test.mjs`, `packages/shared/src/subagent-tools.ts`, `apps/desktop/src/components/settings/subagent-presets.ts`, `packages/agent-runtime/src/extensions/catalog-probe-ui*.ts`, `FORK-STANDARD.md`, this file) are not listed because they cannot conflict.

How to use it: (1) it shows the conflict surface at a glance — the fewer rows and the smaller the numbers, the cleaner every upstream sync; (2) during a sync, a conflicting file that is **not** listed here is resolved by taking upstream's version (`FORK-STANDARD.md` C2); (3) every PR that touches an upstream file updates this table. `hook` = a few added lines only (an import statement, a call, a spread, a note). `integration point` = the fork had to change upstream lines; each is a candidate to shrink into a hook or to send upstream as a `fix`.

Feature pages: `docs/spec/90-fork/`. Generated against `upstream/main` = `0433e7cc3`; regenerate the raw list with the command at the end.

## subagent depth

| upstream file | +/− vs upstream | kind | introduced by |
| --- | --- | --- | --- |
| `apps/desktop/src/features/chat/transcript/SubagentDetail.tsx` | +47 −9 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/src/features/chat/transcript/ToolRow.tsx` | +13 −4 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/src/features/settings/SettingsPage.tsx` | +4 −2 | hook | fix(voice): pass settings state to voice panel |
| `apps/desktop/src/lib/api.ts` | +20 −0 | integration point | refactor(fork): isolate subagent-depth into fork-owned modules |
| `apps/desktop/src/lib/assistant-turns.ts` | +64 −21 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/src/lib/settings-search.ts` | +3 −0 | hook | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/src/lib/subagent-topology.ts` | +103 −13 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/src/lib/turn-process.ts` | +15 −2 | integration point | fix(merge): restore activity issue projection import |
| `apps/desktop/src/styles/extensions.css` | +116 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/src/styles/messages.css` | +30 −2 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/test/agent-capability-settings.test.mjs` | +4 −1 | hook | docs(fork): move fork specs to 90-fork, add island AGENTS.md, FORK.md, drop merge residue |
| `apps/desktop/test/assistant-turns.test.mjs` | +116 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/test/subagent-topology.test.mjs` | +88 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/test/subagent-transcript.test.mjs` | +17 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `crates/host-core/src/rpc/mod.rs` | +74 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/agent-runtime/src/delegation-chain.ts` | +13 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/agent-runtime/src/delegation-history.ts` | +11 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/agent-runtime/src/runtime.test.ts` | +273 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/agent-runtime/src/runtime.ts` | +286 −47 | integration point | docs(fork): move fork specs to 90-fork, add island AGENTS.md, FORK.md, drop merge residue |
| `packages/agent-runtime/src/sidecar.ts` | +82 −0 | integration point | refactor(fork): isolate subagent-depth into fork-owned modules |
| `packages/agent-runtime/src/subagent.test.ts` | +13 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/agent-runtime/src/subagent.ts` | +19 −3 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/host-runtime/src/agent-sidecar.ts` | +9 −4 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/host-runtime/src/launch-resolver.ts` | +3 −0 | hook | refactor(fork): isolate subagent-depth into fork-owned modules |
| `packages/shared/src/types/settings.ts` | +2 −0 | hook | feat: 引入子代理深度、子代理工具调用选择 |
| `scripts/e2e/transcript-render.tsx` | +17 −2 | integration point | fix(e2e): adapt desktop scenarios to upstream UI changes |

## subagent tool selection

| upstream file | +/− vs upstream | kind | introduced by |
| --- | --- | --- | --- |
| `apps/desktop/electron/main/agent-extensions.ts` | +24 −0 | integration point | feat(subagents): discover trusted extension tools dynamically |
| `apps/desktop/electron/main/index.ts` | +4 −10 | integration point | fix(voice): complete local dictation integration |
| `apps/desktop/electron/main/ipc/register.ts` | +2 −0 | hook | fix(voice): complete local dictation integration |
| `apps/desktop/electron/main/ipc/skills-ipc.ts` | +9 −0 | integration point | refactor(fork): isolate subagent-depth into fork-owned modules |
| `apps/desktop/electron/main/plugin-runtime.ts` | +10 −6 | integration point | feat(subagents): discover trusted extension tools dynamically |
| `apps/desktop/electron/main/runtime/session-launch.ts` | +171 −3 | integration point | refactor(fork): isolate subagent-depth into fork-owned modules |
| `apps/desktop/electron/main/runtime/sidecar.ts` | +9 −1 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/src/components/settings/AgentSubagentsPage.tsx` | +75 −4 | integration point | refactor(fork): isolate subagent-depth into fork-owned modules |
| `apps/desktop/src/components/settings/SubagentEditorSheet.tsx` | +213 −27 | integration point | refactor(fork): isolate subagent-depth into fork-owned modules |
| `apps/desktop/test/agent-extensions.test.mjs` | +14 −8 | integration point | feat(subagents): discover trusted extension tools dynamically |
| `apps/desktop/test/session-collaboration-ipc.test.mjs` | +1 −1 | hook | refactor(i18n): keep fork strings in one block per locale file |
| `apps/desktop/test/subagent-editor-helpers.test.mjs` | +17 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/test/subagent-editor-presets.test.mjs` | +7 −3 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `apps/desktop/test/subagent-model-launch.test.mjs` | +1 −0 | hook | feat(subagents): discover trusted extension tools dynamically |
| `apps/desktop/test/subagent-wiring.test.mjs` | +32 −0 | integration point | feat(subagents): discover trusted extension tools dynamically |
| `crates/host-core/src/user_subagents.rs` | +36 −0 | integration point | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/shared/package.json` | +4 −0 | hook | refactor(fork): isolate subagent-depth into fork-owned modules |
| `packages/shared/src/index.ts` | +1 −0 | hook | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/shared/src/protocol.ts` | +1 −0 | hook | feat: 引入子代理深度、子代理工具调用选择 |
| `packages/shared/src/subagent-definition.test.ts` | +64 −0 | integration point | refactor(fork): isolate subagent-depth into fork-owned modules |
| `packages/shared/src/subagent-definition.ts` | +64 −6 | integration point | refactor(fork): isolate subagent-depth into fork-owned modules |

## i18n fork block (depth + tool-selection strings)

| upstream file | +/− vs upstream | kind | introduced by |
| --- | --- | --- | --- |
| `packages/i18n/src/locales/de/index.ts` | +31 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |
| `packages/i18n/src/locales/en/index.ts` | +30 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |
| `packages/i18n/src/locales/es/index.ts` | +31 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |
| `packages/i18n/src/locales/fr/index.ts` | +31 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |
| `packages/i18n/src/locales/ko/index.ts` | +31 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |
| `packages/i18n/src/locales/pt-BR/index.ts` | +31 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |
| `packages/i18n/src/locales/tr/index.ts` | +31 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |
| `packages/i18n/src/locales/zh-CN/index.ts` | +31 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |
| `packages/i18n/src/locales/zh-TW/index.ts` | +31 −0 | hook (top-of-file block + 2 spreads) | refactor(i18n): keep fork strings in one block per locale file |

## fork documentation hooks

| upstream file | +/− vs upstream | kind | introduced by |
| --- | --- | --- | --- |
| `docs/.vitepress/config.mts` | +1 −0 | hook | docs(fork): move fork specs to 90-fork, add island AGENTS.md, FORK.md, drop merge residue |
| `docs/spec/03-runtime/02-agent-runtime.md` | +2 −0 | hook | docs(fork): move fork specs to 90-fork, add island AGENTS.md, FORK.md, drop merge residue |
| `docs/spec/04-ux/08-component-spec.md` | +1 −0 | hook | docs(fork): move fork specs to 90-fork, add island AGENTS.md, FORK.md, drop merge residue |
| `docs/spec/NAV.md` | +8 −0 | hook | docs(fork): move fork specs to 90-fork, add island AGENTS.md, FORK.md, drop merge residue |
| `docs/zh-CN/spec/NAV.md` | +8 −0 | hook | docs(fork): move fork specs to 90-fork, add island AGENTS.md, FORK.md, drop merge residue |

## windows portability / test-gate adaptations

| upstream file | +/− vs upstream | kind | introduced by |
| --- | --- | --- | --- |
| `apps/desktop/electron/main/logger.ts` | +1 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/electron/main/runtime/lifecycle.ts` | +2 −0 | hook | fix(electron): keep runtime entry within architecture budget |
| `apps/desktop/package.json` | +1 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/agent-runtime-bundle-package.test.mjs` | +6 −2 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/chat-error-message.test.mjs` | +1 −2 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/chat-review-entry.test.mjs` | +1 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/extensions-page.test.mjs` | +4 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/helpers/domain-source.mjs` | +6 −2 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/icon-tooltip.test.mjs` | +1 −1 | hook | fix(test): tolerate CRLF in tooltip source check |
| `apps/desktop/test/macos-release-verification.test.mjs` | +11 −9 | integration point | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/macos-signing-diagnostics.test.mjs` | +8 −6 | integration point | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/macos-signing-watchdog.test.mjs` | +14 −12 | integration point | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/packaging-footprint.test.mjs` | +5 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/plugin-websocket.test.mjs` | +13 −4 | integration point | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/remote-host-bootstrap-script.test.mjs` | +6 −4 | integration point | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/remote-host-ssh-password.test.mjs` | +7 −5 | integration point | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/remote-host-ssh-transport.test.mjs` | +11 −9 | integration point | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/rpc-lifecycle-contract.test.mjs` | +1 −1 | hook | merge resolution |
| `apps/desktop/test/runtime-build-contract.test.mjs` | +2 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/desktop/test/session-message-presentation.test.mjs` | +1 −0 | hook | fix(test): stub transcript timestamp in presentation fixture |
| `apps/pi-host/src/config.test.ts` | +4 −4 | integration point | fix(desktop): make Windows build and test gates portable |
| `apps/pi-host/src/host-operations.test.ts` | +2 −2 | hook | fix(desktop): make Windows build and test gates portable |
| `apps/pi-host/src/host-operations.ts` | +8 −2 | integration point | fix(desktop): make Windows build and test gates portable |
| `crates/host-core/src/mcp_servers/tests.rs` | +2 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `crates/host-core/src/sessions/fork_files.rs` | +6 −1 | hook | merge resolution |
| `crates/host-core/src/user_skills/tests.rs` | +1 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `docs/architecture/allowlist.json` | +4 −1 | hook | fix(architecture): document Mid-Autumn scene budget |
| `packages/agent-runtime/src/hosted-search-compaction.test.ts` | +1 −1 | hook | merge resolution |
| `packages/agent-runtime/src/native-pi-session.test.ts` | +2 −2 | hook | fix(desktop): make Windows build and test gates portable |
| `packages/host-runtime/src/launch-resolver.test.ts` | +2 −1 | hook | fix(desktop): make Windows build and test gates portable |
| `scripts/e2e-image-chat.mjs` | +10 −3 | integration point | fix(e2e): adapt desktop scenarios to upstream UI changes |
| `scripts/e2e-keep-awake.mjs` | +70 −22 | integration point | fix(e2e): align portable release and restart checks |

## voice (upstream feature; fork carries an IPC channel fix — candidate to send upstream)

| upstream file | +/− vs upstream | kind | introduced by |
| --- | --- | --- | --- |
| `apps/desktop/electron/main/voice-service.ts` | +3 −2 | hook | fix(voice): complete local dictation integration |

Total upstream files touched: 94.

Fork E2E islands (never conflict): `scripts/e2e/fork-nested-topology.tsx` + `scripts/e2e-fork-nested-topology.mjs` (run with `node scripts/e2e-fork-nested-topology.mjs`).

## Regenerate the raw list

```bash
git fetch upstream main
git diff --name-status upstream/main -- . | awk '$1=="M"{print $2}' | while read -r path; do
  git diff --numstat upstream/main -- "$path"
done | sort -k3
```

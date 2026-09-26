# 90-02. Subagent tool selection

Fork feature. Extends `03-runtime/02-agent-runtime.md` §5f (delegate tools),
`03-runtime/01-ipc-protocol.md` §12c (renderer IPC), `03-runtime/03-tools-and-permissions.md`
§11 (trusted extension tools), `03-runtime/04-data-storage.md` (subagent documents),
`04-ux/06-settings-ia.md` §7 (Subagents editor), and `07-plugins/16-trusted-extensions.md`
§7. Upstream lets a definition either name built-in tools or opt into the
parent's whole catalog with `tools: inherit`; this feature adds explicit,
least-privilege grants of Skills, MCP servers, plugin tools, and trusted
extension tools.

## 1. Dynamic capability grants

The Subagents editor keeps the stable built-in tool checkboxes in the main
**Available tools** group and exposes an **Advanced** disclosure for active
Skills, user MCP servers, plugin-contributed agent tools, and tools reported by
loaded trusted extensions. A selected Skill is persisted as `skill:<skill-id>`
and activates the generic `Skill` loader plus that Skill's catalog entry only.
A selected user MCP server is persisted as `mcp:<server-id>` and activates
every tool returned by that server's current handshake. Ordinary plugin tools
are persisted by their full runtime name and trusted-extension tools by
generated selectors; both are individually selectable. Electron supplies the
editor with a project-scoped live catalog through
`pi-desktop/subagent/tool-catalog`; the runtime resolves selectors against the
same session catalog at delegation time, so removed, disabled, or out-of-scope
capabilities are not exposed. The delegated `Skill` call also carries the
selected Skill ids to the host bridge, which rejects a manually requested
unselected id. Existing `tools: inherit` documents keep their
backwards-compatible parent-catalog semantics; explicit dynamic selectors are
the least-privilege mode for a definition that does not opt into inheritance.

Selector helpers (`subagentSkillSelector`, `subagentMcpSelector`,
`subagentExtensionToolSelector`, `isSubagentDynamicSelection`) and the catalog
types live in `packages/shared/src/subagent-tools.ts` and are exported from
`@pi-desktop/shared/fork`.

## 2. `subagent/tool-catalog` IPC

`subagent/tool-catalog` returns the project-scoped editor catalog: `skills`
contains active built-in, plugin, and user Skill ids with display metadata;
`mcpServers` contains active user MCP records plus the latest cached
connection state and discovered tool names; and `pluginTools` contains active
plugin agent tools and tools reported by trusted extensions through a session
load or catalog probe. Ordinary plugin tools use their full runtime name.
Trusted-extension rows carry a generated selector alongside the declared tool
name, so the renderer persists the selector without hardcoding any extension
tool name. The renderer persists Skill selections as `skill:<id>`, MCP
selections as `mcp:<server-id>`, and plugin or trusted-extension selections in
the subagent `tools` array. The channel is a discovery surface only: delegation
resolves those selectors again against the live sidecar catalog before
constructing the child tool list. The channel constant is
`IPC.invoke.subagentToolCatalog` in `packages/shared/src/protocol.ts`; the
handler is registered from `apps/desktop/electron/main/ipc/skills-ipc.ts` and
implemented by `subagentToolCatalog` in
`apps/desktop/electron/main/runtime/session-launch.ts`.

## 3. Trusted extension tools

Trusted ExtensionAPI tools are registered under the declared name in the live
sidecar catalog. After a successful extension load or catalog probe, Electron
includes those reported names in the project-scoped Subagents Advanced catalog
with generated selectors. Delegation resolves a selected selector back to the
declared name and validates it against the current session catalog; unloading,
disabling, or losing the extension therefore removes the grant on the next
resolution.

When no session has loaded the module, the `extensions.catalog` sidecar probe
runs the same enabled extension specs with an inert bridge, reports
registrations, and is not an agent session or a substitute for the per-session
Runner. After a successful session load or catalog probe, the desktop's
Subagents Advanced catalog includes every tool name reported by the extension.
Each row carries a generated persisted selector; the editor and runtime do not
hardcode extension tool names. Delegation maps the selector back to the
currently registered name, so a disabled, unloaded, or out-of-scope extension
cannot keep the grant.

## 4. Persistence

Subagent documents persist dynamic capability grants in their existing
frontmatter `tools` array (`skill:<id>`, `mcp:<server-id>`, or a full plugin
tool name). Host-core preserves these namespaced entries during normalization
(`crates/host-core/src/user_subagents.rs`); the live Electron/sidecar catalog
validates them at delegation time, so adding the selectors does not require a
database or document-version migration.

## 5. Settings UI

Under **Available tools**, the sheet keeps the seven stable built-in tool
checkboxes visible and adds a separate **Advanced** disclosure. Its groups
show the active Skills, user MCP servers, and plugin agent tools for the
current workspace. The picker stays compact: Skills and plugin tools show
only their names, while an MCP row shows its name and the number of loaded
tools; selected counts appear beside the disclosure. Selecting a Skill grants
only that Skill to the delegate, selecting an MCP server grants all tools
discovered from that server, and plugin tools are selected one by one. A
loading state and an empty state are shown instead of a blank panel. The
catalog refreshes when the sheet opens, while scope-disabled capabilities are
omitted from the list. The strings are the fork block at the top of each
locale file (`extensions.subagents.toolCatalog*`, `extensions.subagents.mcp*`).

## 6. E2E scenarios

#### E2E-SUBAGENT-explicit-capability-selection

- **Preconditions**: Agent mode; one active user Skill and one active user MCP
  server have been added in Settings → Agent; the MCP fixture advertises at
  least two tools; a plugin with at least two agent tools is enabled.
- **Steps**:
  1. Open Settings → Agent → Subagents and edit a user-owned subagent.
  2. Under **Available tools**, expand **Advanced** and confirm the active Skill,
     MCP server, and plugin tools appear as separate grouped checkbox cards with
     source/status text. Select the Skill, the MCP server, and exactly one of the
     plugin tools; leave the other plugin tool unchecked. Save and reopen the
     editor to verify the selections persist.
  3. Start a new Agent turn and delegate to the edited subagent. Inspect the
     child tool catalog and prompt, then ask it to load the selected Skill and
     call the selected plugin tool.
  4. Ask the child to load the unselected Skill or call the unselected plugin
     tool, and ask the child to use both discovered MCP tools.
- **Expected**: The editor loads its catalog through the host-backed IPC path.
  The child receives `Skill`, only the checked Skill id in its Skill prompt,
  every tool from the checked MCP server, and only the checked plugin tool.
  The unselected plugin tool is absent from the child tool list. The selected
  Skill loads successfully; a manually requested unselected Skill returns a
  bounded grant error. A disabled or out-of-scope capability disappears from
  the next catalog/runtime resolution rather than remaining callable.
- **Specs linked**: this page; `03-runtime/02-agent-runtime.md` §5f;
  `04-ux/06-settings-ia.md` §7; `07-plugins/03-plugin-api.md`; ADR 0038
- **Acceptance**: E (tools & permissions), G (Skill/MCP/plugin activation)
- **Milestone**: M6+
- **Status**: Unit-covered (`packages/shared`, `packages/agent-runtime`,
  `apps/desktop/test/subagent-wiring.test.mjs`); real Settings/sidecar journey
  remains to be run with the user's active Skill, MCP, and plugin fixtures.

#### E2E-SUBAGENT-trusted-extension-tool-selection

- **Preconditions**: Agent mode; an enabled plugin declares a trusted
  `contributes.agentExtensions` module whose code registers an arbitrary tool
  name. The active project is in the plugin's scope; no provider-bound session
  load is required because the Settings request can use the sidecar catalog
  probe.
- **Steps**:
  1. Open Settings → Agent → Subagents and edit a user-owned subagent.
  2. Expand **Advanced** and confirm the extension's reported tool appears in
     the plugin-tools group without a source-code tool-name list. Select it and
     save; reopen the editor and verify the selection persists.
  3. Start a new Agent turn and delegate to the edited subagent. Inspect the
     child tool catalog and ask it to call the selected extension tool.
  4. Disable or unload the extension, start the next turn, and inspect the
     catalog again.
- **Expected**: `subagent/tool-catalog` uses the sidecar catalog probe when no
  session report exists, then exposes each live extension tool with a generated
  selector and the renderer displays it as an individually optional card. The
  saved definition contains the selector, not a hardcoded project tool list.
  Delegation resolves the selector to the current sidecar tool and the child
  can call it; after disable/unload the next catalog and delegation omit it.
- **Specs linked**: this page; `03-runtime/01-ipc-protocol.md` §12c;
  `03-runtime/02-agent-runtime.md` §5f; `03-runtime/03-tools-and-permissions.md`
  §11; `07-plugins/16-trusted-extensions.md` §7
- **Acceptance**: E (tools & permissions), G (Skill/MCP/plugin activation)
- **Milestone**: M6+
- **Status**: Unit/source-contract covered by `packages/shared`,
  `apps/desktop/test/subagent-tool-catalog.test.mjs`, and the desktop wiring
  tests; the native Settings/sidecar journey remains to be run with a loaded
  extension fixture.

# 90-02. 子智能体工具选择

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/02-subagent-tool-selection) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。扩展 `03-runtime/02-agent-runtime.md` §5f（子代理工具）、`03-runtime/01-ipc-protocol.md` §12c（渲染层 IPC）、`03-runtime/03-tools-and-permissions.md` §11（可信扩展工具）、`03-runtime/04-data-storage.md`（子智能体文档）、`04-ux/06-settings-ia.md` §7（子智能体编辑器）和 `07-plugins/16-trusted-extensions.md` §7。upstream 只允许定义按名称声明内置工具，或用 `tools: inherit` 继承父级整个目录；本功能增加对 Skill、MCP 服务器、插件工具和可信扩展工具的显式最小授权。

## 1. 动态能力授权

子智能体编辑器把稳定的内置工具复选框保留在主 **可用工具** 分组，并提供一个 **高级** 折叠区，列出活动的 Skill、用户 MCP 服务器、插件贡献的智能体工具和已加载可信扩展报告的工具。选中的 Skill 持久化为 `skill:<skill-id>`，只激活通用的 `Skill` 加载器和该 Skill 的目录条目。选中的用户 MCP 服务器持久化为 `mcp:<server-id>`，激活该服务器当前握手返回的全部工具。普通插件工具按完整运行时名称持久化，可信扩展工具按生成的选择器持久化；二者都可单独选择。Electron 通过 `pi-desktop/subagent/tool-catalog` 向编辑器提供项目范围的实时目录；运行时在委派时对同一会话目录再次解析选择器，因此被移除、禁用或超出范围的能力不会暴露。委派的 `Skill` 调用同时把选中的 Skill id 带给宿主桥接，桥接会拒绝手动请求的未选中 id。已有的 `tools: inherit` 文档保持向后兼容的父目录语义；显式动态选择器是不选择继承的定义的最小权限模式。

选择器辅助函数（`subagentSkillSelector`、`subagentMcpSelector`、`subagentExtensionToolSelector`、`isSubagentDynamicSelection`）与目录类型位于 `packages/shared/src/subagent-tools.ts`，从 `@pi-desktop/shared/fork` 导出。

## 2. `subagent/tool-catalog` IPC

`subagent/tool-catalog` 返回项目范围的编辑器目录：`skills` 包含活动的内置、插件和用户 Skill id 及显示元数据；`mcpServers` 包含活动的用户 MCP 记录以及最近缓存的连接状态和已发现的工具名；`pluginTools` 包含活动的插件智能体工具和可信扩展通过会话加载或目录探测报告的工具。普通插件工具使用完整运行时名称。可信扩展行在声明的工具名之外携带一个生成的选择器，因此渲染层持久化选择器而不硬编码任何扩展工具名。渲染层把 Skill 选择持久化为 `skill:<id>`，MCP 选择为 `mcp:<server-id>`，插件或可信扩展选择写入子智能体的 `tools` 数组。该通道只是发现面：委派在构造子代理工具列表前会对实时 sidecar 目录再次解析这些选择器。通道常量是 `packages/shared/src/protocol.ts` 中的 `IPC.invoke.subagentToolCatalog`；handler 由 `apps/desktop/electron/main/ipc/skills-ipc.ts` 注册，由 `apps/desktop/electron/main/runtime/session-launch.ts` 中的 `subagentToolCatalog` 实现。

## 3. 可信扩展工具

可信 ExtensionAPI 工具按声明的名称注册到实时 sidecar 目录。扩展加载成功或目录探测成功后，Electron 把这些报告的名称连同生成的选择器纳入项目范围的"子智能体 → 高级"目录。委派把选中的选择器解析回声明的名称并对当前会话目录校验；卸载、禁用或失去扩展都会在下一次解析时移除该授权。

当没有会话加载该模块时，`extensions.catalog` sidecar 探测以惰性桥接运行相同的已启用扩展规格，只报告注册项；它不是 Agent 会话，也不替代每会话 Runner。会话成功加载或目录探测成功后，桌面"子智能体 → 高级"目录包含扩展报告的每个工具名。每行使用自动生成的持久化选择器；编辑器和运行时不硬编码扩展工具名。委托时选择器映射到当前已注册的名称，因此禁用、未加载或超出范围的扩展不能保留该授权。

## 4. 持久化

子智能体文档在已有的 frontmatter `tools` 数组中持久化动态能力授权（`skill:<id>`、`mcp:<server-id>` 或完整插件工具名）。host-core 在归一化时保留这些带命名空间的条目（`crates/host-core/src/user_subagents.rs`）；实时的 Electron/sidecar 目录在委派时校验它们，因此新增选择器不需要数据库或文档版本迁移。

## 5. 设置界面

在 **可用工具** 下，编辑面板保留七个稳定的内置工具复选框，并增加一个独立的 **高级** 折叠区。其中的分组显示当前工作区活动的 Skill、用户 MCP 服务器和插件智能体工具。选择器保持紧凑：Skill 和插件工具只显示名称，MCP 行显示名称和已加载工具数；折叠区旁显示已选数量。选中一个 Skill 只把该 Skill 授予子代理，选中一个 MCP 服务器授予该服务器发现的全部工具，插件工具逐个选择。加载状态与空状态替代空白面板显示。面板打开时刷新目录，被范围禁用的能力不出现在列表中。文案位于每个语言文件顶部的 fork 块（`extensions.subagents.toolCatalog*`、`extensions.subagents.mcp*`）。

## 6. E2E 场景

#### E2E-SUBAGENT-explicit-capability-selection

- **前提**：Agent 模式；已在设置 → 智能体中添加一个活动的用户 Skill 和一个活动的用户 MCP 服务器；MCP 夹具至少宣告两个工具；启用了一个至少有两个智能体工具的插件。
- **步骤**：
  1. 打开设置 → 智能体 → 子智能体，编辑一个用户自建的子智能体。
  2. 在 **可用工具** 下展开 **高级**，确认活动的 Skill、MCP 服务器和插件工具以独立分组的复选卡片显示，并带来源/状态文字。选中该 Skill、该 MCP 服务器和恰好一个插件工具；另一个插件工具保持未选。保存并重新打开编辑器，确认选择仍然存在。
  3. 开始新的 Agent 回合并委派给该子智能体。检查子代理的工具目录和提示词，然后要求它加载选中的 Skill 并调用选中的插件工具。
  4. 要求子代理加载未选中的 Skill 或调用未选中的插件工具，并要求它使用两个已发现的 MCP 工具。
- **预期**：编辑器通过宿主支持的 IPC 路径加载目录。子代理获得 `Skill`、Skill 提示词中只有选中的 Skill id、选中 MCP 服务器的全部工具，以及只有选中的插件工具。未选中的插件工具不在子代理工具列表中。选中的 Skill 加载成功；手动请求未选中的 Skill 返回有界的授权错误。被禁用或超出范围的能力在下一次目录/运行时解析中消失，而不是仍可调用。
- **关联规格**：本页；`03-runtime/02-agent-runtime.md` §5f；`04-ux/06-settings-ia.md` §7；`07-plugins/03-plugin-api.md`；ADR 0038
- **验收**：E（工具与权限）、G（Skill/MCP/插件激活）
- **里程碑**：M6+
- **状态**：单元覆盖（`packages/shared`、`packages/agent-runtime`、`apps/desktop/test/subagent-wiring.test.mjs`）；真实的设置/sidecar 旅程仍需用用户的活动 Skill、MCP 和插件夹具运行。

#### E2E-SUBAGENT-trusted-extension-tool-selection

- **前提**：Agent 模式；某个已启用插件声明了可信的 `contributes.agentExtensions` 模块，模块代码注册任意工具名。当前项目在插件范围内；不要求绑定 provider 的会话加载，因为设置请求可以使用 sidecar 目录探测。
- **步骤**：
  1. 打开设置 → 智能体 → 子智能体，编辑一个用户自建的子智能体。
  2. 展开 **高级**，确认扩展报告的工具出现在插件工具分组中，且源代码里没有工具名列表。选中它并保存；重新打开编辑器，确认选择仍然存在。
  3. 开始新的 Agent 回合并委派给该子智能体。检查子代理工具目录，并要求它调用选中的扩展工具。
  4. 禁用或卸载扩展，开始下一回合，再次检查目录。
- **预期**：没有会话报告时，`subagent/tool-catalog` 使用 sidecar 目录探测，然后以生成的选择器暴露每个实时扩展工具，渲染层把它显示为可单独选择的卡片。保存的定义包含选择器，而不是硬编码的项目工具列表。委派时选择器解析为当前 sidecar 工具，子代理可以调用它；禁用或卸载后，下一次目录和委派都会省略该工具。
- **关联规格**：本页；`03-runtime/01-ipc-protocol.md` §12c；`03-runtime/02-agent-runtime.md` §5f；`03-runtime/03-tools-and-permissions.md` §11；`07-plugins/16-trusted-extensions.md` §7
- **验收**：E（工具与权限）、G（Skill/MCP/插件激活）
- **里程碑**：M6+
- **状态**：由 `packages/shared`、`apps/desktop/test/subagent-tool-catalog.test.mjs` 和桌面接线测试提供单元/源码契约覆盖；带已加载扩展夹具的原生设置/sidecar 旅程仍需运行。

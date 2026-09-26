# 90-04. 分类查询插件

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/04-classification-query) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。`Extensions/classification-queryer` 是注册 `classification_query` 智能体工具的 fork 自有可信扩展，不钩入任何 upstream 文件。开发文档是 `Extensions/classification-queryer/README.md`。

## 1. 范围

- 该工具在一次调用中回答 IPC 与 CPC 分类问题。其 schema 只呈现 `ipc.codes`、`ipc.keywords`、`cpc.codes` 和 `cpc.keywords`。
- 结果是以 `IPC` 和/或 `CPC` 为根的纯文本：代码查询保留官方的祖先/后代树，关键词命中合并成稀疏层级并把叶节点描述附在代码上，失败以简明的查询行呈现。结果中没有 request、year、language、端点、操作或逐查询响应包络字段。
- 因为它是可信扩展，其工具通过 `02-subagent-tool-selection.md` 中的选择机制到达子智能体。

## 2. E2E 场景

#### E2E-PLUGIN-classification-query-tree

- **前提**：Agent 模式；本地 `classification-queryer` 插件已加载并授予 `agent.extension`；其官方 IPC/CPC 分类夹具可用；可以在设置 → 智能体中编辑一个用户自建的子智能体。
- **步骤**：
  1. 打开设置 → 智能体 → 子智能体，编辑该用户自建子智能体，展开 **高级**，确认 `classification_query` 是从已加载的扩展目录中发现的。选中并保存；重新打开编辑器确认选择仍然存在。
  2. 开始新的 Agent 回合并委派给该子智能体。要求它用包含代码与关键词数组的嵌套 `ipc` 和 `cpc` 对象调用一次 `classification_query`。
  3. 检查两个分类体系的工具结果，再分别用只有代码和只有关键词的查询重复。
- **预期**：工具选择器由实时扩展工具目录填充，而不是项目源码里硬编码的名称列表。schema 只呈现简洁的 `ipc.codes`、`ipc.keywords`、`cpc.codes` 和 `cpc.keywords` 输入。一次调用执行全部请求的查询类型。结果是以 `IPC` 和/或 `CPC` 为根的纯文本，分类代码分组为可读的树，叶节点描述附在代码上。其中不包含 `request`、`year`、`language`、端点、操作或逐查询响应包络字段。代码查询保留官方祖先/后代树；关键词命中合并为稀疏层级；失败是简明的查询行。
- **关联规格**：本页；`02-subagent-tool-selection.md`；`07-plugins/16-trusted-extensions.md` §7；`Extensions/classification-queryer/README.md`
- **验收**：E（工具与权限）、G（插件激活）、Quality
- **里程碑**：M6+
- **状态**：由 `Extensions/classification-queryer/test/query.test.mjs` 和 `Extensions/classification-queryer/test/presentation.test.mjs` 提供单元覆盖；已加载插件的设置/sidecar 旅程仍需在具备条件的桌面环境中运行。

# 90-01. 子智能体深度

> **翻译说明：** 本页是与 [英文源规格](/spec/90-fork/01-subagent-depth) 一一对应的翻译。代码、协议字段和标识符保持原文；如翻译与英文源事实有歧义，以英文版本为准。

fork 功能。扩展 `03-runtime/02-agent-runtime.md` §5f（委派）、`03-runtime/01-ipc-protocol.md`（设置载荷）、`03-runtime/04-data-storage.md`、`03-runtime/06-host-rpc-protocol.md`（`settings.set`）、`04-ux/06-settings-ia.md`（子智能体页）和 `04-ux/08-component-spec.md`（委派拓扑卡片）。upstream 禁止嵌套 `Task`；本功能允许在配置的深度内嵌套。

## 1. 设置项

- `AppSettings.maxSubagentDepth` 是 `0..5` 范围内的整数，默认 `1`。
- `0` 关闭委派：根运行时不暴露任何 `Task` 控制工具，也不拼装委派提示段。
- `1` 是 upstream 的行为：只有主智能体可以创建直接子代理。
- `2` 及以上允许一级子代理继续创建自己的子代理，直到配置的层级。
- host-core 把缺失或非法值读作 `1`；`settings.set` 校验整数范围，其它值以 `INVALID_PARAMS` 拒绝。该值走增量 JSON 设置路径，不需要数据库 schema 迁移，已有设置保持直接委派的默认值。
- `settings.get` 返回持久化的值供渲染层显示。
- 共享常量与归一化函数位于 `packages/shared/src/fork/subagent-depth.ts`，从 `@pi-desktop/shared/fork` 导出；host-core 在 `crates/host-core/src/rpc/mod.rs` 镜像同一范围。

## 2. 运行时路由

- 每次委派记录从 1 开始的深度和直接的 `parentDelegationId`。主智能体运行在深度 `0`。
- 只有当子代理的深度低于配置的最大值时，它才获得限定范围的 `Task`、`TaskWait`、`TaskList`、`TaskStop` 工具。每个子代理拿到的是闭包在自身所有权范围上的独立实例；根实例不会复用给子代理。
- 这些限定范围的工具只作用于调用方的直接子代理：`TaskWait` 只汇聚直接子代理，`TaskList` 只报告直接委派，`TaskStop` 停止直接子代理及其后代，`Task(resume)` 只能指向同一直接父级拥有的已结束链——根父级不能按 id 恢复嵌套链。
- 因此嵌套报告返回给一级父级，而不是直接返回主智能体；二级子代理没有到用户或主智能体的通信路径。主智能体的等待永远不会直接消费二级报告。
- 父级必须在结束前 `TaskWait` 子代理报告；父级终态结算会中止剩余后代，而不是留下孤儿运行。
- 修改该设置会让当前运行时退役，下一次提示按新深度重建工具集。

## 3. 提示词

- 深度为 `1` 时，拼装出的系统提示词与 upstream 逐字节相同。
- 深度为 `2` 及以上时，`packages/agent-runtime/src/fork/delegation-depth.ts` 中的 `withNestedDelegationGuidance` 替换 upstream 的"不递归委派"一句，并追加一段说明：配置的深度、子代理只在其 `Task` 工具被暴露时才可以继续委派、子代理报告通过 `TaskWait` 返回直接父级。
- 嵌套子代理收到的提示词写明其直接父级，并明确排除用户与主智能体。可以创建子代理的子代理会被告知使用限定范围的四工具生命周期，并在返回自己的报告前等待这些报告。

## 4. 设置界面

子智能体页包含一张 **子智能体执行** 卡片，提供 **最大子智能体深度** 设置。持久化值为 `0`（关闭委派）、`1`（主智能体可创建直接子代理）和 `2`（一级子代理也可创建二级子代理）；更深的有界层级可用于更深的嵌套工作流。说明文字解释子代理通信限定在直接父级范围内，因此嵌套报告通过 `TaskWait` 返回一级父级，而不是直接返回主智能体。文案位于每个语言文件顶部的 fork 块（`settings.subagentExecutionTitle`、`settings.subagentDepth*`）。

## 5. 会话拓扑卡片

展开的委派卡片渲染一张低噪声的连接图：一个主智能体根节点按父行顺序连接到各个 `Task` 节点。当某个子代理发出另一个 `Task` 时，该行成为紧跟其父节点之后的子分支。子节点使用与一级节点相同的智能体/模型/描述/状态/运行时长/步数呈现，以及相同的侧栏选择行为。子代理的普通工具仍然是过程行而不是拓扑节点，渲染的分支深度遵循配置的最大子智能体深度。`delegationId` 相同的重放 `Task` 快照仍是同一个拓扑节点；最新快照提供可见状态，同时保留关联的子进程。

## 6. E2E 场景

#### E2E-SUBAGENT-nested-depth-direct-parent-rounds：嵌套委派受深度限制，并通过直接父级恢复

- **前提**：确定性的 Agent 运行时夹具至少有一个已启用的子智能体定义和一个本地 provider 夹具。设置 → 智能体 → 子智能体可以打开。
- **步骤**：1）把 **最大子智能体深度** 设为 `1` 并启动一个根 `Task`；确认一级工具集里没有 `Task` 控制工具。2）设为 `2`，启动根 `Task`，再让该一级子代理启动一个子 `Task`。3）在一级子代理中使用 `TaskWait` 并读取子代理报告。4）从同一个一级父级用其 `delegationId` 恢复已结束的子代理，完成第二轮。5）尝试从主智能体列出、等待或恢复该嵌套子代理。6）在会话界面展开委派卡片，选择一级节点，再选择其二级子节点。7）把值设为 `0` 并开始新的根提示。
- **预期**：深度 `1` 时只有主智能体能创建直接子代理。深度 `2` 时一级子代理可以创建并反复恢复自己的直接子代理，而 `TaskWait`、`TaskList`、`TaskStop` 只暴露直接父级范围。二级子代理的提示词没有主智能体或用户通道，主智能体不能直接消费其报告。会话图依次显示主智能体根节点、一级节点和相连的二级子节点。子节点与一级节点有相同的状态、模型、时长、步数和侧栏行为；选择它会打开其自己的实时进程和多轮记录。`delegationId` 相同的重放 `Task` 快照不会产生第二张子卡片；最新快照仍连接到既有进程。深度 `0` 会移除根运行时的委派控制。未等待就结束的父级会中止未完成的后代，不留下孤儿子代理。
- **关联规格**：本页；`03-runtime/02-agent-runtime.md` §5f；`04-ux/06-settings-ia.md` 智能体能力目标页
- **验收**：C（会话）、Quality（有界委派与生命周期）
- **状态**：运行时与提示词边界由 `packages/agent-runtime/src/runtime.test.ts` 和 `packages/agent-runtime/src/subagent.test.ts` 覆盖；归一化由 `packages/shared/src/fork/subagent-depth.test.ts` 覆盖；设置持久化由 host-core RPC 测试覆盖。拓扑渲染与标签选择步骤由 fork 自有的运行器 `node scripts/e2e-fork-nested-topology.mjs`（探针 `scripts/e2e/fork-nested-topology.tsx`）在真实的隐藏 Electron 窗口中运行。其余的设置页旅程只应在仓库的集成环境中运行。

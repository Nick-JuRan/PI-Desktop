import type { forkExtensionsSubagents as EnForkExtensionsSubagents, forkSettings as EnForkSettings } from "../en/fork.js";

type Stringify<T> = { [K in keyof T]: string };

export const forkSettings = {
  subagentExecutionTitle: "子智能体执行",
  subagentDepthTitle: "最大子智能体深度",
  subagentDepthDesc: "控制子智能体最多可以创建多少层。1 表示主智能体可创建一级子智能体；2 表示一级子智能体还可以创建二级子智能体；0 表示关闭委派。",
  subagentDepthLevel: "{{depth}} 级",
  subagentDepthDisabled: "关闭",
} satisfies Stringify<typeof EnForkSettings>;

export const forkExtensionsSubagents = {
  toolCatalogHint: "关闭继承时，只激活已勾选的能力。勾选 MCP 服务器会授予该服务器的全部工具。",
  toolCatalogSkills: "Skills",
  toolCatalogMcp: "MCP 服务器",
  toolCatalogPlugins: "插件工具",
  toolCatalogLoading: "正在加载当前工作区可用的能力…",
  toolCatalogEmpty: "当前工作区没有可选择的 Skill、MCP 服务器或插件工具。",
  mcpAllTools: "选中后加载此服务器发现的全部工具",
  mcpToolCount: "已加载 {{count}} 个工具",
  mcpToolCount_one: "已加载 1 个工具",
  mcpToolCount_other: "已加载 {{count}} 个工具",
  mcpStatusReady: "就绪",
  mcpStatusConnecting: "连接中",
  mcpStatusFailed: "失败",
  mcpStatusIdle: "尚未测试",
} satisfies Stringify<typeof EnForkExtensionsSubagents>;

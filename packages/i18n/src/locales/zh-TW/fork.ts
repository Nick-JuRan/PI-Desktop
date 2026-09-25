import type { forkExtensionsSubagents as EnForkExtensionsSubagents, forkSettings as EnForkSettings } from "../en/fork.js";

type Stringify<T> = { [K in keyof T]: string };

export const forkSettings = {
  subagentExecutionTitle: "子智慧體執行",
  subagentDepthTitle: "最大子智慧體深度",
  subagentDepthDesc: "控制子智慧體最多可以建立多少層。1 表示主智慧體可建立第一層子智慧體；2 表示第一層子智慧體也能建立子層；0 表示停用委派。",
  subagentDepthLevel: "第 {{depth}} 層",
  subagentDepthDisabled: "停用",
} satisfies Stringify<typeof EnForkSettings>;

export const forkExtensionsSubagents = {
  toolCatalogHint: "關閉繼承時，只會啟用已勾選的能力。勾選 MCP 伺服器會授予該伺服器的所有工具。",
  toolCatalogSkills: "Skills",
  toolCatalogMcp: "MCP 伺服器",
  toolCatalogPlugins: "外掛工具",
  toolCatalogLoading: "正在載入目前工作區可用的能力…",
  toolCatalogEmpty: "目前工作區沒有可選擇的 Skill、MCP 伺服器或外掛工具。",
  mcpAllTools: "選取後授予此伺服器發現的所有工具",
  mcpToolCount: "已載入 {{count}} 個工具",
  mcpToolCount_one: "已載入 1 個工具",
  mcpToolCount_other: "已載入 {{count}} 個工具",
  mcpStatusReady: "就緒",
  mcpStatusConnecting: "連線中",
  mcpStatusFailed: "失敗",
  mcpStatusIdle: "尚未測試",
} satisfies Stringify<typeof EnForkExtensionsSubagents>;

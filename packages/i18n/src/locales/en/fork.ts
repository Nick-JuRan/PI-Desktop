/**
 * Fork-only UI strings (fork features: subagent depth, subagent tool selection).
 * Spread into the English catalog from `./index.ts`; every other locale mirrors
 * these keys in its own `fork.ts`.
 */
export const forkSettings = {
  subagentExecutionTitle: "Subagent execution",
  subagentDepthTitle: "Maximum subagent depth",
  subagentDepthDesc: "Controls how many levels of delegated subagents may be created. 1 allows direct subagents; 2 also allows them to create children; 0 disables delegation.",
  subagentDepthLevel: "Level {{depth}}",
  subagentDepthDisabled: "Disabled",
};

export const forkExtensionsSubagents = {
  toolCatalogHint: "With inheritance off, only checked capabilities are activated. Checking an MCP server grants all of its tools.",
  toolCatalogSkills: "Skills",
  toolCatalogMcp: "MCP servers",
  toolCatalogPlugins: "Plugin tools",
  toolCatalogLoading: "Loading capabilities available in this workspace…",
  toolCatalogEmpty: "No active Skills, MCP servers, or plugin tools are available in this workspace.",
  mcpAllTools: "Selecting this server grants all discovered tools",
  mcpToolCount: "{{count}} tools loaded",
  mcpToolCount_one: "1 tool loaded",
  mcpToolCount_other: "{{count}} tools loaded",
  mcpStatusReady: "ready",
  mcpStatusConnecting: "connecting",
  mcpStatusFailed: "failed",
  mcpStatusIdle: "not tested",
};

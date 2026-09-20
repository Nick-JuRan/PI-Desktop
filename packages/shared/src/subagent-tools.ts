import type { McpConnectionState } from "./types/capabilities.js";

/** Persisted selector prefixes for non-builtin subagent capabilities. */
export const SUBAGENT_SKILL_SELECTOR_PREFIX = "skill:";
export const SUBAGENT_MCP_SELECTOR_PREFIX = "mcp:";
/** Persisted selector prefix for tools registered by a trusted extension. */
export const SUBAGENT_EXTENSION_SELECTOR_PREFIX = "extension_";

export function subagentSkillSelector(id: string): string {
  return `${SUBAGENT_SKILL_SELECTOR_PREFIX}${id}`;
}

export function subagentMcpSelector(serverId: string): string {
  return `${SUBAGENT_MCP_SELECTOR_PREFIX}${serverId}`;
}

export function subagentSkillIdFromSelector(value: string): string | undefined {
  if (!value.startsWith(SUBAGENT_SKILL_SELECTOR_PREFIX)) return undefined;
  const id = value.slice(SUBAGENT_SKILL_SELECTOR_PREFIX.length).trim();
  return id || undefined;
}

export function subagentMcpServerIdFromSelector(value: string): string | undefined {
  if (!value.startsWith(SUBAGENT_MCP_SELECTOR_PREFIX)) return undefined;
  const id = value.slice(SUBAGENT_MCP_SELECTOR_PREFIX.length).trim();
  return id || undefined;
}

/**
 * Create the persisted selector for one trusted-extension tool.
 *
 * ExtensionAPI tool names are supplied by third-party code, so encode the
 * value before placing it in the comma-separated frontmatter list. The
 * runtime keeps the selector-to-runtime-name mapping in memory.
 */
export function subagentExtensionToolSelector(toolName: string): string {
  return `${SUBAGENT_EXTENSION_SELECTOR_PREFIX}${encodeURIComponent(toolName)}`;
}

/**
 * Namespaced runtime tools are safe to persist as explicit grants. Runtime
 * resolution still validates each name against the live session catalog before
 * exposing it to a delegate.
 */
export function isSubagentNamespacedToolName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value.startsWith("plugin_") || value.startsWith("mcp_") || value.startsWith("extension_"))
  );
}

/** Whether a frontmatter entry is a dynamic Skill/MCP/plugin selection. */
export function isSubagentDynamicSelection(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (subagentSkillIdFromSelector(value) !== undefined ||
      subagentMcpServerIdFromSelector(value) !== undefined ||
      isSubagentNamespacedToolName(value))
  );
}

/** One selectable Skill document shown in the subagent editor. */
export type SubagentSkillOption = {
  id: string;
  name: string;
  description?: string;
  source: "builtin" | "user" | "plugin";
  sourceLabel?: string;
};

/** One selectable MCP server. Selecting it grants all tools discovered for it. */
export type SubagentMcpOption = {
  id: string;
  label: string;
  description?: string;
  state: McpConnectionState;
  toolCount: number;
  toolNames: string[];
  message?: string;
};

/** One individually selectable plugin- or trusted-extension-contributed tool. */
export type SubagentPluginToolOption = {
  name: string;
  label: string;
  description?: string;
  pluginId: string;
  pluginLabel?: string;
  /** Persisted selector; trusted-extension tools use this instead of `name`. */
  selector?: string;
};

/** Dynamic capability catalog used by Settings → Subagents → Edit. */
export type SubagentToolCatalog = {
  projectPath: string | null;
  skills: SubagentSkillOption[];
  mcpServers: SubagentMcpOption[];
  pluginTools: SubagentPluginToolOption[];
};

export const EMPTY_SUBAGENT_TOOL_CATALOG: SubagentToolCatalog = {
  projectPath: null,
  skills: [],
  mcpServers: [],
  pluginTools: [],
};

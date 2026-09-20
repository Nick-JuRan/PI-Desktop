import type { SubagentPreset } from "@pi-desktop/shared";

/**
 * Catalog keys for each built-in preset. Hyphenated ids cannot be generated
 * safely by capitalizing the id, so the mapping stays explicit.
 */
export const SUBAGENT_PRESET_COPY = {
  explorer: { name: "presetExplorerName", desc: "presetExplorerDesc" },
  "code-reviewer": { name: "presetReviewerName", desc: "presetReviewerDesc" },
  "test-runner": { name: "presetTestRunnerName", desc: "presetTestRunnerDesc" },
  fixer: { name: "presetFixerName", desc: "presetFixerDesc" },
  "ui-designer": { name: "presetUiDesignerName", desc: "presetUiDesignerDesc" },
} as const satisfies Record<SubagentPreset["id"], { name: string; desc: string }>;

/** Full i18n path for a preset chip, or null when `id` is blank / unknown. */
export function subagentPresetCopyKey(
  id: string,
  kind: "name" | "desc",
): string | null {
  if (!Object.hasOwn(SUBAGENT_PRESET_COPY, id)) return null;
  const entry = SUBAGENT_PRESET_COPY[id as keyof typeof SUBAGENT_PRESET_COPY];
  return `extensions.subagents.${entry[kind]}`;
}

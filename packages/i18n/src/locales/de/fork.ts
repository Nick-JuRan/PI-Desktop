import type { forkExtensionsSubagents as EnForkExtensionsSubagents, forkSettings as EnForkSettings } from "../en/fork.js";

type Stringify<T> = { [K in keyof T]: string };

export const forkSettings = {
  subagentExecutionTitle: "Subagent-Ausführung",
  subagentDepthTitle: "Maximale Subagent-Tiefe",
  subagentDepthDesc: "Legt fest, wie viele Ebenen delegierter Subagenten erstellt werden dürfen. 1 erlaubt direkte Subagenten, 2 auch deren Kinder, 0 deaktiviert Delegation.",
  subagentDepthLevel: "Ebene {{depth}}",
  subagentDepthDisabled: "Deaktiviert",
} satisfies Stringify<typeof EnForkSettings>;

export const forkExtensionsSubagents = {
  toolCatalogHint: "Bei deaktivierter Vererbung werden nur ausgewählte Fähigkeiten aktiviert. Die Auswahl eines MCP-Servers gewährt alle darin enthaltenen Werkzeuge.",
  toolCatalogSkills: "Skills",
  toolCatalogMcp: "MCP-Server",
  toolCatalogPlugins: "Plugin-Werkzeuge",
  toolCatalogLoading: "Verfügbare Fähigkeiten dieses Arbeitsbereichs werden geladen…",
  toolCatalogEmpty: "In diesem Arbeitsbereich sind keine auswählbaren Skills, MCP-Server oder Plugin-Werkzeuge verfügbar.",
  mcpAllTools: "Die Auswahl gewährt alle entdeckten Werkzeuge dieses Servers",
  mcpToolCount: "{{count}} geladene Werkzeuge",
  mcpToolCount_one: "1 geladenes Werkzeug",
  mcpToolCount_other: "{{count}} geladene Werkzeuge",
  mcpStatusReady: "bereit",
  mcpStatusConnecting: "wird verbunden",
  mcpStatusFailed: "fehlgeschlagen",
  mcpStatusIdle: "nicht getestet",
} satisfies Stringify<typeof EnForkExtensionsSubagents>;

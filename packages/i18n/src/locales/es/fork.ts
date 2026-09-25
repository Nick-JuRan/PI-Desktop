import type { forkExtensionsSubagents as EnForkExtensionsSubagents, forkSettings as EnForkSettings } from "../en/fork.js";

type Stringify<T> = { [K in keyof T]: string };

export const forkSettings = {
  subagentExecutionTitle: "Ejecución de subagentes",
  subagentDepthTitle: "Profundidad máxima de subagentes",
  subagentDepthDesc: "Controla cuántos niveles de subagentes delegados pueden crearse. 1 permite subagentes directos, 2 también sus hijos y 0 desactiva la delegación.",
  subagentDepthLevel: "Nivel {{depth}}",
  subagentDepthDisabled: "Desactivado",
} satisfies Stringify<typeof EnForkSettings>;

export const forkExtensionsSubagents = {
  toolCatalogHint: "Con la herencia desactivada, solo se activan las capacidades marcadas. Seleccionar un servidor MCP concede todas sus herramientas.",
  toolCatalogSkills: "Skills",
  toolCatalogMcp: "Servidores MCP",
  toolCatalogPlugins: "Herramientas de plugins",
  toolCatalogLoading: "Cargando las capacidades disponibles en este espacio de trabajo…",
  toolCatalogEmpty: "No hay Skills, servidores MCP ni herramientas de plugins seleccionables en este espacio de trabajo.",
  mcpAllTools: "Seleccionar este servidor concede todas las herramientas descubiertas",
  mcpToolCount: "{{count}} herramientas cargadas",
  mcpToolCount_one: "1 herramienta cargada",
  mcpToolCount_other: "{{count}} herramientas cargadas",
  mcpStatusReady: "listo",
  mcpStatusConnecting: "conectando",
  mcpStatusFailed: "fallido",
  mcpStatusIdle: "sin probar",
} satisfies Stringify<typeof EnForkExtensionsSubagents>;

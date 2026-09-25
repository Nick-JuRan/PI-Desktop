import type { forkExtensionsSubagents as EnForkExtensionsSubagents, forkSettings as EnForkSettings } from "../en/fork.js";

type Stringify<T> = { [K in keyof T]: string };

export const forkSettings = {
  subagentExecutionTitle: "Exécution des sous-agents",
  subagentDepthTitle: "Profondeur maximale des sous-agents",
  subagentDepthDesc: "Contrôle le nombre de niveaux de sous-agents délégués pouvant être créés. 1 autorise les sous-agents directs, 2 leurs enfants aussi, et 0 désactive la délégation.",
  subagentDepthLevel: "Niveau {{depth}}",
  subagentDepthDisabled: "Désactivé",
} satisfies Stringify<typeof EnForkSettings>;

export const forkExtensionsSubagents = {
  toolCatalogHint: "Lorsque l’héritage est désactivé, seules les capacités cochées sont activées. Cocher un serveur MCP accorde tous ses outils.",
  toolCatalogSkills: "Skills",
  toolCatalogMcp: "Serveurs MCP",
  toolCatalogPlugins: "Outils des plugins",
  toolCatalogLoading: "Chargement des capacités disponibles dans cet espace de travail…",
  toolCatalogEmpty: "Aucun Skill, serveur MCP ou outil de plugin sélectionnable n'est disponible ici.",
  mcpAllTools: "Sélectionner ce serveur accorde tous les outils découverts",
  mcpToolCount: "{{count}} outils chargés",
  mcpToolCount_one: "1 outil chargé",
  mcpToolCount_other: "{{count}} outils chargés",
  mcpStatusReady: "prêt",
  mcpStatusConnecting: "connexion",
  mcpStatusFailed: "échec",
  mcpStatusIdle: "non testé",
} satisfies Stringify<typeof EnForkExtensionsSubagents>;

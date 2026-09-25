import type { forkExtensionsSubagents as EnForkExtensionsSubagents, forkSettings as EnForkSettings } from "../en/fork.js";

type Stringify<T> = { [K in keyof T]: string };

export const forkSettings = {
  subagentExecutionTitle: "Execução do subagente",
  subagentDepthTitle: "Profundidade máxima de subagentes",
  subagentDepthDesc: "Controla quantos níveis de subagentes delegados podem ser criados. 1 permite subagentes diretos; 2 permite que eles criem outros; 0 desativa a delegação.",
  subagentDepthLevel: "Nível {{depth}}",
  subagentDepthDisabled: "Desativado",
} satisfies Stringify<typeof EnForkSettings>;

export const forkExtensionsSubagents = {
  toolCatalogHint: "Com a herança desativada, somente os recursos marcados são ativados. Ao marcar um servidor MCP, todas as ferramentas dele são concedidas.",
  toolCatalogSkills: "Habilidades",
  toolCatalogMcp: "Servidores MCP",
  toolCatalogPlugins: "Ferramentas de plugins",
  toolCatalogLoading: "Carregando os recursos disponíveis neste espaço de trabalho…",
  toolCatalogEmpty: "Não há habilidades, servidores MCP ou ferramentas de plugins ativos neste espaço de trabalho.",
  mcpAllTools: "Selecionar este servidor concede acesso a todas as ferramentas encontradas",
  mcpToolCount: "{{count}} ferramentas carregadas",
  mcpToolCount_one: "1 ferramenta carregada",
  mcpToolCount_other: "{{count}} ferramentas carregadas",
  mcpStatusReady: "pronto",
  mcpStatusConnecting: "conectando",
  mcpStatusFailed: "falhou",
  mcpStatusIdle: "não testado",
} satisfies Stringify<typeof EnForkExtensionsSubagents>;

import type { forkExtensionsSubagents as EnForkExtensionsSubagents, forkSettings as EnForkSettings } from "../en/fork.js";

type Stringify<T> = { [K in keyof T]: string };

export const forkSettings = {
  subagentExecutionTitle: "Alt ajan yürütme",
  subagentDepthTitle: "Maksimum alt ajan derinliği",
  subagentDepthDesc: "Kaç düzeyde devredilmiş alt ajan oluşturulabileceğini belirler. 1 doğrudan alt ajanlara, 2 onların çocuklarına da izin verir; 0 devri kapatır.",
  subagentDepthLevel: "Düzey {{depth}}",
  subagentDepthDisabled: "Devre dışı",
} satisfies Stringify<typeof EnForkSettings>;

export const forkExtensionsSubagents = {
  toolCatalogHint: "Devralma kapalıyken yalnızca işaretlenen yetenekler etkinleştirilir. Bir MCP sunucusunu işaretlemek tüm araçlarını verir.",
  toolCatalogSkills: "Skills",
  toolCatalogMcp: "MCP sunucuları",
  toolCatalogPlugins: "Eklenti araçları",
  toolCatalogLoading: "Bu çalışma alanındaki kullanılabilir yetenekler yükleniyor…",
  toolCatalogEmpty: "Bu çalışma alanında seçilebilir Skill, MCP sunucusu veya eklenti aracı yok.",
  mcpAllTools: "Bu sunucuyu seçmek keşfedilen tüm araçları verir",
  mcpToolCount: "{{count}} araç yüklendi",
  mcpToolCount_one: "1 araç yüklendi",
  mcpToolCount_other: "{{count}} araç yüklendi",
  mcpStatusReady: "hazır",
  mcpStatusConnecting: "bağlanıyor",
  mcpStatusFailed: "başarısız",
  mcpStatusIdle: "test edilmedi",
} satisfies Stringify<typeof EnForkExtensionsSubagents>;

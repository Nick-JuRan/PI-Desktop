import type { forkExtensionsSubagents as EnForkExtensionsSubagents, forkSettings as EnForkSettings } from "../en/fork.js";

type Stringify<T> = { [K in keyof T]: string };

export const forkSettings = {
  subagentExecutionTitle: "서브에이전트 실행",
  subagentDepthTitle: "최대 서브에이전트 깊이",
  subagentDepthDesc: "만들 수 있는 위임 서브에이전트의 수준을 설정합니다. 1은 직접 서브에이전트, 2는 그 자식까지 허용하며 0은 위임을 끕니다.",
  subagentDepthLevel: "{{depth}}단계",
  subagentDepthDisabled: "사용 안 함",
} satisfies Stringify<typeof EnForkSettings>;

export const forkExtensionsSubagents = {
  toolCatalogHint: "상속을 끄면 선택한 기능만 활성화됩니다. MCP 서버를 선택하면 해당 서버의 모든 도구가 부여됩니다.",
  toolCatalogSkills: "Skills",
  toolCatalogMcp: "MCP 서버",
  toolCatalogPlugins: "플러그인 도구",
  toolCatalogLoading: "이 작업 공간에서 사용할 수 있는 기능을 불러오는 중…",
  toolCatalogEmpty: "이 작업 공간에 선택할 수 있는 Skill, MCP 서버 또는 플러그인 도구가 없습니다.",
  mcpAllTools: "이 서버를 선택하면 검색된 모든 도구가 부여됩니다",
  mcpToolCount: "로드된 도구 {{count}}개",
  mcpToolCount_one: "로드된 도구 1개",
  mcpToolCount_other: "로드된 도구 {{count}}개",
  mcpStatusReady: "준비됨",
  mcpStatusConnecting: "연결 중",
  mcpStatusFailed: "실패",
  mcpStatusIdle: "테스트 안 함",
} satisfies Stringify<typeof EnForkExtensionsSubagents>;

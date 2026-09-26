/**
 * Fork E2E probe: nested delegation renders as a connected topology branch and
 * selecting the nested node opens its own subagent transcript tab
 * (docs/spec/90-fork/01-subagent-depth.md, E2E-SUBAGENT-nested-depth-direct-parent-rounds).
 *
 * This is a fork island: it is bundled and run by scripts/e2e-fork-nested-topology.mjs
 * and touches no upstream probe. It mirrors the upstream transcript-render
 * harness (real React DOM, production transcript components, no mocks).
 */
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { en } from "@pi-desktop/i18n";
import type { UiMessage } from "@pi-desktop/shared";
import { AssistantTurn } from "../../apps/desktop/src/features/chat/transcript/AssistantTurn";
import { buildTranscriptEntries } from "../../apps/desktop/src/lib/assistant-turns";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

declare global {
  // eslint-disable-next-line no-var
  var forkNestedTopologyProbe: () => Promise<{
    ok: boolean;
    nestedTopologyRendered: boolean;
    nestedTopologyTabSelection: boolean;
    failures: string[];
  }>;
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const createdAt = "2026-09-13T00:00:00.000Z";
const message = (
  id: string,
  role: UiMessage["role"],
  content: string,
  extra: Partial<UiMessage> = {},
): UiMessage => ({ id, role, content, createdAt, ...extra });

globalThis.forkNestedTopologyProbe = async () => {
  const i18n = createInstance();
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  useAppStore.setState({
    settings: {
      defaultMode: "agent",
      theme: "dark",
      enterToSend: true,
      onboardingDismissed: false,
      smoothStreaming: false,
    },
  });
  const container = document.createElement("div");
  document.body.append(container);
  const renderErrors: unknown[] = [];
  const root = createRoot(container, {
    onUncaughtError: (error) => {
      renderErrors.push(error);
    },
  });
  const render = (messages: UiMessage[]) => {
    const entry = buildTranscriptEntries(messages).entries.find(
      (item) => item.kind === "assistant-turn",
    );
    assert(entry?.kind === "assistant-turn", "assistant turn missing");
    flushSync(() =>
      root.render(
        <I18nextProvider i18n={i18n}>
          <AssistantTurn entry={entry} isActive />
        </I18nextProvider>,
      ),
    );
    assert(
      renderErrors.length === 0,
      `React render failed: ${renderErrors.map(String).join("; ")}`,
    );
  };
  const failures: string[] = [];
  let nestedTopologyRendered = false;
  let nestedTopologyTabSelection = false;
  try {
    const nestedStart = Date.now() - 6_000;
    render([
      message("nested-user", "user", "Inspect the nested delegation"),
      message("nested-root-task", "tool", "started", {
        toolName: "Task",
        toolCallId: "nested-root-call",
        toolStatus: "success",
        toolArgs: { agent: "architect", task: "Delegate a child check" },
        toolResult: {
          details: {
            delegationId: "nested-root-delegation",
            status: "completed",
            startedAt: nestedStart,
            completedAt: nestedStart + 5_000,
          },
        },
      }),
      message("nested-level1-note", "assistant", "I am delegating the child check.", {
        parentToolCallId: "nested-root-call",
        agentName: "architect",
      }),
      message("nested-child-task", "tool", "started", {
        toolName: "Task",
        toolCallId: "nested-child-call",
        parentToolCallId: "nested-root-call",
        toolStatus: "success",
        toolArgs: { agent: "implementer", task: "Inspect the nested path" },
        toolResult: {
          details: {
            delegationId: "nested-child-delegation",
            status: "completed",
            startedAt: nestedStart + 1_000,
            completedAt: nestedStart + 4_000,
          },
        },
      }),
      // The renderer can receive a replayed Task snapshot for the same child
      // delegation while the parent stream is refreshed. It must remain one
      // topology card, not create a second identical child card.
      message("nested-child-replayed", "tool", "started", {
        toolName: "Task",
        toolCallId: "nested-child-replayed-call",
        parentToolCallId: "nested-root-call",
        toolStatus: "success",
        toolArgs: { agent: "implementer", task: "Inspect the nested path" },
        toolResult: {
          details: {
            delegationId: "nested-child-delegation",
            status: "completed",
            startedAt: nestedStart + 1_000,
            completedAt: nestedStart + 4_000,
          },
        },
      }),
      message("nested-level2-read", "tool", "runtime.ts", {
        toolName: "Read",
        toolCallId: "nested-level2-read-call",
        parentToolCallId: "nested-child-call",
        toolStatus: "success",
        agentName: "implementer",
      }),
      message("nested-level2-report", "assistant", "The nested path is valid.", {
        parentToolCallId: "nested-child-call",
        agentName: "implementer",
      }),
      message("nested-level1-report", "assistant", "The child check is complete.", {
        parentToolCallId: "nested-root-call",
        agentName: "architect",
      }),
      message("nested-final", "assistant", "Nested delegation verified."),
    ]);
    const nestedNodes = container.querySelectorAll(".subagent-topology-node");
    const nestedChildNode = container.querySelector(
      ".subagent-topology-children .subagent-topology-node",
    );
    const nestedChildNodes = container.querySelectorAll(
      ".subagent-topology-children > .subagent-topology-branch",
    );
    assert(
      nestedNodes.length === 2 && nestedChildNode && nestedChildNodes.length === 1,
      `nested topology did not render two connected nodes: ${nestedNodes.length}`,
    );
    assert(
      nestedChildNode.querySelector(".subagent-topology-node-title")?.textContent ===
        "implementer",
      "nested topology node did not keep the child agent identity",
    );
    nestedTopologyRendered = true;

    useAppStore.setState({
      activeSessionId: "nested-session",
      workPanelOpen: false,
      workPanelTabs: [],
      activeWorkPanelTabId: null,
      workPanelContexts: {},
    });
    const nestedHeader = nestedChildNode.querySelector<HTMLButtonElement>(
      ".subagent-topology-node-header",
    );
    assert(nestedHeader, "nested topology node header is missing");
    nestedHeader.click();
    const nestedPanelState = useAppStore.getState();
    assert(
      nestedPanelState.workPanelOpen &&
        nestedPanelState.activeWorkPanelTabId === "subagent:nested-child-delegation" &&
        nestedPanelState.workPanelTabs.some(
          (tab) =>
            tab.kind === "subagent" &&
            tab.resource === "nested-child-delegation",
        ),
      "nested topology node did not open its own subagent transcript tab",
    );
    nestedTopologyTabSelection = true;
  } catch (error) {
    failures.push(String(error));
  } finally {
    useAppStore.setState({
      workPanelOpen: false,
      workPanelTabs: [],
      activeWorkPanelTabId: null,
      workPanelContexts: {},
    });
    root.unmount();
    container.remove();
  }
  return {
    ok: failures.length === 0,
    nestedTopologyRendered,
    nestedTopologyTabSelection,
    failures,
  };
};

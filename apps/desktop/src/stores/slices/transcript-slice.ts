import i18n from "i18next";
import { isRemoteSession, sessionAllows } from "../../lib/remote-session-safety";
import type {
  UiMessage,
} from "@pi-desktop/shared";
import { isRenderableAttachment } from "@pi-desktop/shared";
import { api } from "../../lib/api";
import { resolveComposerSmartStop } from "../../lib/composer-smart-stop";
import {
  clearSessionPermissions,
  sessionPermissions,
} from "../../lib/pending-permissions";
import {
  mergeLiveSessionMessages,
} from "../../lib/session-transcript";
import { optimisticUserMessage } from "../../lib/session-transcript";
import { withReviewChangeState } from "../../lib/workspace-review";
import { settleStoppedAssistantMetrics } from "../../lib/context-usage";
import type { AppState } from "../app-state";
import type { SessionRuntime } from "../runtime/session-runtime";
import { prepareTranscriptAction } from "../runtime/transcript-action";
import { trimLiveTranscriptTail } from "../../lib/transcript-row-cap";
import type { StoreAccess } from "./types";

export type TranscriptSliceDependencies = StoreAccess & {
  runtime: SessionRuntime;
  promptAttachmentsFromMessage: (
    attachments: UiMessage["attachments"],
  ) => NonNullable<Parameters<typeof api.prompt>[0]["attachments"]>;
  viewingSessionIdForPrompt: (
    state: Pick<AppState, "page" | "activeSessionId">,
    sessionId: string,
  ) => string | null;
  flushPendingSessionConfiguration: (sessionId: string) => Promise<void>;
};

export function createTranscriptSlice({
  get,
  set,
  runtime,
  promptAttachmentsFromMessage,
  viewingSessionIdForPrompt,
  flushPendingSessionConfiguration,
}: TranscriptSliceDependencies): Pick<
  AppState,
  | "compactContext"
  | "retryAssistantMessage"
  | "editUserMessage"
  | "prepareUserMessageEdit"
  | "retryLastPrompt"
  | "clearError"
  | "activateMessageRevision"
  | "deleteMessage"
  | "releaseLiveTranscriptHead"
  | "rollbackWorkspaceChange"
  | "abort"
> {
  const canEdit = () => {
    const state = get();
    return sessionAllows(state.sessions.find((session) => session.id === state.activeSessionId)
      ?? { id: state.activeSessionId ?? "" }, "canEditMessages");
  };
  return {
    compactContext: async () => {
      const state = get();
      const sessionId = state.activeSessionId;
      if (!sessionId || state.isRunning) return;
      set((current) => ({
        isRunning: true,
        runningSessions: {
          ...current.runningSessions,
          [sessionId]: true,
        },
      }));
      try {
        await api.compact({ sessionId });
      } catch (error) {
        set((current) => ({
          isRunning:
            current.activeSessionId === sessionId ? false : current.isRunning,
          runningSessions: {
            ...current.runningSessions,
            [sessionId]: false,
          },
        }));
        if ((error as { code?: string })?.code !== "CONTEXT_COMPACTION_FAILED") {
          get().showToast(
            error instanceof Error
              ? error.message
              : i18n.t("contextCompaction.failed"),
            { variant: "error" },
          );
        }
      }
    },

    retryAssistantMessage: async (messageId) => {
      if (!canEdit()) return;
      const prepared = await prepareTranscriptAction({ get, set }, runtime, messageId);
      const state = get();
      if (!prepared || state.activeSessionId !== prepared.activeSessionId || state.isRunning) return;
      const index = state.messages.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      const target = state.messages[index];
      if (target.role !== "assistant") return;
      let userIndex = -1;
      for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = state.messages[i];
        if (
          candidate.role === "user" &&
          (candidate.content.trim() || candidate.attachments?.length)
        ) {
          userIndex = i;
          break;
        }
      }
      if (userIndex < 0) return;
      const rootId = state.messages[userIndex].id;
      // The window's copy of the root may be display-capped; the retry sends
      // the prompt text, so it has to be the canonical one.
      const rootPrepared = await prepareTranscriptAction({ get, set }, runtime, rootId);
      const root = rootPrepared?.messages.find((message) => message.id === rootId);
      if (!rootPrepared || !root || rootPrepared.activeSessionId !== state.activeSessionId) return;
      await get().editUserMessage(root.id, root.content, root.attachments);
    },

    prepareUserMessageEdit: async (messageId, signal) => {
      if (!canEdit()) return null;
      const prepared = await prepareTranscriptAction({ get, set }, runtime, messageId, signal);
      const state = get();
      if (!prepared || state.activeSessionId !== prepared.activeSessionId || state.isRunning) return null;
      const message = state.messages.find((candidate) => candidate.id === messageId);
      return message?.role === "user" && !message.sessionMessage ? message : null;
    },

    editUserMessage: async (messageId, content, attachments) => {
      if (!canEdit()) return false;
      const prepared = await prepareTranscriptAction({ get, set }, runtime, messageId);
      const state = get();
      if (!prepared || state.activeSessionId !== prepared.activeSessionId || state.isRunning) return false;
      const sessionId = state.activeSessionId;
      if (!sessionId) return false;
      if (state.pendingPlans[sessionId]?.status === "pending") return false;
      const prompt = content.trim();
      const userIndex = state.messages.findIndex(
        (message) => message.id === messageId,
      );
      if (userIndex < 0 || state.messages[userIndex].role !== "user") return false;
      if (
        !prompt &&
        !(attachments ?? state.messages[userIndex].attachments)?.length
      ) {
        return false;
      }
      const promptAttachments = promptAttachmentsFromMessage(
        attachments ?? state.messages[userIndex].attachments,
      );
      const kept = state.messages.slice(0, userIndex);
      const truncateFromMessageId = state.messages[userIndex].id;
      const optimisticMessage = optimisticUserMessage(
        crypto.randomUUID(),
        prompt,
        (attachments ?? state.messages[userIndex].attachments ?? [])
          // A session reference re-resolves from its link text on send; it is
          // not an optimistic file reference.
          .filter(isRenderableAttachment)
          .map((attachment) => ({
            path: attachment.ref,
            name: attachment.name,
            kind: attachment.kind,
            mimeType: attachment.mimeType,
          })),
      );

      set((current) => ({
        messages: [...kept, optimisticMessage],
        isRunning: true,
        error: null,
        errorCode: null,
        errorRetriable: null,
        runningSessions: { ...current.runningSessions, [sessionId]: true },
        latestTurnResults: withoutRecordKey(current.latestTurnResults, sessionId),
        sessionOutcomes: withoutRecordKey(current.sessionOutcomes, sessionId),
      }));

      try {
        await api.prompt({
          sessionId,
          content: prompt,
          messageId: optimisticMessage.id,
          viewingSessionId: viewingSessionIdForPrompt(get(), sessionId),
          attachments: promptAttachments,
          truncateFromMessageId,
        });
        return true;
      } catch (error) {
        try {
          const settled = await runtime.readSettledTail(sessionId);
          set((current) => ({
            messages:
              current.activeSessionId === sessionId
                ? settled?.messages ?? kept
                : current.messages,
            ...(settled && current.activeSessionId === sessionId
              ? { sessionHistory: { ...current.sessionHistory, [sessionId]: settled.window } }
              : {}),
            isRunning:
              current.activeSessionId === sessionId ? false : current.isRunning,
            runningSessions: { ...current.runningSessions, [sessionId]: false },
            latestTurnResults: {
              ...current.latestTurnResults,
              [sessionId]: {
                status: "failed",
                turnId: `${sessionId}:${Date.now()}`,
                finishedAt: Date.now(),
                errorCode: (error as { code?: string })?.code,
              },
            },
            sessionOutcomes: { ...current.sessionOutcomes, [sessionId]: "failed" },
            error: error instanceof Error ? error.message : String(error),
            errorCode: (error as { code?: string })?.code ?? null,
          }));
        } catch {
          set((current) => ({
            isRunning:
              current.activeSessionId === sessionId ? false : current.isRunning,
            runningSessions: { ...current.runningSessions, [sessionId]: false },
            latestTurnResults: {
              ...current.latestTurnResults,
              [sessionId]: {
                status: "failed",
                turnId: `${sessionId}:${Date.now()}`,
                finishedAt: Date.now(),
                errorCode: (error as { code?: string })?.code,
              },
            },
            sessionOutcomes: { ...current.sessionOutcomes, [sessionId]: "failed" },
            error: error instanceof Error ? error.message : String(error),
            errorCode: (error as { code?: string })?.code ?? null,
          }));
        }
        return false;
      }
    },

    retryLastPrompt: async () => {
      if (!canEdit()) return;
      const state = get();
      if (state.isRunning) return;
      const sessionId = state.activeSessionId;
      if (!sessionId) return;
      if (state.pendingPlans[sessionId]?.status === "pending") return;
      let userIndex = -1;
      for (let i = state.messages.length - 1; i >= 0; i -= 1) {
        const candidate = state.messages[i];
        if (
          candidate.role === "user" &&
          (candidate.content.trim() || candidate.attachments?.length)
        ) {
          userIndex = i;
          break;
        }
      }
      if (userIndex < 0) return;
      const prompt = state.messages[userIndex].content;
      const promptAttachments = promptAttachmentsFromMessage(
        state.messages[userIndex].attachments,
      );
      const kept = state.messages.slice(0, userIndex);
      const truncateFromMessageId = state.messages[userIndex].id;
      set((current) => ({
        messages: kept,
        isRunning: true,
        error: null,
        errorCode: null,
        errorRetriable: null,
        runningSessions: { ...current.runningSessions, [sessionId]: true },
        latestTurnResults: withoutRecordKey(current.latestTurnResults, sessionId),
        sessionOutcomes: withoutRecordKey(current.sessionOutcomes, sessionId),
      }));
      try {
        await api.prompt({
          sessionId,
          content: prompt,
          viewingSessionId: viewingSessionIdForPrompt(get(), sessionId),
          attachments: promptAttachments,
          truncateFromMessageId,
        });
      } catch (error) {
        set((current) => ({
          isRunning:
            current.activeSessionId === sessionId ? false : current.isRunning,
          runningSessions: { ...current.runningSessions, [sessionId]: false },
          latestTurnResults: {
            ...current.latestTurnResults,
            [sessionId]: {
              status: "failed",
              turnId: `${sessionId}:${Date.now()}`,
              finishedAt: Date.now(),
              errorCode: (error as { code?: string })?.code,
            },
          },
          sessionOutcomes: { ...current.sessionOutcomes, [sessionId]: "failed" },
          error: error instanceof Error ? error.message : String(error),
          errorCode: (error as { code?: string })?.code ?? null,
          errorRetriable: false,
        }));
      }
    },

    clearError: () => set({ error: null, errorCode: null, errorRetriable: null }),

    activateMessageRevision: async (rootUserId, revisionIndex) => {
      if (!canEdit()) return;
      const state = get();
      if (state.isRunning) return;
      const sessionId = state.activeSessionId;
      if (!sessionId) return;
      const root = state.messages.find((message) => message.id === rootUserId);
      if (!root) return;
      const revisionFamilyId = root.revisionRootId || root.id;
      try {
        // The host reads the prefix from the durable transcript and rewrites it
        // there; the renderer names the family and then re-reads the newest
        // page, so neither the prefix nor the rewritten transcript crosses IPC.
        await api.activateSessionRevision({
          sessionId,
          rootUserId: revisionFamilyId,
          revisionIndex,
        });
        if (get().activeSessionId !== sessionId) return;
        const settled = await runtime.readSettledTail(sessionId);
        set((current) => ({
          ...(settled && current.activeSessionId === sessionId
            ? {
                messages: settled.messages,
                sessionHistory: { ...current.sessionHistory, [sessionId]: settled.window },
              }
            : {}),
          error: null,
          errorCode: null,
        }));
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : String(error),
          errorCode: (error as { code?: string })?.code ?? null,
        });
      }
    },

    deleteMessage: async (messageId) => {
      if (!canEdit()) return;
      const state = get();
      const sessionId = state.activeSessionId;
      if (!sessionId || state.isRunning) return;
      const previous = state.messages;
      const index = previous.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      // Optimistic view: the same turn rule the host applies, on the window the
      // user is looking at. A user row takes its turn, any other row goes alone.
      let end = index + 1;
      if (previous[index].role === "user") {
        while (end < previous.length && previous[end].role !== "user") end += 1;
      }
      const window = state.sessionHistory[sessionId];
      const optimistic = [...previous.slice(0, index), ...previous.slice(end)];
      runtime.cacheSessionTranscript(sessionId, optimistic, window);
      set((current) =>
        current.activeSessionId === sessionId
          ? { messages: optimistic, error: null, errorCode: null }
          : { error: null, errorCode: null },
      );
      try {
        // The host finds the row in the durable transcript, applies the turn
        // rule there and rewrites the transcript itself. The renderer only names
        // the row: a paged, display-capped window must never become the next
        // transcript, and rows that land during this await (a late tool_end)
        // are drained into the host before it cuts, instead of being merged
        // from a renderer snapshot (#1614).
        const { deletedIds } = await api.deleteSessionMessage(sessionId, messageId);
        const removed = new Set(deletedIds);
        const current = get();
        if (current.activeSessionId !== sessionId) return;
        // Reconcile with what the host actually removed: a row the window did
        // not show is dropped, a row the host kept comes back.
        const messages = mergeLiveSessionMessages(previous, current.messages).filter(
          (message) => !removed.has(message.id),
        );
        runtime.cacheSessionTranscript(sessionId, messages, current.sessionHistory[sessionId]);
        set({ messages });
      } catch (error) {
        runtime.cacheSessionTranscript(sessionId, previous, window);
        set((current) => ({
          messages:
            current.activeSessionId === sessionId ? previous : current.messages,
          error: error instanceof Error ? error.message : String(error),
          errorCode: (error as { code?: string })?.code ?? null,
        }));
      }
    },

    releaseLiveTranscriptHead: (sessionId) => {
      const state = get();
      if (state.activeSessionId !== sessionId) return;
      // The transcript keeps every row; only the renderer's copy is bounded.
      // The window moves forward by the released count, so the rows come back
      // through the ordinary older-page fetch.
      const trimmed = trimLiveTranscriptTail(state.messages, undefined, state.sessionHistory[sessionId]);
      if (!trimmed) return;
      runtime.cacheSessionTranscript(sessionId, trimmed.messages, trimmed.window);
      set((current) =>
        current.activeSessionId === sessionId && current.messages === state.messages
          ? {
              messages: trimmed.messages,
              sessionHistory: { ...current.sessionHistory, [sessionId]: trimmed.window },
            }
          : {},
      );
    },

    rollbackWorkspaceChange: async (messageId, snapshotId) => {
      if (!canEdit()) return null;
      const state = get();
      const sessionId = state.activeSessionId;
      if (!sessionId || state.isRunning) return null;
      try {
        const result = await api.workspaceReviewRollback({ sessionId, snapshotId });
        if (result.status === "rolledBack" || result.status === "alreadyRolledBack") {
          set((current) =>
            current.activeSessionId === sessionId
              ? {
                  messages: current.messages.map((message) =>
                    message.id === messageId
                      ? withReviewChangeState(message, "rolledBack")
                      : message,
                  ),
                }
              : {},
          );
        } else if (result.status === "conflict") {
          get().showToast(i18n.t("panel.review.rollbackConflict"), {
            variant: "warning",
          });
        } else if (result.status === "unavailable") {
          get().showToast(i18n.t("panel.review.rollbackUnavailable"), {
            variant: "warning",
          });
        }
        return result;
      } catch (error) {
        get().showToast(i18n.t("panel.review.rollbackError"), {
          variant: "error",
        });
        set({
          error: error instanceof Error ? error.message : String(error),
          errorCode: (error as { code?: string })?.code ?? null,
        });
        return null;
      }
    },

    abort: async () => {
      const stateBeforeAbort = get();
      const sessionId = stateBeforeAbort.activeSessionId;
      if (!sessionId) return;
      const target = stateBeforeAbort.sessions.find((session) => session.id === sessionId);
      if (!sessionAllows(target, "canStop")) return;
      if (target?.source === "pi-native" || isRemoteSession(target)) {
        await api.abort(sessionId);
        runtime.submittedComposerDrafts.delete(sessionId);
        // Bypass in-flight pre-abort detail reads; request settled source state.
        const settled = await runtime.readSettledTail(sessionId);
        const messages = settled?.messages;
        set((current) => ({
          runningSessions: { ...current.runningSessions, [sessionId]: false },
          ...(messages ? { retainedTranscripts: { ...current.retainedTranscripts, [sessionId]: messages } } : {}),
          ...(settled ? { sessionHistory: { ...current.sessionHistory, [sessionId]: settled.window } } : {}),
          ...(current.activeSessionId === sessionId ? { isRunning: false, ...(messages ? { messages } : {}) } : {}),
        }));
        return;
      }
      const submittedDraft = runtime.submittedComposerDrafts.get(sessionId);
      const preserveSteering = stateBeforeAbort.messages
        .slice(submittedDraft?.messageCountBeforeSend ?? 0)
        .findLast((message) => message.role === "user")?.steering;
      const stoppedAtMs = Date.now();
      if (submittedDraft && !submittedDraft.abortResolution) {
        submittedDraft.abortResolution = new Promise<boolean>((resolve) => {
          submittedDraft.resolveAbort = resolve;
        });
      }
      const pendingForSession = sessionPermissions(
        stateBeforeAbort.pendingPermissions,
        sessionId,
      );
      await Promise.allSettled([
        api.abort(sessionId),
        ...pendingForSession.map((permission) =>
          api.resolvePermission({
            requestId: permission.requestId,
            decision: "deny",
          }),
        ),
      ]);
      set((current) => ({
        pendingPermissions: clearSessionPermissions(
          current.pendingPermissions,
          sessionId,
        ),
      }));
      const state = get();
      if (state.activeSessionId !== sessionId) {
        submittedDraft?.resolveAbort?.(false);
        runtime.submittedComposerDrafts.delete(sessionId);
        set((current) => ({
          runningSessions: { ...current.runningSessions, [sessionId]: false },
        }));
        return;
      }
      const smartStop = preserveSteering
        ? { kind: "settle" as const }
        : resolveComposerSmartStop(state.messages, submittedDraft);
      if (smartStop.kind === "restore") {
        // The unanswered prompt is the first row the undo removes; it is the
        // live window's own row (the composer just inserted it), so the window
        // is enough to name it. The host deletes that user row with the turn
        // behind it from the durable transcript — no renderer array crosses
        // IPC, and no whole-transcript read is needed to undo one prompt.
        const undone = state.messages[smartStop.kept.length];
        runtime.submittedComposerDrafts.delete(sessionId);
        submittedDraft?.resolveAbort?.(true);
        runtime.cacheSessionTranscript(sessionId, smartStop.kept, state.sessionHistory[sessionId]);
        set((current) => ({
          messages: smartStop.kept,
          composerPrefill: { ...smartStop.draft, sessionId },
          isRunning: false,
          runningSessions: { ...current.runningSessions, [sessionId]: false },
        }));
        if (undone) {
          try {
            await api.deleteSessionMessage(sessionId, undone.id);
          } catch {
            // Best effort — the local transcript already reflects the undo.
          }
        }
        void flushPendingSessionConfiguration(sessionId);
        return;
      }
      submittedDraft?.resolveAbort?.(false);
      runtime.submittedComposerDrafts.delete(sessionId);
      const stoppedRows = (rows: UiMessage[]) =>
        rows.map((message) => {
          if (message.role === "assistant" && message.status === "streaming") {
            return {
              ...settleStoppedAssistantMetrics(message, stoppedAtMs),
              status: "aborted" as const,
            };
          }
          if (message.role === "tool" && message.toolStatus === "running") {
            return {
              ...message,
              toolStatus: "error" as const,
              status: "aborted" as const,
              toolCompletedAt:
                message.toolCompletedAt ?? new Date().toISOString(),
            };
          }
          return message;
        });
      set((current) => ({
        messages:
          current.activeSessionId === sessionId
            ? stoppedRows(current.messages)
            : current.messages,
        isRunning: false,
        runningSessions: { ...current.runningSessions, [sessionId]: false },
      }));
      void flushPendingSessionConfiguration(sessionId);
    },
  };
}

function withoutRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

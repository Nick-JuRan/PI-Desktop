/**
 * Voice IPC handler registration.
 * Follows the same pattern as speech-ipc.ts and other IPC modules.
 */

import { join } from "node:path";
import { app, type BrowserWindow } from "electron";
import { IPC } from "@pi-desktop/shared";
import type { IpcRegistrar } from "./types";
import { VoiceService } from "../voice-service";

export function registerVoiceIpc({
  registrar,
  dataDir,
  getMainWindow,
}: {
  registrar: IpcRegistrar;
  dataDir: string;
  getMainWindow: () => BrowserWindow | null;
}): void {
  const voiceService = new VoiceService(
    join(dataDir, "voice-models"),
    getMainWindow,
  );
  app.once("before-quit", () => voiceService.dispose());

  const { handle } = registrar;

  handle(IPC.invoke.voiceStart, (settings: unknown) =>
    voiceService.start(settings as any),
  );

  handle(IPC.invoke.voiceStop, () => voiceService.stop());

  handle(IPC.invoke.voiceCancel, async () => {
    voiceService.cancel();
    return { ok: true };
  });

  handle(IPC.invoke.voiceGetState, async () => voiceService.getState());

  handle(IPC.invoke.voiceGetDevices, async () => voiceService.getDevices());

  handle(IPC.invoke.voiceGetModels, async () => voiceService.getModels());

  handle(IPC.invoke.voiceDownloadModel, (input: unknown) => {
    const { modelId } = input as { modelId: string };
    return voiceService.downloadModel(modelId);
  });

  handle(IPC.invoke.voiceDeleteModel, (input: unknown) => {
    const { modelId } = input as { modelId: string };
    return voiceService.deleteModel(modelId);
  });

  handle(IPC.invoke.voiceUpdateSettings, async (input: unknown) =>
    voiceService.updateSettings(input as any),
  );

  handle(IPC.invoke.voiceCheckPermission, () =>
    voiceService.checkPermission(),
  );

  handle(IPC.invoke.voiceRequestPermission, () =>
    voiceService.requestPermission(),
  );
}

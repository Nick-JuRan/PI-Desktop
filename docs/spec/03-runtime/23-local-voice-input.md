# 23. Local voice input

> Source of truth: `packages/shared/src/types/settings.ts`,
> `packages/shared/src/protocol.ts`, `packages/voice-runtime`, and the Electron
> `VoiceService` / voice IPC modules.

## 1. Scope and separation

Local voice input provides optional microphone-to-text dictation. It is not the
provider-backed `AppSettings.speech` capability in
[`20-speech.md`](20-speech.md): it adds no speech-provider picker, TTS action,
or provider credential, and does not change the `speech/*` contract. ADR 0307
narrows ADR 0291 to that provider-backed capability.

## 2. Settings

`AppSettings.voice` is optional. When absent, the UI treats voice input as
disabled, uses the system-default microphone, and does not select a model.
When present it contains:

- `enabled`: whether Composer voice input is available;
- `deviceId`: a selected microphone ID, or `null` for the system default;
- `languages`: recognition language codes;
- `chineseVariant`: simplified Chinese, Traditional Chinese (Taiwan), or
  Traditional Chinese (Hong Kong) output conversion;
- `modelId`: the local recognition model ID, or an empty string when unset.

Settings updates use the existing host settings write path. The optional field
does not require a database-schema migration; older settings behave as disabled.

## 3. Capture and recognition boundary

Electron main owns microphone capture and the `VoiceService`. The service uses
`packages/voice-runtime` for PCM conversion, streaming/batch transcription,
language handling, and model lifecycle. Recognition runs locally. Captured PCM
is held in the main-process voice pipeline and is not persisted or sent to a
provider. The renderer receives voice state, progress, and the completed text,
not microphone audio.

Recognition models are downloaded on explicit user action from the model
catalog and cached under the active app data directory's `voice-models`
subdirectory. Model download traffic is separate from transcription; no model
is downloaded implicitly by starting a recording.

## 4. IPC and lifecycle

The `pi-desktop/voice/*` IPC family covers start, stop, cancel, state/device/
model reads, model download/delete, settings updates, and microphone permission
check/request. `pi-desktop/voice/event/stateChanged` carries lifecycle/result
state; `pi-desktop/voice/event/modelProgress` reports model downloads. The
main-process service is disposed on app quit. The renderer subscribes only
while voice is enabled and unsubscribes on dispose.

## 5. User path

The Voice settings panel enables the feature and configures microphone,
language, Chinese output variant, and local model. It offers explicit download
and delete actions with progress/status. The Composer microphone action appears
only while enabled. Starting capture shows recording state; stopping runs
transcription and inserts the text into the existing Composer draft (or creates
the draft when empty). It never sends the message automatically. Cancel stops
the active capture without inserting a result. This flow is separate from
text-to-speech and provider-backed speech settings (ADR 0307).

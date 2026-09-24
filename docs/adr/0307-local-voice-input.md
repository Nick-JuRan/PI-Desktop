# ADR 0307: Local voice input is distinct from provider-backed speech

- Status: Accepted
- Date: 2026-09-24
- Deciders: PI-Desktop core
- Amends: ADR 0291 (scope of the removed speech settings UI)
- Related: [03-runtime/23-local-voice-input.md](../spec/03-runtime/23-local-voice-input.md),
  [04-ux/06-settings-ia.md](../spec/04-ux/06-settings-ia.md),
  [04-ux/08-component-spec.md](../spec/04-ux/08-component-spec.md)

## Context

ADR 0291 removed the provider-backed speech settings card and Composer speech
controls. The local voice-input feature adds a separate `AppSettings.voice`
object, an on-device recognition runtime, and an optional Composer microphone
action. Without a scope distinction, its Settings panel and microphone action
would contradict ADR 0291's broader wording even though they do not restore its
provider picker or text-to-speech behavior.

## Decision

1. **Ship local microphone-to-text input.** `AppSettings.voice` configures the
   microphone, recognition languages, Chinese output variant, and local model.
   Missing settings mean disabled voice input; adding the optional settings
   object does not require a storage-schema migration.
2. **Keep captured audio in Electron main.** Electron main owns microphone
   capture and passes PCM to `packages/voice-runtime` for local recognition.
   The renderer receives state and completed transcript text, never audio
   frames. Model downloads happen only on explicit user action and are stored
   under the active app data directory's `voice-models` directory.
3. **Insert, do not submit.** A completed transcript is inserted into the
   Composer draft and is never sent automatically. Cancel ends capture without
   inserting a result.
4. **Keep ADR 0291's provider-speech decision.** `AppSettings.speech`,
   `speech/*` IPC, provider selection, and TTS remain outside Settings and the
   Composer. This ADR supersedes ADR 0291 only for the separate local
   microphone-to-text surface.

## Consequences

- Settings can enable voice input and manage local microphone/model choices;
  Composer exposes the microphone action only while voice input is enabled.
- App data may contain explicitly downloaded recognition models. Captured audio
  is transient and does not enter the renderer or the provider network.
- Desktop microphone acceptance requires host microphone permission and an
  installed model; runtime behavior remains covered by local voice-runtime
  tests, with the user path documented in the E2E plan.

## Alternatives considered

### Keep all voice input out of the application shell

Rejected for this integration: it would discard the upstream local dictation
feature and keep the user without the requested merged capability.

### Restore provider-backed speech settings and TTS controls

Rejected: the local runtime needs no chat-provider binding, and provider/TTS
settings remain governed by ADR 0291.

### Submit the message automatically after transcription

Rejected: transcription must not turn a microphone stop action into a message
send; the user reviews and submits the draft explicitly.

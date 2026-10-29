# Voice Folder Guide

Purpose

- Voice-assist UI and recognition hook for the heat page: listen for spoken
  bib numbers/commands, show a live audio-level indicator and a detected/action
  log, with a mic-permission modal.

Read Order

1. ../../../../AGENT.md
2. ../AGENT.md
3. useVoiceRecognition.ts (Web Speech API wrapper)
4. RiderActionLog.tsx, DetectedNumbers.tsx, VoiceIndicator.tsx, MicPermissionModal.tsx

Immediate Children Summary

- No child folders.
- Top-level files:
  - useVoiceRecognition.ts (wraps the browser's SpeechRecognition; takes
    language, validBibs, commands, onBibDetected/onCommand callbacks)
  - RiderActionLog.tsx + riderActionLog.module.css (largest file — the visible
    action/history log for voice-driven and manual actions on the heat page)
  - DetectedNumbers.tsx + detectedNumbers.module.css (shows numbers parsed from
    speech before confirmation)
  - VoiceIndicator.tsx + voiceIndicator.module.css,
    VoiceRadarIcon.tsx + voiceRadarIcon.module.css (listening/audio-level UI)
  - MicPermissionModal.tsx + micPermissionModal.module.css (mic-permission
    request/denied flow)

Conventions

- Real speech-to-bib recognition has no browser-API mock available for tests —
  Playwright coverage of this folder is explicitly out of scope (see the
  session's Part 3 test plan); don't expect `useVoiceRecognition` to be
  exercised by `npm test`.
- Number extraction from a transcript goes through `utils/numberParser.ts` —
  keep parsing logic there, not duplicated inline here.
- Voice actions ultimately call the same `recordLap`/status-update paths as a
  manual tap — don't fork a separate rider-mutation path for voice.

When To Update

- Speech recognition language/command set changes
- Voice-to-lap-recording wiring changes
- Mic-permission UX changes

Recognition rules (useVoiceRecognition.ts)

- Walk EVERY changed result from `event.resultIndex` — several bibs called fast
  can finalize in one event; reading only the last result dropped them.
- `maxAlternatives` = 5 and `pickBibsFromAlternatives` (numberParser.ts) choose
  the guess whose numbers are real bibs. The bib list is the strongest signal we
  have — keep using it.
- Restart immediately in `onend` (Chrome ends sessions after silence / ~60s).
- Never clear `enabledRef` in the effect cleanup — on a language change that ran
  after the render that synced it and left the new session unable to restart.
  The per-session `disposed` flag is what stops a dead session.
- Experimental browser features, always feature-detected with fallback:
  `recognition.phrases` (bib list as contextual biasing) and `processLocally`
  (on-device, offline) — used only when `SpeechRecognition.available()` says the
  model is already installed; we never trigger a download mid-race. The mode is
  shown in the Live mic button's tooltip while voice is on.
- Tests: `__tests__/useVoiceRecognition.test.ts` uses a fake SpeechRecognition.

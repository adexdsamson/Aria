# Plan 16-04b Summary — Renderer wiring (VoiceHUDBand transport + BriefingScreen read-aloud)

**Status:** Code-complete; human-verify smoke test (Task 3) DEFERRED to documented debt (user decision 2026-06-07 — proceed automated).
**Plan:** 16-04b · **Wave:** 2 · **Requirements:** VOICE-02, VOICE-03, VOICE-06

## Commits
- `df00616` feat(16-04b): VoiceHUDBand transport controls + VOICE_TTS_CHUNK subscription + latency marks
- `597c47f` feat(16-04b): BriefingScreen read-aloud section walker via useReadAloudQueue (D-07/D-10)
- `310a304` docs(16-04b): pause at checkpoint:human-verify — Tasks 1-2 complete

## What was built

**Task 1 — VoiceHUDBand (`src/renderer/features/voice/VoiceHUDBand.tsx`):**
- New props `player?: KokoroPlayerHandle`, `mode?: 'briefing'|'ask'`, `onSkipSection?`.
- Transport sub-row (visible when `voiceState==='speaking'` + player present): Pause/Resume → `session.pause()`+`player.suspend()` / `session.resume()`+`player.resume()` (D-09); Skip (briefing mode) → `onSkipSection` (D-10); Speed slider 0.5–2.0 step 0.25, IBM Plex Mono label (D-08).
- `VOICE_TTS_CHUNK` subscription → `queue.enqueue(chunk.text)` (D-05); fires `voiceLatencyMark('kokoro_synth_start')` on first chunk per episode (ref-guarded).
- `voiceLatencyMark('first_audio_out')` on transition to `'speaking'` (ref-guarded) — populates SC2's renderer-side telemetry columns.
- Barge-in cleanup: on leaving `'speaking'`, resume-if-paused (AudioContext must run) then `queue.cancel()`; reset mark refs + sessionId.
- No-op player fallback ref avoids conditional-hook violation when `player` absent.

**Task 2 — BriefingScreen (`src/renderer/features/briefing/BriefingScreen.tsx`):**
- `currentSectionIndex` state (-1 = idle); `buildSectionText(key, items)` → plain TTS string (top-3 items, title+why, section intro; no HTML/markdown, **no LLM streaming** — Pitfall 4 guard verified 0 matches for generateObject|streamText|runBriefing).
- `sectionTexts` memo over `['calendar','email','news']` (D-10); section walker enqueues current section; `handleSkipSection` cancels + advances (resets at end).
- Stop-on-playback-end resets index. VoiceHUDBand rendered above masthead (`mode="briefing"`, `onSkipSection`). "Read Aloud"/"Stop" masthead buttons.

## Verification
- Typecheck: 84 errors (baseline unchanged, 0 new).
- Behavioral logic proven by 16-03 renderer specs (useReadAloudQueue.spec / useVoiceSession.spec, 22/22 green).
- Pitfall-4 guard (no LLM streaming in briefing read-aloud): grep = 0.

## DEFERRED — human-verify (Task 3, SC1–SC5 smoke test)
Requires `pnpm dev` + human listening; cannot be automated. 5 tests (see 16-04b-PLAN.md / checkpoint report):
1. SC2 — /ask streams first sentence before full answer (~<1s first audio); voice_latency_log 4 cols under ARIA_DEBUG=1.
2. SC3 — PTT during speech stops <1s, new turn, no leftover audio.
3. SC4 — "Who is Elon Musk?" → "What company did he found?" resolves "he".
4. SC1 — /briefing Read Aloud walks calendar→email→news; pause/resume/skip/1.5×.
5. SC5 — no PTT during speech → no interruption (PTT-only by construction).

Resume signal: run the 5 tests, report results. This is the only open item for 16-04b.

## Decisions
- D-05/D-07 shared `useReadAloudQueue` feeds both /ask (VOICE_TTS_CHUNK) and briefing (section walker).
- D-08 speed via slider→`player.speak(text,{speed})`→Kokoro `generate({speed})` (pitch-neutral re-synth).
- D-09 pause = `session.pause()`+`player.suspend()` (state flag + AudioContext gate).
- D-10 skip-section = `currentSectionIndex` over BriefingPayload keys.
- SC2 renderer telemetry: `voiceLatencyMark` for kokoro_synth_start + first_audio_out.

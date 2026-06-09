---
phase: 260609-lq3
verified: 2026-06-09T00:00:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "PTT live smoke: press-hold PTT button → speak → release → confirm transcript appears"
    expected: "Voice state transitions idle→listening→processing→speaking→idle; transcript populates; no 'Transcribing...' hang"
    why_human: "Live acoustic round-trip (mic → PCM → IPC → Whisper/cloud STT → transcript) requires a real microphone and running Ollama/cloud STT — cannot verify programmatically"
---

# Quick Task 260609-lq3: Wire Mic-Capture → STT-Feed Verification

**Task Goal:** Wire the renderer mic-capture → STT-feed path (missing Plan 15-05 wiring): on a PTT turn start mic capture, buffer PCM, and on turn-end flush the utterance to window.aria.voiceFeedAudio so the STT handler receives audio. Fix the orphan: useVoiceCapture MUST be mounted in App.tsx.

**Verified:** 2026-06-09
**Status:** human_needed (all code-path truths VERIFIED; one live-acoustic smoke remains)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | On PTT turn-start (voiceState→'listening'), mic capture starts and PCM frames accumulate | VERIFIED | useEffect in useVoiceCapture.ts lines 75-104: `prev !== 'listening' && curr === 'listening'` branch calls `createCapture`, sets `captureRef.current`, calls `handle.start()`. Spec case (a) + (b) confirm start and frame accumulation. |
| 2 | On PTT turn-end (voiceState→'processing'), capture stops, frames are concatenated into one ArrayBuffer and voiceFeedAudio is called exactly once | VERIFIED | Lines 106-138: `prev === 'listening' && curr === 'processing'` branch calls `handle.stop()`, concatenates via `Uint8Array` copy loop, calls `feedAudioRef.current(out.buffer)` exactly once. Spec case (c) asserts `feedAudio` called once with bytes [1,2,3,4]. |
| 3 | Zero-PCM turns (no frames captured) do NOT call voiceFeedAudio | VERIFIED | Lines 119-122: `if (totalBytes === 0) { sessionRef.current.endTurn(); return; }` — returns before feedAudio call. Spec case (d) asserts `feedAudio` not called, `endTurn` called. |
| 4 | bargeIn (voiceState→'idle' from 'speaking') stops capture and discards buffered PCM without calling voiceFeedAudio | VERIFIED | Lines 140-145: `curr === 'idle' && captureRef.current !== null` branch calls `handle.stop()`, nulls captureRef, clears framesRef. No feedAudio call. No endTurn call (session transitions externally). Spec case (e) asserts `stop` called, `feedAudio` not called, `endTurn` not called. |
| 5 | onError stops capture, discards buffer, surfaces a toast, and returns session to idle | VERIFIED | Lines 83-100: onError closure calls `captureRef.current?.stop()`, nulls captureRef, clears framesRef, dispatches `new CustomEvent('aria:toast', { detail: { kind: 'error', message: err.message } })` guarded by `typeof window.dispatchEvent === 'function'`, then calls `sessionRef.current.endTurn()`. Spec case (f) asserts all four assertions. |
| 6 | useVoiceCapture is mounted in VoiceHUDBandConnected in App.tsx — it is reachable via grep (not orphaned) | VERIFIED | `grep -c useVoiceCapture src/renderer/app/App.tsx` returns 2. Line 18: `import { useVoiceCapture } from '../features/voice/useVoiceCapture'`. Line 251: `useVoiceCapture(session);` inside VoiceHUDBandConnected. Component is unconditionally rendered at App.tsx line 111 inside the unlocked gate. |

**Score:** 6/6 truths verified (code path)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/renderer/features/voice/useVoiceCapture.ts` | React hook driving createMicCapture lifecycle + PCM flush | VERIFIED | 149 lines, exports `useVoiceCapture` and `VoiceCaptureOpts`. Implements all 5 lifecycle branches (start, flush, zero-PCM, bargeIn, onError). Injectable `createCapture` and `feedAudio` opts for testability. |
| `src/renderer/features/voice/useVoiceCapture.spec.ts` | 6-case unit test suite (min 80 lines) | VERIFIED | 269 lines. Covers all 6 spec cases (a)–(f): start, accumulate, flush+concat, zero-PCM, bargeIn, onError+toast. Uses `renderHook` + `rerender` idiom with injected mock capture and feedAudio. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/renderer/app/App.tsx` | `src/renderer/features/voice/useVoiceCapture.ts` | `useVoiceCapture(session)` inside VoiceHUDBandConnected | WIRED | `grep -c useVoiceCapture App.tsx` = 2 (import line 18 + call site line 251). VoiceHUDBandConnected rendered unconditionally at App.tsx line 111. |
| `src/renderer/features/voice/useVoiceCapture.ts` | `window.aria.voiceFeedAudio` | injected `feedAudio` fn called with concatenated PCM ArrayBuffer on processing state | WIRED | Lines 53-58: default feedAudio resolves `window?.aria?.voiceFeedAudio?.(buf)`. Lines 133-135: `await feedAudioRef.current(out.buffer)` called in try block. IPC contract `AriaApi.voiceFeedAudio(audioBuffer: ArrayBuffer)` defined in `src/shared/ipc-contract.ts`. |

---

### Data-Flow Trace (Level 4)

| Stage | Source | Destination | Produces Real Data | Status |
|-------|--------|-------------|-------------------|--------|
| Mic PCM → captureRef | `createMicCapture` (real getUserMedia in production) | `framesRef.current.push(buf)` via onPcmFrame callback | Yes — real AudioWorklet PCM in production, injected mock in tests | FLOWING |
| Frame concat → IPC | `framesRef` accumulated buffers | `feedAudioRef.current(out.buffer)` → `window.aria.voiceFeedAudio` | Yes — Uint8Array byte-accurate concat, non-zero guard enforced | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| grep anti-orphan gate | `grep -c "useVoiceCapture" src/renderer/app/App.tsx` | 2 | PASS |
| Hook file exports useVoiceCapture | file exists at expected path, exports function | Confirmed via Read | PASS |
| Spec file meets min_lines=80 | 269 lines | 269 ≥ 80 | PASS |
| All 6 spec cases present (a)–(f) | `it('(a)'…'(f)')` | All 6 `it()` blocks confirmed in file | PASS |
| bargeIn branch: endTurn NOT called | grep endTurn in bargeIn branch (lines 140-145) | Not present in bargeIn block | PASS |
| T-lq3-03: finally-equivalent path | try/finally wraps feedAudio call | lines 133-137: `try { await feedAudioRef.current } finally { sessionRef.current.endTurn() }` | PASS |

*Live spec execution results were confirmed by the orchestrator prior to this verification (useVoiceCapture 6/6 alone, --no-file-parallelism).*

---

### Probe Execution

No probe scripts defined for this quick task. Step 7c: SKIPPED (no declared probes).

---

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|---------|
| VOICE-FEED-SEND | Renderer buffers PCM frames per PTT turn and flushes a single concatenated ArrayBuffer to voiceFeedAudio on turn-end | SATISFIED | useVoiceCapture.ts implements full lifecycle; wired in App.tsx VoiceHUDBandConnected; 6/6 spec cases pass |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | — | — | — |

Scanned `useVoiceCapture.ts` and `App.tsx` (the two files modified by this task):
- No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers in hook or wiring code
- No `return null` / `return []` / `return {}` stubs
- No hardcoded empty prop values at VoiceHUDBandConnected call sites
- `// eslint-disable-line react-hooks/exhaustive-deps` at line 147 is intentional and documented (the effect is keyed only on voiceState; session actions are accessed via `sessionRef.current` to avoid re-triggering on action identity changes)

---

### Human Verification Required

#### 1. Live PTT Acoustic Round-Trip

**Test:** With Ollama running (or cloud STT configured), press and hold the PTT button, speak a phrase (e.g. "Summarize my day"), release. Observe transcript panel.

**Expected:** VoiceHUDBand transitions idle → listening (band appears) → processing ("Transcribing...") → speaking (TTS plays response) → idle. The `Transcribing...` state resolves within STT latency — it does NOT hang indefinitely.

**Why human:** The pre-fix failure mode was "Transcribing... hangs forever" because createMicCapture had zero call sites and voiceFeedAudio was never called. The code path is now complete and wired, but confirming the STT handler actually receives audio and produces a transcript requires a real microphone + running STT backend. Cannot verify programmatically.

---

### Gaps Summary

No code-path gaps found. All 6 must-have truths are VERIFIED against the actual codebase:

1. The hook (`useVoiceCapture.ts`) exists, is substantive (149 lines, 5 lifecycle branches), and implements every required behavior.
2. The hook is wired at exactly the right mount point (`VoiceHUDBandConnected` in `App.tsx`) — the anti-orphan key link passes the grep=2 gate.
3. The `voiceFeedAudio` call is wired via the injected feedAudio ref with a try/finally endTurn guarantee.
4. The spec is present, non-trivial (269 lines), and covers all 6 required cases.

The only remaining step is the live acoustic smoke test (human verification item above) to confirm the now-complete code path produces an actual transcript end-to-end.

---

_Verified: 2026-06-09_
_Verifier: Claude (gsd-verifier)_

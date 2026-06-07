---
phase: 16
slug: streaming-cascade-barge-in-read-only
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-04
revised: 2026-06-07
revision_reason: "BLOCKER 2 fix (voice-session-manager.spec.ts scaffold added to 16-01 T3), BLOCKER 3 fix (16-04a T1 verifies via spec not typecheck), WARNING 1 fix (16-04 split into 16-04a + 16-04b), WARNING 2 fix (VOICE_LATENCY_MARK channel + renderer emissions), WARNING 3 fix (suspend/resume on KokoroPlayerHandle in 16-03)"
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Read-only phase (VOICE-02/03/06). Derived from 16-RESEARCH.md §Validation Architecture.
> Revised 2026-06-07: plan-checker blockers + warnings addressed.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (main + renderer projects) |
| **Config file** | `vitest.config.ts` / electron-vite test projects |
| **Quick run command** | `npx vitest run <spec> --no-file-parallelism` (targeted; the parallel-projects race throws "config undefined" across 4+ specs) |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | quick ~2–5s per spec; full ~minutes |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted spec(s) with `--no-file-parallelism`
- **After every plan wave:** Run the wave's specs; run `pnpm typecheck` after any main/preload edits (esbuild does NOT typecheck — 84-error baseline, expect 0 new)
- **Before `/gsd-verify-work`:** Targeted voice specs green; handler-count invariant (`tests/unit/main/ipc/index.spec.ts`) updated to use Object.keys(CHANNELS).length (dynamic) and green
- **Max feedback latency:** ~5s (targeted)

---

## Per-Task Verification Map

> Plan and task IDs are finalized. Each behavior-adding task has an `<automated>` verify.

| Plan | Task | SC | Requirement | Automated Verify | Evidence |
|------|------|----|-------------|-----------------|----------|
| 16-01 | T1 | — | VOICE-02/03/06 | pnpm typecheck | 5 new CHANNELS + preload override |
| 16-01 | T2 | — | VOICE-02/03/06 | npx vitest run tests/unit/main/ipc/index.spec.ts | handler-count invariant green (dynamic Object.keys assertion) |
| 16-01 | T3 | SC3/SC4/SC5 | VOICE-06 | vitest run tts-segmenter + voice-latency-log + **voice-session-manager** + useReadAloudQueue (RED scaffolds) | 4 failing specs confirm RED baseline for Waves 1–2 |
| 16-02 | T1 | SC2 | VOICE-03 | npx vitest run tts-segmenter.spec.ts | D-04 first-chunk + deny-list green |
| 16-02 | T2 | SC2 | VOICE-06 | npx vitest run voice-latency-log.spec.ts | D-06 ARIA_DEBUG gate + insert/select green |
| 16-02 | T3 | SC2/SC3/SC4 | VOICE-03/06 | pnpm typecheck | streamVoiceAnswer exported; LOCAL-only; 4096 guard; accumulator; ask() untouched |
| 16-03 | T1 | SC3/SC5 | VOICE-06 | npx vitest run useVoiceSession.spec.ts | bargeIn/pause/resume + paused state green |
| 16-03 | T2 | SC1/SC2/SC3 | VOICE-02/03/06 | npx vitest run useReadAloudQueue.spec.ts | queue order + cancel (incl. player.cancel) + speed; suspend/resume on KokoroPlayerHandle interface green |
| **16-04a** | **T1** | **SC3/SC4** | **VOICE-06** | **npx vitest run voice-session-manager.spec.ts** | **onChunk accumulator + fast-abort safety + D-12 interrupted turn GREEN (BLOCKER 3 fix)** |
| 16-04b | T1 | SC2/SC3 | VOICE-03/06 | pnpm typecheck (behavioral logic proven by 16-03 renderer specs) | VoiceHUDBand transport + VOICE_TTS_CHUNK subscription + voiceLatencyMark emissions |
| 16-04b | T2 | SC1 | VOICE-02 | pnpm typecheck (queue behavior proven by useReadAloudQueue.spec.ts from 16-03) | BriefingScreen section walker; no LLM streaming |
| 16-04b | CHKPT | SC1/SC2/SC3/SC4/SC5 | VOICE-02/03/06 | Human verify | Full cascade smoke test |
| 16-05 | T1 | Read-only | VOICE-02/03/06 | npx vitest run voice-streaming-no-write.spec.ts | D-13 ratchet GREEN |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## SC Coverage Map

| SC | Where Automated | Where Manual |
|----|-----------------|--------------|
| SC1 briefing read-aloud + pause/skip/speed | useReadAloudQueue.spec.ts (queue behavior); useVoiceSession.spec.ts (pause/resume state) | 16-04b checkpoint Test 4 |
| SC2 /ask streaming first-audio p50 <900ms | voice-session-manager.spec.ts (onChunk accumulator timing); voice-latency-log.spec.ts (t_* column population); tts-segmenter.spec.ts (first-chunk flush) | 16-04b checkpoint Test 1; DIAGNOSTICS_VOICE_LATENCY telemetry read |
| SC3 barge-in cancel <200ms + persist spoken-so-far | voice-session-manager.spec.ts (accumulator + D-12); useVoiceSession.spec.ts (bargeIn → idle + fire-and-forget) | 16-04b checkpoint Test 2 |
| SC4 multi-turn referent resolution | voice-session-manager.spec.ts (appendTurn + threadId flow) | 16-04b checkpoint Test 3 |
| SC5 backchannel vs interruption | useVoiceSession.spec.ts (bargeIn no-op when not speaking) | 16-04b checkpoint Test 5 |
| Read-only guard | voice-streaming-no-write.spec.ts | — |

---

## Wave Structure

| Wave | Plans | Files | Parallel? |
|------|-------|-------|-----------|
| 0 | 16-01 | ipc-contract, preload, voice.ts (stubs), migration 136, 4 spec scaffolds | — |
| 1 | 16-02 (main logic), 16-03 (renderer logic) | main/voice/, answer-service.ts vs renderer/voice/ | YES — no file overlap |
| 2 | 16-04a (main wiring), 16-04b (renderer wiring + checkpoint) | src/main/ vs src/renderer/ | YES — no file overlap |
| 3 | 16-05 (static ratchet) | tests/static/ | — |

---

## Wave 0 Requirements

- Existing vitest infrastructure covers all phase requirements — no new framework.
- New `voice_latency_log` migration + all 5 new IPC channels (`VOICE_TTS_CHUNK`, `VOICE_ABORT`, `DIAGNOSTICS_VOICE_LATENCY`, `VOICE_FEED_ANSWER`, `VOICE_LATENCY_MARK`) must land together so `tests/unit/main/ipc/index.spec.ts` handler-count invariant stays green.
- Handler-count test uses `Object.keys(CHANNELS).length` dynamically — no hardcoded integer to maintain.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Spoken prosody / naturalness of chunked TTS | VOICE-02/03 | Subjective audio quality cannot be unit-asserted | Listen to a briefing + an /ask answer read aloud; confirm no choppy mid-clause artifacts |
| Speed 0.5–2x pitch quality | VOICE-02 | Perceptual — confirm Kokoro re-synth is pitch-neutral at extremes | Set 0.5x and 2x; confirm no chipmunk/slur |
| End-to-end first-audio latency feel | VOICE-03 | Telemetry gives p50 numbers; "feels conversational" is perceptual | Run several /ask voice turns; confirm first audio feels <1s |

---

## Revision Log

| Date | Revision | Reason |
|------|----------|--------|
| 2026-06-07 | Added VOICE_FEED_ANSWER + VOICE_LATENCY_MARK as Wave-0 channels (16-01); added voice-session-manager.spec.ts scaffold (16-01 T3); split 16-04 into 16-04a (main) + 16-04b (renderer); 16-04a T1 verifies via voice-session-manager.spec.ts; suspend()/resume() added to KokoroPlayerHandle in 16-03 T2; voiceLatencyMark emissions in 16-04b T1; 16-05 depends_on updated to [16-04a, 16-04b] | plan-checker BLOCKER 1 (VOICE_FEED_ANSWER missing), BLOCKER 2 (voice-session-manager.spec.ts missing), BLOCKER 3 (no behavioral verify in 16-04 main tasks), WARNING 1 (16-04 scope), WARNING 2 (renderer timing path), WARNING 3 (AudioContext non-deterministic) |

---

## Validation Sign-Off

- [x] All behavior-adding tasks have `<automated>` verify or are proven by prior-wave specs
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers the handler-count invariant + migration + all 5 new channel stubs
- [x] No watch-mode flags (use `vitest run`, not `vitest`)
- [x] Feedback latency < 5s (targeted)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending execution

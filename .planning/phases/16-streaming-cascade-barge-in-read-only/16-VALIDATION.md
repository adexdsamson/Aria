---
phase: 16
slug: streaming-cascade-barge-in-read-only
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Read-only phase (VOICE-02/03/06). Derived from 16-RESEARCH.md §Validation Architecture.

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
- **Before `/gsd-verify-work`:** Targeted voice specs green; handler-count invariant (`tests/unit/main/ipc/index.spec.ts`) updated to 152 and green
- **Max feedback latency:** ~5s (targeted)

---

## Per-Task Verification Map

> Filled in as plans land (plan/task IDs do not exist until the planner runs). Each behavior-adding task gets an `<automated>` verify; the SC mapping below is the contract those tasks must satisfy.

| SC | Requirement | Observable validation | Test Type | Evidence |
|----|-------------|----------------------|-----------|----------|
| SC1 briefing read-aloud + pause/skip/speed | VOICE-02 | section walk over BriefingPayload keys; pause = AudioContext.suspend; skip advances currentSectionIndex; speed re-synth via generate({speed}) | unit (renderer) + manual playback | spec assertions on queue/section pointer + manual listen |
| SC2 /ask streaming first-audio p50 <900ms | VOICE-03 | streamVoiceAnswer emits first chunk → first Kokoro synth; per-stage timestamps recorded | unit (segmenter/queue) + telemetry | `voice_latency_log` rows (t_llm_first_token … t_first_audio_out); DIAGNOSTICS_VOICE_LATENCY |
| SC3 barge-in cancel <200ms + persist spoken-so-far | VOICE-06 | bargeIn() stops AudioBufferSourceNode + drains queue + one-way IPC abort; onChunk accumulator flushed to context | unit (abort/accumulator) + integration | fake-timer/abort spec; telemetry delta |
| SC4 multi-turn referent resolution | VOICE-06 | VoiceSession threadId → ask({question,threadId}); getThread lastN:6 injects <thread_history>; synthetic [interrupted] turn on barge-in | integration | spec asserting thread history passed + interrupted-turn appended |
| SC5 backchannel vs interruption | VOICE-06 | by construction — PTT-to-interrupt (D-01); ambient sound w/o PTT press never triggers | unit | spec: non-PTT input during 'speaking' does not bargeIn() |
| Read-only guard | VOICE-02/03/06 | voice streaming modules import no write chokepoint | static ratchet | `tests/static/` grep spec (extends voice-routes-through-staging) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing vitest infrastructure covers all phase requirements — no new framework.
- New `voice_latency_log` migration + the 3 new IPC channels (`VOICE_TTS_CHUNK`, `VOICE_ABORT`, `DIAGNOSTICS_VOICE_LATENCY`) must land together so `tests/unit/main/ipc/index.spec.ts` handler-count invariant (149→152) stays green.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Spoken prosody / naturalness of chunked TTS | VOICE-02/03 | Subjective audio quality of first-chunk-then-sentence boundaries can't be unit-asserted | Listen to a briefing + an /ask answer read aloud; confirm no choppy mid-clause artifacts |
| Speed 0.5–2x pitch quality | VOICE-02 | Perceptual — confirm Kokoro re-synth is pitch-neutral at extremes | Set 0.5x and 2x; confirm no chipmunk/slur |
| End-to-end first-audio latency feel | VOICE-03 | Telemetry gives p50 numbers; "feels conversational" is perceptual | Run several /ask voice turns; confirm first audio feels <1s |

---

## Validation Sign-Off

- [ ] All behavior-adding tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers the handler-count invariant + migration
- [ ] No watch-mode flags (use `vitest run`, not `vitest`)
- [ ] Feedback latency < 5s (targeted)
- [ ] `nyquist_compliant: true` set in frontmatter once plans satisfy the map

**Approval:** pending

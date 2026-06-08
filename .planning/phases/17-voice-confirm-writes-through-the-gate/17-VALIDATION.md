---
phase: 17
slug: voice-confirm-writes-through-the-gate
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-08
revised: 2026-06-08
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> First WRITE-CAPABLE voice phase (VOICE-05/08/09/11). Derived from 17-RESEARCH.md §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (main + renderer projects) |
| **Config file** | `vitest.config.ts` / electron-vite test projects |
| **Quick run command** | `npx vitest run <spec> --no-file-parallelism` (parallel-projects race) |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | quick ~2–5s per spec |

---

## Sampling Rate

- **After every task commit:** Run the task's targeted spec(s) with `--no-file-parallelism`
- **After every plan wave:** Run the wave's specs; `pnpm typecheck` after main/preload edits (84 baseline, 0 new)
- **Before `/gsd-verify-work`:** Targeted voice specs green; handler-count invariant (`tests/unit/main/ipc/index.spec.ts`) updated + green; migration 137 round-trips (foreign_key_check clean)
- **Max feedback latency:** ~5s (targeted)

---

## Per-SC Verification Map (contract — task IDs finalized by planner)

| SC | Requirement | Observable validation | Test Type | Evidence |
|----|-------------|----------------------|-----------|----------|
| SC1 voice drives triage/schedule/draft/ask via SAME in-process service | VOICE-09 | voice-intent-router parses → calls the exported service fn (draftReply/proposeCalendarChange/summarizeThread/ask-service/pushApprovedMeetingActions); ask.spec.ts passes UNCHANGED after extraction | unit (router + ask-service) + integration | router spec asserts dispatch to each service; ask.spec green post-extraction |
| SC2 read-back RESOLVED entities + dual-channel confirm → gate | VOICE-09 | template read-back from resolved row fields (never raw transcript); spoken-affirmative → voiceConfirm(db,id) → transitionTo→assertApproved; forced/high-sev → voice-confirm suppressed + explicit-required chip | unit (read-back template, confirm-classifier) + integration | integration: voice→stage 'ready'→confirm→'approved'→write; forced row throws voice-forbidden-forced |
| SC3 cancel/correct mis-recognized command before it acts | VOICE-11 | PTT-to-cancel / Cancel button in awaiting-confirm → ready→'cancelled' (never voiceConfirm); confirm-classifier 'ambiguous' re-prompts max 2 then auto-cancel | unit (state transition + classifier) | spec: bargeIn in awaiting-confirm transitions ready→cancelled; migration 137 accepts 'cancelled' |
| SC4 cloud opt-in consent + sensitivity stays local | VOICE-05 | single master consent + disclosure + audit; per-turn classify() pre-audio + post-transcript; confidence<0.6 or sensitive → force local REGARDLESS of opt-in | unit (sensitivity-forces-local) + manual (live cloud STT) | spec: sensitive turn with cloud enabled routes local; consent recorded in KV |
| SC5 voice settings honored per turn | VOICE-08 | voice.speed/voiceId/useCloud KV via VOICE_GET/SET_PREFS; read at startAnswer per turn | unit (prefs read/write) + manual | prefs spec; manual: change speed mid-session honored next turn |
| Write-path safety (D-17) | VOICE-05/08/09/11 | voice modules import voiceConfirm but NOT raw write chokepoints | static ratchet | updated voice-streaming-no-write.spec green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- **Migration 137 (mandatory):** add `'cancelled'` to the `approval.state` CHECK constraint via the `PRAGMA legacy_alter_table=ON` + table-rebuild pattern (mirror migration 134 — guards against the [[reference_sqlite_rename_fk_rewrite]] dangling-FK hazard). Validate `foreign_key_check` clean + `'cancelled'` insert succeeds.
- New IPC channels (VOICE_CONFIRM_APPROVAL, voice-cancel-approval, VOICE_GET_PREFS, VOICE_SET_PREFS, cloud-consent) + handlers land together so `tests/unit/main/ipc/index.spec.ts` invariant stays green.
- Existing vitest infra covers all unit/integration needs — no new framework, no new npm deps (cloud STT uses installed `@ai-sdk/openai`).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live cloud STT accuracy + round-trip | VOICE-05 | Requires OpenAI key + network + real audio | Enable cloud, speak a command, confirm transcript quality + that a sensitive command still routes local |
| Acoustic confirm flow (read-back → speak "yes" → write) | VOICE-09 | Real mic + speakers + half-duplex timing | Speak "draft a reply to X", hear read-back of resolved email, say "confirm", verify the draft is staged→approved |
| Cancel mid-read-back | VOICE-11 | Real-time PTT timing during TTS | Start a write command, press PTT (or Cancel) during read-back, verify the action does NOT execute (row = 'cancelled') |
| Forced/high-severity → on-screen tap only | VOICE-09 | Real approval with forced category | Trigger a forced-explicit write by voice; verify the voice-confirm affordance is suppressed + explicit-required chip shown |

---

## Validation Sign-Off

- [ ] All behavior-adding tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers migration 137 + handler-count invariant
- [ ] Migration 137 round-trips clean (foreign_key_check, 'cancelled' insert)
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set once plans satisfy the map

**Approval:** pending

# Aria — Requirements (Milestone v2.0: Voice Interface)

**Milestone:** v2.0 — Voice Interface
**Defined:** 2026-06-02
**Prior milestone:** v1.0 SHIPPED (requirements archived in `milestones/v1.0-REQUIREMENTS.md`)

Voice is a **modality layered over Aria's existing shipped surfaces** (briefing, triage, scheduling, ask, drafting) — not a rebuild. Every outbound action still routes through the existing `assertApproved` chokepoint. Hybrid audio: **local-first default, consent-gated cloud opt-in** (mirrors the existing hybrid-LLM routing).

## v2.0 Requirements

### Core Voice I/O & Pipeline

- [x] **VOICE-01** — User can talk to Aria via push-to-talk (hold hotkey / click) with live transcription shown.
- [x] **VOICE-02** — Aria reads the daily briefing aloud (TTS) with pause / skip / speed controls.
- [x] **VOICE-03** — Aria speaks `/ask` answers aloud.
- [x] **VOICE-04** — Voice runs on-device by default (local STT + local TTS); no audio leaves the machine unless the user explicitly opts in.
- [ ] **VOICE-05** — User can opt into cloud STT/TTS for higher quality via an explicit consent gate + data-handling disclosure; sensitivity-flagged turns stay on-device regardless of the opt-in.
- [x] **VOICE-06** — Conversational multi-turn loop: Aria maintains context across turns and supports barge-in (user interrupt → Aria stops promptly via a single AbortController across LLM + TTS + audio).
- [x] **VOICE-07** — Mic state is always visible (listening / processing / speaking); the mic is gated during playback (half-duplex) so Aria never transcribes its own TTS (Electron AEC is unreliable — #47043).
- [ ] **VOICE-08** — User can set voice/output preferences (voice, speed, local vs cloud) in Settings.

### Voice-Driven Work (over existing surfaces, gated)

- [ ] **VOICE-09** — User can drive triage / scheduling / `/ask` / drafting by voice; voice intents call the same in-process services the existing IPC handlers use (never re-cross the preload bridge).
- [x] **VOICE-10** — Approval-gated actions (email send, calendar change, task push) require the voice-confirm contract: stage → read-back of resolved entities → explicit dual-channel confirm → existing `assertApproved`. Voice can never auto-execute, and is blocked from satisfying the forced-explicit / high-severity / financial-legal-hr override (those force the on-screen click). Extends the existing single-send-site static ratchet to voice write-paths.
- [ ] **VOICE-11** — Mishear recovery: user can correct or cancel a mis-recognized command before it acts.

### Wake-Word (opt-in, licensing-gated)

- [ ] **VOICE-12** — Optional always-listening wake-word, OFF by default, opt-in, privacy-isolated (separate process, trigger-only). Gated on a commercial wake-word license/build decision (openWakeWord pretrained = non-commercial; Porcupine free tier caps at 3 MAU). Push-to-talk ships first; this is the last phase.

## Future Requirements (v2.1+)

- Multi-party meeting coordination — external scheduling negotiation (availability links, back-and-forth, auto-booking).
- Advanced executive reports + predictive analytics — monthly/quarterly reports, KPI dashboards, forward-looking trends/forecasts.
- Extensibility — Asana/Jira/CRM adapters + a plugin/SDK layer over the provider abstraction.

## Out of Scope (anti-features — explicitly not building)

- Open-mic always-listening as the default (privacy) — wake-word is opt-in only.
- Voice-only confirmation for sends/irreversible actions — read-back + explicit dual-channel confirm required; high-severity forces the screen.
- Autonomous auto-send / auto-execute from voice — the approval chokepoint always holds.
- Cloud-default audio — local-first is the default; cloud is explicit opt-in.
- Reading sensitive content aloud unprompted.
- Voice biometric authentication.
- True single-model full-duplex (Moshi-class) — needs A100-class GPU; use the local cascading pipeline instead.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| VOICE-01 | Phase 15 | Complete |
| VOICE-02 | Phase 16 | Complete |
| VOICE-03 | Phase 16 | Complete |
| VOICE-04 | Phase 15 | Complete |
| VOICE-05 | Phase 17 | Pending |
| VOICE-06 | Phase 16 | Complete |
| VOICE-07 | Phase 15 | Complete |
| VOICE-08 | Phase 17 | Pending |
| VOICE-09 | Phase 17 | Pending |
| VOICE-10 | Phase 14 | Complete |
| VOICE-11 | Phase 17 | Pending |
| VOICE-12 | Phase 18 | Pending |

**Coverage:** 12/12 VOICE-* requirements mapped ✓ (no orphans, no duplicates). Phase 19 is a pure performance/quality-polish phase tuning capabilities delivered in 14–18; it carries no net-new requirement.

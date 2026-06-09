# Aria — Milestones

## v2.0 — ⏸ PARKED (in progress) 2026-06-09

**Phases:** 14–19 (numbering) · **Status:** parked to open v2.1 (WhatsApp); voice work intentionally preserved, **not** discarded. Resume later via the phase directories below — none were cleared.

### Completed (code-complete, phase dirs intact)
- **Phase 14 — Voice Safety / Confirm Contract** ✅ (2026-06-03): `approval_path='voice-explicit'`, `voice-forbidden-forced` hard gate, dormant `voiceConfirm()` seam through `assertApproved`, 2 static ratchets. (Also fixed latent Phase-6 dangling `approval_old` FKs via migration 135.)
- **Phase 15 — Audio I/O + Model Runtime** ✅ (2026-06-04)
- **Phase 16 — Streaming Cascade + Barge-in (read-only)** ✅ (2026-06-07)
- **Phase 17 — Voice-Confirm + Writes Through the Gate** ✅ code-complete (2026-06-09): VoiceIntentRouter → stage 'ready' → resolved-entity read-back → confirm-classifier → voiceConfirm→transitionTo→assertApproved (stamps 'voice-explicit'); cancel→'cancelled' (migration 137); cloud STT + answer behind consent (sensitive→local fail-safe); VoiceSection settings; ApprovalCard voice-confirm + Cancel.

### Paused checkpoint (resume here)
- **Phase 17 Plan 07** at `checkpoint:human-verify` — live acoustic SC1–SC5 (run `pnpm dev` + mic/speakers): SC1 voice /ask · SC2 schedule/draft read-back→"yes"→write · SC3 cancel mid-read-back→'cancelled' · SC4 cloud consent + sensitive-stays-local · SC5 speed/cloud per-turn · D-07 forced→explicit-required chip. Commits d84579a + 9915b2d. Verifier 5/5 automated must-haves, 101 tests green, typecheck flat 84 baseline.

### Not started
- **Phase 18 — Opt-in Wake-Word + Privacy Isolation** (gated on commercial wake-word licensing decision: Picovoice vs custom openWakeWord vs defer)
- **Phase 19 — Cloud Opt-in Polish + Performance** (optimization, not net-new capability)

**Roadmap:** lives in [ROADMAP.md](./ROADMAP.md) until v2.0 is formally completed/archived.

## v1.0 — ✅ SHIPPED 2026-06-02

**Phases:** 1–13 (incl. inserted 08.1) · **Span:** 2026-05-14 → 2026-06-02 (~19 days) · **Commits:** ~416
**Audit:** [v1.0-MILESTONE-AUDIT.md](./v1.0-MILESTONE-AUDIT.md) — `tech_debt` (integration INTACT, no blockers)
**Archives:** [v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) · [v1.0-REQUIREMENTS.md](./milestones/v1.0-REQUIREMENTS.md)

### What shipped
- **Local-first encrypted foundation** — Electron + SQLCipher DB + Electron safeStorage + hybrid LLM router (frontier + local Ollama) + onboarding/vault (Ph1)
- **Daily briefing** from Gmail + Google Calendar + news, scheduled, with "why this mattered" rationale (Ph2)
- **Approval-gated chief-of-staff actions** — email triage/drafting/send, calendar smart-scheduling (NL reschedule, conflict-aware), all behind a single `assertApproved` chokepoint + sensitivity router (Ph3–4)
- **Outlook/M365 parity** — unified multi-provider mail + calendar (Ph5)
- **Meeting capture → cited action items → Todoist**, RAG Q&A over user data, Knowledge Folders (Ph6, 7, 10)
- **Insights + weekly recap (DOCX/PDF) + preference learning + release pipeline** (Ph8); **subscription + 60-day trial** (Stripe + license server, Ph8.1)
- **Editorial product UI** (Anthropic design system, Ph9), **web research jobs** (Ph11), **background tray + auto-launch** (Ph12)
- **Open-source release prep** — README/LICENSE(MIT)/docs + secret-scrub (Ph13)

### Verification posture
All 14 phases executed with evidence (6 VERIFICATION.md / 6 UAT.md / 2 walkthrough-documented). Cross-phase integration verified INTACT (8/8 E2E chains wired).

### Tech debt carried into next milestone
- Phase 9 design pixel-diff walkthrough (human checkpoint) still open
- Phase 2 / Phase 8 "pending verification" — live multi-account smoke, Ollama smoke, packaged-build E2E, Apple notarization, lived-14d insight/learning data
- macOS tray UAT (needs Mac hardware); Windows tray `connected` state seeded statically
- Dark/light mode: `[data-theme='dark']` does not override legacy `--aria-gray-*` tokens
- `pnpm typecheck` not run on the 2026-06-02 UI WIP batch (esbuild skips typecheck)
- migration_014 legacy singleton-cron paths not exhaustively traced (gmail/calendar IPC confirmed clean)

### Notable decisions
- Local-first desktop (Electron + TS/Node) over SaaS — privacy as the differentiator
- Hybrid LLM (local for PII/sensitive, frontier for reasoning)
- Single `assertApproved` chokepoint for all outbound writes (email/calendar/task)
- Source-available MIT open-source posture (forks may strip the paywall — accepted for adoption)

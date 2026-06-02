# Aria — Milestones

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

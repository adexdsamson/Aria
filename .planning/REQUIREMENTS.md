# Aria — Requirements (Milestone v2.1: Messaging / Group Intelligence)

**Milestone:** v2.1 — Messaging / Group Intelligence
**Defined:** 2026-06-09
**Prior milestone:** v2.0 Voice Interface — ⏸ PARKED (requirements snapshot in `milestones/v2.0-REQUIREMENTS.md`; phases 14–17 code-complete, 18–19 unstarted)

WhatsApp group-tracking layered onto Aria's shipped surfaces (daily briefing, approval gating). Connection via **Baileys** (`@whiskeysockets/baileys@6.7.23` — pinned, NOT v7 RC), the unofficial WhatsApp Web multi-device protocol, QR-linked. **Read-only / passive posture** — Aria observes, never sends. Group content (third-party PII) is summarized **local-only** via Ollama and never leaves the machine. MVP = foundation (link → select → ingest) + a local daily-briefing digest; three extraction consumers are deferred.

## v2.1 Requirements (this milestone)

### WhatsApp Linking & Session (WA-LINK)

- [x] **WA-01** — User can link their WhatsApp account by scanning a QR code shown in Aria (WhatsApp Web style).
- [x] **WA-02** — Before linking, user sees an explicit ban-risk disclosure (unofficial protocol; recommends using a secondary number) and must acknowledge it before the QR appears.
- [x] **WA-03** — User can see WhatsApp connection status (linked / needs-relink / disconnected) and re-link when the session expires.
- [x] **WA-04** — User can disconnect WhatsApp; doing so tears down the session and deletes all stored WhatsApp data (creds, groups, messages, digests).

### Group Selection & Ingestion (WA-GROUP)

- [x] **WA-05** — After linking, user can see their WhatsApp groups and toggle which ones Aria tracks (reachable any time, not only at link).
- [x] **WA-06** — Aria stores messages only from tracked groups; untracked groups and 1:1 direct messages are never persisted (the track toggle is the privacy boundary).
- [x] **WA-07** — Stored WhatsApp messages are text-only (media shown as placeholders) and retained on a rolling 30-day window.

### Daily Group Digest (WA-DIGEST)

- [x] **WA-08** — The daily briefing includes a WhatsApp section summarizing each tracked group's activity since the last digest, exec-framed: key points, decisions, open questions, and mentions of the user.
- [x] **WA-09** — WhatsApp group content is summarized using the local model only and is never sent to a frontier API (enforced by a static ratchet, not convention).
- [x] **WA-10** — If the local model is unavailable, the briefing still generates and the WhatsApp section degrades gracefully (clear "unavailable" note) rather than failing the whole briefing.

### Safety, Privacy & Resilience (WA-SAFE)

- [x] **WA-11** — Aria observes WhatsApp passively (read-only): it never sends messages, read receipts, or presence, and never auto-acts; a static guard prevents any outbound WhatsApp send call.
- [x] **WA-12** — WhatsApp is a degradable capability — a dropped connection or upstream protocol break surfaces as a visible degraded status and leaves the rest of Aria (briefing, email, calendar, tasks) fully functional.

## Future Requirements (deferred — later v2.1 phase, "Extraction Consumers")

These layer onto the `whatsapp_message` rows the foundation already stores; **zero schema additions** expected. Each routes through Aria's existing approval chokepoint.

- **WA-F1** — Extract action items / commitments from tracked groups into `task_batch` approvals (pushable to Todoist), reusing the meeting-capture extraction pipeline.
- **WA-F2** — Detect meeting proposals in tracked groups and surface them as `calendar_change` approvals.
- **WA-F3** — Capture project feedback/sentiment from tracked groups, queryable via RAG and surfaced in insights.

## Out of Scope (anti-features — explicitly not building in v2.1)

- **Sending / replying to WhatsApp from Aria** — read-only posture is a safety invariant; any send would sharply raise ban risk.
- **Media / attachment ingestion** — text + captions only; media stored as `[image]` / `[document: name]` placeholders.
- **Routing group content to frontier APIs** — third-party PII stays local; cloud opt-in (as in voice) is explicitly NOT offered for WhatsApp content in v2.1.
- **Historical backfill before link time** — the WhatsApp Web multi-device protocol does not reliably deliver history; the digest starts "from today."
- **1:1 direct-message tracking** — groups only; DMs are excluded at ingestion.
- **Multiple linked WhatsApp accounts** — single linked account in v2.1 (the `provider_account` model supports more later).
- **Official WhatsApp Business Cloud API path** — cannot read a personal account's existing groups; rejected during brainstorm.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| WA-01 | Phase 20 — Foundation | Complete |
| WA-02 | Phase 20 — Foundation | Complete |
| WA-03 | Phase 20 — Foundation | Complete |
| WA-04 | Phase 20 — Foundation | Complete |
| WA-05 | Phase 20 — Foundation | Complete |
| WA-06 | Phase 20 — Foundation | Complete |
| WA-07 | Phase 20 — Foundation | Complete |
| WA-08 | Phase 21 — Digest + Briefing Integration | Complete |
| WA-09 | Phase 21 — Digest + Briefing Integration | Complete |
| WA-10 | Phase 21 — Digest + Briefing Integration | Complete |
| WA-11 | Phase 20 — Foundation | Complete |
| WA-12 | Phase 20 — Foundation | Complete |
| WA-F1 | Phase 22 — Extraction Consumers (deferred) | Deferred |
| WA-F2 | Phase 22 — Extraction Consumers (deferred) | Deferred |
| WA-F3 | Phase 22 — Extraction Consumers (deferred) | Deferred |

**Coverage:** 12/12 active WA-* requirements mapped (100%) · 3/3 future WA-F* requirements mapped to Phase 22 (deferred) · No orphans.

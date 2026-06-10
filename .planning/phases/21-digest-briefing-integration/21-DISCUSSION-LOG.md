# Phase 21: Digest + Briefing Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 21-digest-briefing-integration
**Mode:** advisor (full_maturity tier; research-backed comparison tables, 4 parallel research agents)
**Areas discussed:** Digest output structure, Window + catch-up policy, Section states & degradation, Section assembly point

---

## Digest output structure

| Option | Description | Selected |
|--------|-------------|----------|
| Constrained delimited markdown | `generateText` with fixed `###` headers; renderer splits on headers. Best reliability/structure trade on an 8B local model; partial-parse tolerant; WA-10-safe. | ✓ |
| Structured JSON (`generateObject`+Zod) | Typed fields, best renderer structure, but local-model JSON is flaky → needs try/catch→degraded fallback + temp 0. | |
| Free-form markdown | Highest reliability, weakest exec-framing (no segmentation). | |

**User's choice:** Constrained delimited markdown (recommended).
**Notes:** Decisive constraint is the local quantized model (Ollama guarantees JSON shape, not content quality). Research surfaced a critical schema/ingest gap: `sender_jid` is stored as `'self'`/group-jid and there's no `mentionedJid` column → @mention detection must be heuristic from `body_text` (captured as D-03 + a Phase 22 deferred ingest fix).

---

## Window + missed-run catch-up policy

| Option | Description | Selected |
|--------|-------------|----------|
| Since-last-digest capped + layered catch-up | Window = max(last watermark, now−N days); catch-up = pendingCatchup channel + powerMonitor-resume check + non-blocking briefing-read fallback. | ✓ |
| Since-last-digest + pendingCatchup only | Same window; unlock-drain catch-up only — misses awake-but-slept-overnight case. | |
| Fixed prior-calendar-day window | Summarize "yesterday"; clean mental model but loses a full day if a run never fires. | |

**User's choice:** Since-last-digest capped + layered catch-up (recommended).
**Notes:** Watermark computed from `MAX(sent_at)` (device time), not cross-clock `generated_at`. `UNIQUE(jid,date)` makes re-fires idempotent.

---

## Section states & degradation

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated union + per-group sub-states | `whatsApp?: {state:'ready', groups, connection} \| {state:'unavailable', reason} \| undefined`, mirroring `thisWeekInsights`; per-group sub-state preserves partial Ollama failures. | ✓ |
| Section-level fail-soft only | One whole-section state; discards good summaries on partial failure. | |
| Ad-hoc presence checks in renderer | Raw booleans branched inline; fights the main-computed-section-state convention. | |

**User's choice:** Discriminated union + per-group sub-states (recommended).
**Notes:** Accepted the recommended state matrix (omit not-linked/quiet; render unavailable note + Generate-now affordance for SC4; quiet inline line for degraded connection). Min-activity threshold ≈3 messages left as a tunable default.

---

## Section assembly point

| Option | Description | Selected |
|--------|-------------|----------|
| Read-path enrich + cron under `src/main/whatsapp/` | Attach `row.whatsApp` in `BRIEFING_TODAY` (like `thisWeekInsights`) — WA-09 holds by construction; digest cron file under the ratcheted dir. | ✓ |
| Read-path enrich, reconsider cron location | Keep enrichment, debate cron placement (loses automatic ratchet coverage). | |
| 4th gatherer inside `runBriefing` | Risks WA text entering the frontier prompt; outside ratchet scope. | |

**User's choice:** Read-path enrich + cron under `src/main/whatsapp/` (recommended).
**Notes:** Cautionary precedent flagged — `insights/aggregate.ts` is frontier-capable and outside any ratchet; the WhatsApp digest generator must NOT mirror that placement.

---

## Claude's Discretion

- Exact digest prompt text (within the locked exec-framing structure) — highest-uncertainty deliverable per roadmap; draft in plan, iterate in UAT.
- Window cap `N` (2–3 days, ≤30) and min-activity threshold (≈3 messages).
- Whether to show a "no groups tracked" hint vs pure omit for the linked-but-empty state.
- Per-group message/token cap fed to the local model; group ordering; DTO field names; delimiter-splitter helper details.

## Deferred Ideas

- Ingest fix to persist participant jid + `mentionedJid` (enables reliable @mention attribution) → Phase 22 consideration; no migration allowed this phase.
- Action-item / meeting-proposal / RAG extraction consumers → Phase 22 (WA-F1/F2/F3), pending Phase 21 digest-quality UAT.
- Per-group / configurable retention or digest cadence → fixed for v2.1.
- Just-in-time digest blocking the briefing → explicitly rejected; read-path fallback stays async/best-effort.

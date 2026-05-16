# Phase 2 Discussion Log

**Date:** 2026-05-16
**Mode:** discuss (default)
**Phase:** 02-gmail-ingest-daily-briefing-mvp

## Areas Selected by User

Multi-select chose: Briefing layout & density, External news source(s), Ingest cadence + first-connect backfill.

**Not discussed (Claude's discretion):** Priority email definition (MVP) — applying default of `unread AND IMPORTANT label AND age ≤ 24h`, flagged for replacement in Plan 3-3.

---

## Area 1 — Briefing layout & density

### Q1: Layout
- Options: Sectioned doc (Recommended) / Card stack / Chat-style summary / Three-pane dashboard
- **Selected:** Sectioned doc

### Q2: Tone
- Options: Terse executive (Recommended) / Warm + conversational / Neutral newsroom
- **Selected:** Terse executive

### Q3: Length budget
- Options: ~1 screen top-3 per section (Recommended) / ~2 screens top-5 / Adaptive no cap
- **Selected:** Top-3 per section

---

## Area 2 — External news source(s)

### Q1: Sources for Phase 2 (multiSelect)
- Options: HN top stories (Recommended) / RSS aggregator / Single mainstream API / User-configurable URLs only
- **Selected:** HN + RSS aggregator + custom freeform: "Can we have some pre-configured list based on countries that is when the user select NG, they should be able to select government sources such as CBN, NCC, and so on based on sectors and same goes for other countries"
- **Decision:** Country/sector-templated bundles confirmed as in-scope shape.

### Q2: Ranking
- Options: Hybrid source-rank + LLM relevance (Recommended) / Pure source rank / Pure LLM over larger pool
- **Selected:** Hybrid

### Q3: Rationale source
- Options: Same LLM call that ranks (Recommended) / Static template / Per-item LLM call
- **Selected:** Same LLM call (generateObject + Zod)

### Follow-up — country/sector scope for Phase 2

### Q4: Scope
- Options: HN + RSS + 1 country bundle NG (Recommended) / HN + RSS + multi-country / HN + RSS only deferred
- **Selected:** HN + RSS + 1 NG country bundle (gov/finance fixture)

### Q5: Picker UX
- Options: Onboarding step + Settings (Recommended) / Settings only default global
- **Selected:** Onboarding step + Settings editable

---

## Area 3 — Ingest cadence + first-connect backfill

### Q1: Gmail poll interval
- Options: 5 min (Recommended) / 1 min / Adaptive
- **Selected:** 5 minutes

### Q2: First-connect backfill
- Options: 7 days (Recommended) / 24 hours / 30 days / No backfill
- **Selected:** Last 7 days

### Q3: Calendar poll cadence
- Options: 15 min + push on briefing trigger (Recommended) / 5 min / 60 min + push
- **Selected:** 15 min + push on briefing trigger

---

## Scope creep redirected

- "More country bundles beyond NG" → captured as deferred idea, not in Phase 2.
- "Per-sector cross-country filtering" → captured as deferred.
- "30-day backfill for RAG seeding" → tagged for Phase 7 RAG.

## Claude's discretion applied

- Priority email definition for MVP: Gmail's own IMPORTANT label + unread + ≤24h.
  Documented as a Plan 3-3 replacement target.
- File layout, IPC namespaces, migration 002 schema shape.
- Test strategy (vitest unit + Playwright _electron e2e).

# Phase 3 Discussion Log

**Date:** 2026-05-17
**Phase:** 3 — Approval Queue + Sensitivity Router + Email Triage/Drafting/Send

Human reference only. Downstream agents read CONTEXT.md, not this file.

## Gray Areas Selected
- Approval Queue UX + state
- Sensitivity router design
- Triage rationale + priority
- Voice-match spike + eval

## Pre-phase gate
- **Design partner gate (ROADMAP):** None yet — gate deferred. Proceed with self as exec persona, revisit before Phase 4.

## Q&A

### Approval Queue UX + state
- **Queue surface:** _Both — inline preview in briefing + dedicated detail view at /approvals._
- **Card actions:** _Full set — Approve, Edit-then-approve, Reject, Snooze, Batch approve._
- **Crash recovery:** _Surface as 'interrupted' on next launch — user clicks to retry. No auto-retry._

### Sensitivity router design
- **Classifier schema:** _Category set + severity + rationale._
- **Redaction strategy:** _Hybrid — token sub + re-hydrate for general PII; route entirely local for HR/legal/financial at severity ≥ med._
- **Audit UI:** _Both — inline chip on each item + full searchable /routing-log view._

### Triage rationale + priority
- **Rationale format:** _Structured tags + one-line summary._
- **Priority buckets:** _4 — urgent / needs-you / fyi / archive._
- **Storage:** _Store once with the triage decision; persist classifier version._

### Voice-match spike + eval
- **Eval method:** _Pairwise LLM-as-judge on held-out sent mail._
- **Held-out set:** _50 stratified sent emails (short, long, formal, casual); excluded from few-shot/fine-tune data._
- **Abort criteria:** _Define numeric threshold up front; if both fail, ship few-shot with 'beta voice' label._
- **Threshold:** _≥65% pairwise win + no catastrophic losses._

## Deferred Ideas
- Per-recipient allowlist UI → v1.x
- Background re-rationale on classifier upgrade → post-v1
- Calendar approvals → Phase 4 (queue built generic to accept)
- Outlook drafting/send → Phase 5
- Design-partner recruitment → revisit before Phase 4

## Claude's Discretion (not asked, applied)
- LLM call serialization via p-queue (matches CLAUDE.md stack)
- Tier config schema must support per-content-class overrides to satisfy APPR-07 forced-explicit
- Generic queue surface so Phase 4 calendar approvals slot in without refactor
- Gmail send-scope OAuth: don't block phase on CASA/Google verification turnaround

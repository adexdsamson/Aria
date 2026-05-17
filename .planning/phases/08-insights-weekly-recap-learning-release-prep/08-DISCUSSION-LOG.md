# Phase 8 Discussion Log

**Date:** 2026-05-17
**Phase:** 8 — Insights, Weekly Recap, Learning, Release Prep

Human reference only.

## Gray Areas Selected
- Insights computation + briefing integration
- Weekly recap + "What Aria did" audit
- Preference learning + briefing feedback
- Release prep: signing, updater, backup

## Q&A

### Insights computation + briefing integration
- **Insight set:** _Calendar-load delta + Email response-time trend + Recurring themes + Approval-edit patterns (all four)._
- **Cadence:** _Nightly background job; cached in DB; briefing reads cache._
- **INSIGHT-03 routing:** _Pre-aggregate insights to numeric/structural facts locally; pass only aggregates to frontier for prose._
- **History gate:** _Hard gate — no insight surfaced until 14 days of data exists per relevant corpus._

### Weekly recap + "What Aria did" audit
- **Timing:** _Auto-generated Monday morning covering the prior week._
- **Aria-actions source:** _Stitched from a unified action audit log (drafts sent, meetings moved, tasks pushed, approvals declined)._ (Implementation also adds a short LLM narrative paragraph above the raw list.)
- **Edit-feedback loop:** _Diff stored as a learning signal; per-section diffs categorized (tone, length, factual, structure)._
- **Export:** _Both formats — DOCX + PDF; identical content; user picks at export time._

### Preference learning + briefing feedback
- **Storage:** _Both — typed preferences derived nightly from signal log; signal log retained._
- **Signal capture:** _Approval-queue actions (edit diff/reject/accept) + briefing more-like/skip + recap section edits + Q&A thumb-up/down._
- **Inspect & reset:** _Settings 'Learned preferences' tab — current value, source signals count, last-updated, per-field reset._
- **News config (BRIEF-04):** _Settings UI with topic chips + RSS sources; preferences tab also tunes from briefing skip signals._

### Release prep
- **Updater feed:** _GitHub Releases (electron-updater built-in provider)._
- **Signing:** _macOS notarized; Windows unsigned + SmartScreen warning in v1, OV deferred._  ⚠ **Flagged deviation from XCUT-05 / SC-5.** Planner must surface before plan 4.
- **Backup & restore:** _Snapshot + verify (SELECT count); rollback on count drift._
- **Integration tests:** _Playwright `_electron` E2E covering full happy path: connect both providers → ingest → briefing → draft/approve/send → schedule meeting → transcript/Todoist → RAG query → recap._

## Flagged Deviation
- **Windows signing (XCUT-05 / SC-5)** — user's chosen v1 posture (Windows unsigned) conflicts with locked ROADMAP requirements. Must resolve via REQUIREMENTS amendment (defer XCUT-05 Windows clause to v1.1) OR by acquiring OV cert. Documented in CONTEXT.md `<flagged_deviation>`.

## Deferred Ideas
- S3/R2 updater hosting → swap when commercial
- Differential updates beyond electron-updater defaults → defer
- Windows OV signing → v1.1 (if amendment path taken)
- Insight categories beyond the four (attention budget, rebalancing) → v1.x
- Cross-week recap comparisons → defer
- Recap collaboration / share → out of scope (solo persona)
- Federated learning / cloud sync of prefs → out of scope (LEARN-02)

## Claude's Discretion (not asked, applied)
- Insight prose payload shape: `{ calendarLoadDeltaPct, topThemes, medianReplyTimeShiftHours, ... }` — numerics/labels only
- Typed preferences schema (voice/triage/scheduling/briefing buckets)
- Unified `action_audit_log` table consolidating per-phase audit sources
- `learning_signals` table retained for replay if aggregator changes
- Nightly aggregator runs after sync quiet window (e.g. 2am local)
- 5 most-recent DB backups retained in `userData/backups/`
- Migration verifier compares row counts on critical tables (allowing intentional column drops)
- "I used Aria today" dogfood criterion enforced through this phase
- Pino redaction audit before release; Sentry beforeSend allowlist

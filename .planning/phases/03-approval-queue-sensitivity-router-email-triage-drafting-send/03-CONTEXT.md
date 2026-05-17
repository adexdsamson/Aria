# Phase 3 Context: Approval Queue + Sensitivity Router + Email Triage/Drafting/Send

**Phase:** 3
**Date:** 2026-05-17
**Mode:** mvp
**Requirements (locked by ROADMAP):** APPR-01, APPR-03, APPR-04, APPR-05, APPR-06, APPR-07, LLM-02, EMAIL-03, EMAIL-04, EMAIL-05, EMAIL-06

<domain>
Aria writes its first email under user approval, with hybrid LLM routing live and defended. Delivers:
- Persisted Approval Queue (state machine + UI) for all outbound communication
- Sensitivity classifier upgrade (local LLM) with redaction/re-hydration and audit log
- Email triage with structured "why this mattered" rationale
- Voice-match spike (few-shot vs local fine-tune) gated on held-out eval, then drafting agent
- Gmail send scope OAuth + audit log
</domain>

<canonical_refs>
- `.planning/ROADMAP.md` — phase 3 scope, plans, success criteria (lines 67–85)
- `.planning/REQUIREMENTS.md` — APPR-01..07, LLM-02, EMAIL-03..06 (lines 22, 29–35, 41–44)
- `.planning/PROJECT.md` — trust posture, approval gating policy, persona
- `CLAUDE.md` — tech stack (better-sqlite3, Vercel AI SDK 5, Ollama, generateObject+Zod, p-queue)
- `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md` — Gmail ingest patterns, briefing surface, redact helpers landed in Phase 2

No external ADRs yet for this phase. Researcher must read all five above before planning.
</canonical_refs>

<prior_decisions>
**Project-level (PROJECT.md / CLAUDE.md):**
- Local-first; data never leaves machine except scoped LLM calls; PII pre-routed to local model
- Frontier APIs for reasoning, local Ollama (Llama 3.1 8B / Qwen 2.5 7B) for sensitive routing
- All outbound communication requires explicit user confirmation (APPR-01 policy)

**From Phase 2:**
- Gmail ingest live (5min poll, 7d backfill); messages persisted in SQLite
- Briefing is sectioned, exec-terse, top-3 per section — Phase 3 must fit this aesthetic
- A redaction helper / currency regex exists from Phase 2 redact work; reuse, don't duplicate

**From earlier blockers:**
- Electron pinned to 41.6.1 (SQLCipher ABI); do not bump in this phase
</prior_decisions>

<decisions>

### Approval Queue UX + state
- **Surface:** Both — inline preview in briefing (top-N pending) AND dedicated `/approvals` detail view with full queue. Briefing shows count badge; deep-link to detail.
- **Card actions (v1 full set):** Approve, Edit-then-approve (inline edit + diff stored for APPR-04), Reject (with optional reason captured for learning), Snooze (until time/condition), Batch approve (multi-select with explicit confirmation UX).
- **State machine states:** `pending → generating → ready → (approved|rejected|snoozed) → sent` (sent only from approved). `generating` failures land in `interrupted`.
- **Crash recovery:** Mid-generation drafts surface as `interrupted` on next launch with a clear badge; user clicks "regenerate" to retry. No auto-retry on launch (avoid surprise LLM cost).
- **Persistence:** Queue items survive app restart (APPR-05) — better-sqlite3 table, written before each state transition.
- **Tier config schema:** APPR-06 schema must exist and be enforced by the gate. v1 ships with `always-confirm` default for all sends; per-recipient allowlist UI deferred to v1.x. Schema must support silent/explicit/always-confirm tiers and per-content-class overrides (see APPR-07 forced explicit).

### Sensitivity router design
- **Classifier output (Zod schema via `generateObject`):** `{ categories: [financial|legal|hr|pii|urgent|none], severity: low|med|high, confidence: 0-1, rationale: string }`. Categories are a set (multi-label).
- **Redaction strategy (hybrid):**
  - Token substitution + re-hydration for general PII routed to frontier (PERSON_N, EMAIL_N, AMT_N, ORG_N, PHONE_N)
  - Route **entirely local** (no frontier call) when categories include `hr`, `legal`, or `financial` at severity ≥ med
  - Re-hydration happens local-side after frontier response; tokens must be deterministic per-task and never leak across tasks
- **Forced-explicit (APPR-07):** Any draft whose classifier flags `severity: high` OR any of `financial|legal|hr` is forced to explicit approval regardless of user's tier setting.
- **Audit log:** Both surfaces ship — (a) inline chip on each draft/triage item showing `routed: local | frontier | hybrid` with click-to-expand classifier rationale, AND (b) full searchable `/routing-log` view: one row per LLM call with input hash, categories, severity, model, rationale, timestamp.

### Triage rationale + priority
- **Rationale format:** Structured tags + one-line summary. Schema: `{ signals: [from-vip, thread-active, deadline-mentioned, money-amount, awaiting-reply, mention, ...], summary: string }`. Tags drive filters; summary surfaces in queue/briefing.
- **Priority buckets (4):** `urgent / needs-you / fyi / archive`. `urgent` is for deadline/escalation signals; `needs-you` mirrors briefing top section.
- **Storage:** Store once with the triage decision (immutable audit trail). Persist classifier version alongside; future classifier upgrades may trigger background re-rationale, but not in v1.
- **Surfacing:** Tags shown as small chips next to subject; summary as the inline `why` line. Both visible in queue card without expanding.

### Voice-match spike + eval
- **Eval method:** Pairwise LLM-as-judge on held-out sent mail. For each held-out sent email, generate a draft reply from the original inbound; judge picks between (a) Aria-voice draft and (b) generic-LLM baseline draft. Win-rate is primary metric.
- **Held-out set:** 50 stratified sent emails (short replies, long-form, formal, casual). Excluded from few-shot pool and any fine-tune data.
- **Threshold:** **≥65% pairwise win + no catastrophic losses** (zero held-out items judged "wildly wrong tone" by judge or sanity-checker). Both approaches (few-shot, local fine-tune) evaluated against this bar.
- **Decision rule:** Pick the approach that clears the bar with higher margin. If both clear: prefer few-shot (simpler, no model artifact). If only one clears: pick that one.
- **Abort criteria:** If neither clears the bar, ship few-shot with a visible "beta voice" label in the approval card; capture rejection signal for re-spike. Do NOT block phase completion.
- **Order of operations:** Spike runs and decision is made BEFORE building the drafting agent; planner must sequence this.

### Cross-cutting / infra
- **LLM call serialization:** Route every LLM call (classifier, triage, draft, judge) through p-queue for cost predictability + rate-limit safety.
- **Gmail send scope:** OAuth send-scope requested separately from read-scope; consent prompt explains why. Use CASA-approved credentials path per ROADMAP plan 4 — if CASA approval isn't ready, scope can be requested in dev with verification-pending banner; do not block phase on Google verification turnaround.

</decisions>

<deferred>
- **Per-recipient allowlist UI** — schema lands in v1, UI deferred to v1.x (per ROADMAP plan 1)
- **Background re-rationale on classifier upgrade** — versioning is in v1 (we store classifier version), the re-run job is deferred
- **Calendar approvals** — Phase 4; queue surface is built generic enough to accept non-email items
- **Outlook drafting/send** — Phase 5
- **Design-partner gate** — ROADMAP requires ≥1 SMB-exec design partner pre-Phase-3. **Gate explicitly deferred for v1; user is self-as-exec persona.** Revisit before Phase 4. Recruit during Phase 3 if possible to validate triage rationale and voice-match output.
</deferred>

<open_questions_for_research>
- Best Ollama local model for the sensitivity classifier given Zod-schema reliability (Llama 3.1 8B vs Qwen 2.5 7B vs Mistral) — researcher should compare `generateObject` adherence rates
- Token substitution: stable hashing approach that survives re-hydration without collision across concurrent drafts
- Whether `generateObject` over Ollama is reliable enough for the classifier in production, or if we need a regex/heuristic prefilter
- Local fine-tune feasibility for voice match — what tooling (Ollama Modelfile, LoRA via llama.cpp, external) is realistic for solo-dev v1
- Pairwise judge model choice (frontier Claude/GPT vs local) — judge bias considerations
- Crash-recovery test harness — how to simulate mid-generation crash deterministically in tests
- Gmail send-scope CASA status — current Aria standing with Google verification
</open_questions_for_research>

<success_criteria_recap>
From ROADMAP (locked):
1. User cannot send any email without explicit approval action (verified by attempted bypass)
2. PII-like content classifies as sensitive and routes LOCAL; routing log shows decision + reason
3. User approves a draft; email sends via Gmail; appears in Sent folder
4. Approval queue items survive app crash mid-generation; never transition to sent without explicit user action
5. Draft voice match passes a held-out eval vs prior sent emails (≥65% pairwise + no catastrophic losses)
6. Every triage decision carries a user-visible "why this mattered" rationale; structured and auditable
7. Tier config schema exists and is enforced by the gate even though only always-confirm is user-selectable in v1
</success_criteria_recap>

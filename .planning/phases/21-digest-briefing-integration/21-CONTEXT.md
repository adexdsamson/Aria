# Phase 21: Digest + Briefing Integration - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Each morning a **05:00 local-model digest cron** summarizes every *tracked* WhatsApp group's recent activity into the `whatsapp_group_digest` table, and the **07:00 daily briefing** surfaces those summaries as an exec-framed WhatsApp section — degrading gracefully when Ollama is unavailable, and never touching a frontier API.

**Delivers (WA-08, WA-09, WA-10):**
- A 05:00 cron under `src/main/whatsapp/` that, per tracked group, gathers messages in a since-last-digest window and produces an exec-framed digest (key points / decisions / open questions / mentions) using `getLocalModel()` only.
- A WhatsApp section attached to the `BriefingPayload` at the `BRIEFING_TODAY` read path, modeled as a discriminated union with per-group sub-states.
- Graceful degradation: briefing always generates; the WhatsApp section shows a clear "digest unavailable — local model offline" note (with a Generate-now retry affordance) when the local model failed.
- Frontier prohibition: enforced by the **already-shipped** ratchet at `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` (SC3) — satisfied by construction so long as digest-generation code lives under `src/main/whatsapp/`.

**Out of scope (later phases):**
- Action-item extraction, meeting-proposal detection, RAG capture → **Phase 22** (WA-F1/F2/F3).
- Any outbound WhatsApp action (permanent — passive posture invariant).
- Schema changes / new migrations — `whatsapp_group_digest` already shipped in migration 138; this phase adds **zero** schema.

</domain>

<decisions>
## Implementation Decisions

### Digest output structure (WA-08)
- **D-01:** Generate the digest as **constrained delimited markdown** via `generateText` (NOT `generateObject`). Use fixed section headers — `### KEY POINTS`, `### DECISIONS`, `### OPEN QUESTIONS`, `### MENTIONS` — and store the verbatim string in `whatsapp_group_digest.summary_text`. The renderer splits on the known headers.
  - **Rationale:** the digest runs on a local quantized 8B/7B model (Llama 3.1 8B / Qwen 2.5 7B class). Ollama's constrained decoding guarantees JSON *shape* but not *content quality*, and Llama-3-class models are flagged as flaky at strict JSON. Free-text generation is the path these models handle most reliably; delimited markdown recovers most of the labeled-block structure WA-08 wants while being partial-parse tolerant and trivially WA-10-safe (any string is a valid digest).
- **D-02:** Pin **`temperature: 0`** on the digest call for determinism/idempotency.
- **D-03 (schema-gap constraint — MUST read):** `whatsapp_message` stores only `body_text` + `sender_jid`, with **no `mentionedJid` column**. Worse, `ingest.ts` writes `sender_jid` as the literal `'self'` for the user's own messages and as the **group jid** (not the participant jid) for incoming messages — so per-sender attribution and JID-based "@mentions of you" detection are **impossible from the stored rows**. The `### MENTIONS` block must be populated **heuristically**: pass the user's display name (from `profile.json`) and the local-part of `creds.me.id` into the prompt and let the local model surface body-text references to the user. Do not attempt JID-based mention attribution this phase (no migration allowed). *(An ingest fix to persist participant jid / mentionedJid is noted as a deferred idea for Phase 22.)*

### Digest window + missed-run catch-up
- **D-04:** **Window = `windowStart = max(lastDigestWatermark, now − N days)`** (since-last-digest, capped, first-run floored). Only this scheme never silently drops messages across skipped/asleep runs yet caps the backlog after a multi-day outage. `N` ≈ **2–3 days** (Claude's discretion; MUST be ≤ the 30-day retention floor).
- **D-05:** Compute the watermark from **`MAX(sent_at)` of already-digested messages** (or an explicit stored window-end), **not** by comparing against `generated_at` — `sent_at` is device WhatsApp time while `generated_at` is host time; cross-clock comparison is a hazard.
- **D-06:** Idempotency relies on the shipped **`UNIQUE(jid, date)`** constraint — same-day re-runs and catch-up re-fires are harmless.
- **D-07:** **Layered catch-up** for missed 05:00 runs:
  1. **`pendingCatchup` channel (mandatory):** add `'whatsapp-digest'` to the `CatchupChannel` union; the cron seal-guard registers the channel when skipped while the DB is sealed, and the existing `onUnlock` drain runs it single-shot (NOT replay-all-ticks). Mirror `src/main/whatsapp/retention.ts` lines ~144–153 exactly.
  2. **powerMonitor-resume missed-tick check:** on wake, if `MAX(digest watermark) < startOfToday`, run the digest (covers the awake-but-slept-overnight, reopened-already-unlocked case the unlock-drain misses). Use a per-day guard to avoid wake-storm; `UNIQUE(jid,date)` absorbs overlap with #1.
  3. **Non-blocking briefing-read fallback:** if no digest row exists for today when the briefing is read, trigger generation **async/best-effort** — never block the 07:00 briefing render, never bleed an Ollama error into the briefing.

### Briefing section states & degradation (WA-10, SC1, SC4)
- **D-08:** Model the section as an **explicit discriminated-union field** on `BriefingPayload`, mirroring the shipped `thisWeekInsights` pattern:
  ```ts
  whatsApp?:
    | { state: 'ready'; groups: WhatsAppGroupSummaryDto[]; connection?: 'degraded' | 'needs-auth' }
    | { state: 'unavailable'; reason: 'model-offline'; connection?: 'degraded' | 'needs-auth' };
  // undefined => omit the section entirely
  ```
- **D-09:** **Per-group inner sub-state** (e.g. `summarized` / `no-activity` / `failed`) inside the `ready` arm — because LLM calls serialize through `p-queue`, a *partial* Ollama failure (early groups summarized, later groups left with NULL `summary_text`) is a real case; preserve good summaries rather than discarding them wholesale.
- **D-10 (state matrix):**
  - **Not linked** (no `provider_account` row, `provider_key='whatsapp'`) → **omit** the section (`undefined`). No hint.
  - **Linked, zero tracked groups** → **omit** (lean omit; a one-line "no groups tracked — manage in Settings" hint is acceptable only if UAT shows users forget they linked).
  - **Tracked group, sub-threshold activity** → **omit that group's sub-section**. Apply a **min-activity threshold ≈ ≥3 messages** (Claude's discretion) so a local-model call isn't burned on 1–2 trivial messages. If all tracked groups fall below threshold → omit the whole section.
  - **Digest failed / model offline** (no rows for today, or rows with NULL `summary_text`) → **render** header + an italic gray note: *"Digest unavailable — the local model was offline this morning. Aria will retry tonight."* plus a **Generate-now** affordance (precedent: `GenerateNowAffordance` in RecapScreen) that re-runs the digest on demand (SC4 retry). The surrounding briefing read MUST NOT throw — failure is a *data state*, not an exception.
  - **Connection degraded / needs-relink** (`provider_account.status` = `degraded` / `needs-auth`) → **render** a quiet inline line within the section (this is the Phase-20 "Phase 21 hook"). Read the status from the `provider_account` row — do NOT recompute or duplicate the AccountRow chip's authority.

### Section assembly point & file placement (WA-09, SC3)
- **D-11:** Attach `row.whatsApp` via **read-path enrichment in the `BRIEFING_TODAY` handler** (`src/main/ipc/briefing.ts`), reading pre-computed `whatsapp_group_digest` rows for the date — an exact mirror of `row.thisWeekInsights = readLatestInsights(...)`. This makes WA-09 frontier-isolation hold **by construction**: `runBriefing`'s single (frontier-capable) `generateObject` prompt is assembled and returned *before* WhatsApp content is attached, so WA text can never enter the frontier prompt. **Do NOT** add a `gatherWhatsApp` gatherer inside `runBriefing`.
- **D-12:** The **digest-generating cron file MUST live under `src/main/whatsapp/`** (e.g. `src/main/whatsapp/digest-cron.ts`) so the existing no-frontier ratchet covers it automatically (SC3). Bootstrap it in `src/main/index.ts` exactly as `startWhatsAppRetention` already is. **Cautionary precedent:** `src/main/insights/aggregate.ts` (the insights digest-equivalent) lives outside any ratchet and is frontier-capable — the WhatsApp digest generator must NOT mirror that placement.
- **D-13:** The **read-only enrichment helper** (pure indexed SELECT, calls no model) may live in `src/main/ipc/briefing.ts` outside the ratchet's scope. Annotate it `// read-only, no model` to keep the no-model contract explicit and the ratchet boundary crisp.

### Claude's Discretion
- Exact digest **prompt text** (system + per-group user prompt) within the locked exec-framing structure — the roadmap flags this as the highest-uncertainty deliverable; draft in plan phase, iterate in UAT.
- The window cap `N` (2–3 days, ≤30) and the min-activity threshold (≈3 messages) — recommended defaults, tunable in UAT.
- Whether to show the "no groups tracked" hint vs pure omit for the linked-but-empty state.
- Per-group message cap / token budget fed to the local model, and ordering of groups in the section.
- DTO field names (`WhatsAppGroupSummaryDto` shape) and the delimiter-splitter helper details.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements
- `.planning/ROADMAP.md` §"Phase 21: Digest + Briefing Integration" — goal + 4 success criteria + v2.1 locked milestone decisions
- `.planning/REQUIREMENTS.md` — WA-08, WA-09, WA-10 (this phase's requirement IDs)
- `.planning/phases/20-foundation/20-CONTEXT.md` — Phase 20 decisions; D-10 there records the briefing degraded-note as an explicit Phase 21 hook

### Milestone research (locked — follow build order/constraints)
- `.planning/research/SUMMARY.md` — full stack/feature/architecture synthesis + the frontier-prohibition pitfall
- `.planning/research/ARCHITECTURE.md` — WhatsApp module component breakdown; digest-cron placement
- `.planning/research/PITFALLS.md` — frontier-LLM ban, local-only digest, memory/queue concerns
- `.planning/research/STACK.md` — Ollama / `getLocalModel()` / local-model rationale

### Live Aria source — integration points to follow
- `src/main/ipc/briefing.ts` §`BRIEFING_TODAY` (lines ~224–244) — the read-path enrichment seam to mirror (`thisWeekInsights`); where `row.whatsApp` is attached (D-11)
- `src/main/briefing/generate.ts` — the single frontier-capable `generateObject` engine; **do NOT add a WhatsApp gatherer here** (D-11); also the try/catch→degraded-payload pattern to emulate for resilience
- `src/main/llm/providers.ts` — `getLocalModel()`, `DEFAULT_LOCAL_MODEL` (the ONLY model factory the digest may use)
- `src/main/whatsapp/retention.ts` — the cron shape to mirror (CRON_KEY / Deps / Handle / run / start factory) + the seal-guard `pendingCatchup.add` block (~lines 144–153) for D-07
- `src/main/lifecycle/pendingCatchup.ts` — `CatchupChannel` union to extend with `'whatsapp-digest'` (D-07)
- `src/main/lifecycle/onUnlock.ts` + `src/main/index.ts` (the `runChannelOnce`/drain switch + `startWhatsAppRetention` bootstrap) — where to add the digest catch-up branch and bootstrap the digest cron (D-07, D-12)
- `src/main/db/migrations/138_whatsapp.sql` — shipped `whatsapp_group_digest` (nullable `summary_text` / `generated_at` / `model_id`; `UNIQUE(jid,date)`), `whatsapp_message` (`sent_at`, `body_text`, `sender_jid`), `whatsapp_group.tracked` — NO new migration this phase
- `src/main/whatsapp/ingest.ts` — confirms the `sender_jid='self'` / group-jid write behavior behind the D-03 mention constraint
- `src/shared/ipc-contract.ts` — `BriefingPayload` (add `whatsApp` union, ~line 555 region near `thisWeekInsights`); WhatsApp `provider_account` status enum (`ok|degraded|needs-auth|disconnected`, ~line 1743)
- `src/renderer/features/briefing/BriefingScreen.tsx` (render switch ~lines 661–683) — where the WhatsApp section renders as a dumb switch over the union; `InsightsSection.spec.tsx` is the stubbed-payload test pattern to copy
- `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` — the SC3 ratchet (walks `src/main/whatsapp/**`, bans `getFrontierModel`/`getFrontierKey`/`@ai-sdk/{anthropic,openai,google}`); already GREEN, becomes load-bearing for the new digest file

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`thisWeekInsights` read-path enrichment** (`ipc/briefing.ts`): the exact precedent for attaching a side-section to the briefing payload outside the frontier call — copy its `try/catch` block shape.
- **`retention.ts` cron skeleton** (`src/main/whatsapp/`): CRON_KEY const + Deps/Handle interfaces + run fn + start factory + seal-guard + `pendingCatchup.add` — the digest cron mirrors this exactly (different time: 05:00 vs 03:30).
- **`generate.ts` degraded-payload pattern**: try/catch around the model call → degraded result, never throw to caller. Apply the same resilience so a digest failure becomes a `state:'unavailable'` data row.
- **`GenerateNowAffordance`** (RecapScreen): precedent for the Generate-now retry button in the unavailable state (D-10).
- **`InsightsSection.spec.tsx`**: stubbed-payload renderer test pattern for the new WhatsApp section.

### Established Patterns
- Briefing payload has **two assembly points by convention**: frontier LLM sections in `runBriefing` (`generate.ts`), side sections enriched at the `BRIEFING_TODAY` read handler. WhatsApp belongs to the latter.
- **Discriminated-union section state** computed in main, consumed as a pure switch in the renderer; `undefined` = omit.
- **`pendingCatchup` single-shot per-channel drain** on unlock (NOT replay-all-ticks) + powerMonitor suspend/resume.
- **No-frontier ratchet by directory** — placement under `src/main/whatsapp/` is the enforcement mechanism, not a comment.

### Integration Points
- New file: `src/main/whatsapp/digest-cron.ts` (model-calling; under ratchet) + bootstrap in `src/main/index.ts`.
- New read helper: `readWhatsAppDigests(db, date)` in/near `src/main/ipc/briefing.ts` (read-only; no model).
- `CatchupChannel` union + `runChannelOnce` switch branch for `'whatsapp-digest'`.
- `BriefingPayload.whatsApp` union + `WhatsAppGroupSummaryDto` in `ipc-contract.ts`.
- WhatsApp section component in `BriefingScreen.tsx`.

</code_context>

<specifics>
## Specific Ideas

- Exec-framing target: per tracked group, surface **key points / decisions / open questions / mentions of the user** — terse, chief-of-staff tone (consistent with the existing briefing voice).
- Degraded copy: *"Digest unavailable — the local model was offline this morning. Aria will retry tonight."* with a Generate-now retry.
- Connection-degraded line should be quiet and point to Settings, never duplicating the AccountRow chip's authority.

</specifics>

<deferred>
## Deferred Ideas

- **Ingest fix to persist participant jid + `mentionedJid`** — would enable reliable per-sender attribution and JID-based @mention detection. Out of scope here (no migration allowed); fold into **Phase 22** consideration (action-item extraction will want sender attribution anyway). Tracked against the D-03 constraint.
- **Action-item / meeting-proposal / RAG extraction consumers** — **Phase 22** (WA-F1/F2/F3), deferred pending Phase 21 digest-quality UAT.
- **Per-group / configurable retention or digest cadence** — fixed for v2.1; user-configurable cadence is a future idea.
- **Just-in-time digest blocking the briefing** — explicitly rejected; the read-path fallback (D-07.3) must stay async/best-effort.

None outside phase scope were raised by the user.

</deferred>

---

*Phase: 21-digest-briefing-integration*
*Context gathered: 2026-06-10*

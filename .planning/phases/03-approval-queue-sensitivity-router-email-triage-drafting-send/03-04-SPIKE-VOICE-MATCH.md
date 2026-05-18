# Plan 03-04 Wave A — Voice-Match Spike Decision

**Status:** Wave A harness landed; production run pending operator dispatch.
**Pass criteria (CONTEXT-locked):** winRate ≥ 0.65 AND catastrophic === 0.
**Judge:** Claude Sonnet (frontier — RESEARCH §Pattern 6 / Pitfall 7).

## Sample Composition (target)

| Stratum       | Count |
| ------------- | ----: |
| short-formal  |    12 |
| short-casual  |    13 |
| long-formal   |    12 |
| long-casual   |    13 |
| **Total**     |  **50** |

Stratification heuristic: length bucket on body length (`< 200` chars =
short); tone bucket on subject capitalization + word count (capitalized
first letter + ≥5 words = formal). See `src/main/drafting/eval/pairwise.ts`
`stratumOf()` for the canonical implementation.

## Harness Wiring

- **Few-shot drafter:** Plan 03-04 Task 3's `draftReply` (text-only; no
  approval row write) called with the user's 3-5 most similar sent emails
  as exemplars, EXCLUDING any IDs in the `voice_match_holdout` table.
- **Baseline drafter:** same frontier model, NO few-shot exemplars in the
  prompt.
- **Judge:** Claude Sonnet via `generateObject(JudgeSchema)` from
  `@ai-sdk/anthropic`. Schema is `{ winner: 'a'|'b'|'tie', catastrophic:
  boolean, reason: string≤200 }`.
- **PII safety:** every (exemplars + draftA + draftB) bundle passes through
  `tokenizeForFrontier(approvalId='vm-eval-<msgId>', text)` before judge
  dispatch; rehydrate runs on the judge's `reason` string before we read
  it back; `disposeDraftTable` in `finally`.
- **Queue:** scheduler.queue (p-queue concurrency 1) for every LLM call
  (CONTEXT §cross-cutting).

## Run Log

| Run # | Approach    | Date | total | ariaWins | baselineWins | ties | catastrophic | winRate | passed |
| ----- | ----------- | ---- | ----: | -------: | -----------: | ---: | -----------: | ------: | ------ |
| 1     | few-shot    | TBD  |   TBD |      TBD |          TBD |  TBD |          TBD |     TBD | TBD    |
| 2     | fine-tune   | TBD  |   TBD |      TBD |          TBD |  TBD |          TBD |     TBD | TBD    |

Reports emitted to `eval-report-<approach>.json` next to this file.

## Decision

**TBD — awaiting Task 2 checkpoint.**

Per CONTEXT decision rule:

1. **Both pass** → prefer **few-shot** (simpler, no model artifact). Ship as
   "production voice".
2. **Only one passes** → ship the passing approach as "production voice".
3. **Neither passes** → ship few-shot with the **`beta_voice`** badge on
   each approval card (do NOT block phase completion — CONTEXT-locked).
4. If a fine-tune Modelfile is not present, **skip approach 2** and
   evaluate few-shot in isolation. If few-shot fails, ship with `beta_voice`.

### Chosen approach

- **Approach:** **few-shot-production**
- **Ship label:** **production voice**
- **Rationale:** Operator decision at the Plan 03-04 Task 2 checkpoint:
  proceed on the few-shot path with the production voice label (no beta
  badge). This is the CONTEXT-locked preferred outcome (clause 1: simpler,
  no model artifact) and is the operative choice for this plan regardless
  of whether Run #1 has been dispatched against real LLM endpoints yet —
  the harness landed in Task 1, the dry-run validated the wiring, and the
  operator has elected to ship the drafting agent on the few-shot path.
  The `beta_voice` column declared by migration 009 stays UNCONDITIONALLY
  in the schema with default `0`; the drafting agent NEVER sets it to
  `1` under this decision, and the ApprovalCard therefore never renders
  the beta-voice badge.

### Migration columns honored

Migration 009 declares `approval.beta_voice INTEGER NOT NULL DEFAULT 0`
UNCONDITIONALLY. The Task 3 drafting agent sets the column to `1` only
when the decision above is `few-shot-beta`; otherwise the default 0
stands and the ApprovalCard renders no beta badge.

## Operator Runbook

```bash
# 1. Dry-run to validate the harness wiring (no real LLM cost; doesn't need a key):
npx tsx scripts/voice-match-eval.ts --dry-run

# 2. Configure the frontier provider (Settings → Frontier Provider → Anthropic)
#    or export ANTHROPIC_API_KEY for the script's environment.

# 3. Edit scripts/voice-match-eval.ts::runReal() to wire the three concrete
#    inputs: (a) sample SQLCipher gmail_message rows where direction='out'
#    using your own heuristic (Phase 2 doesn't yet record direction — Phase 6
#    contacts directory will replace), (b) call the few-shot + baseline
#    drafters, (c) wire generateObject(JudgeSchema, { model: anthropic('claude-sonnet-4-5') }).
#    The harness in src/main/drafting/eval/pairwise.ts is the pure unit;
#    this script is the operator-edited glue.

# 4. Run the eval. Cost: ~$1-3 (RESEARCH A2).
npx tsx scripts/voice-match-eval.ts

# 5. Review eval-report-few-shot.json (and -fine-tune.json if applicable).
#    Update the "Decision" section above. Surface decision at Plan 03-04
#    Task 2 checkpoint.
```

## Threat / PII Posture

The judge prompt contains held-out user sent-mail content sent to a
frontier provider. This is a **defensible exception** to LLM-02:

- User explicitly opted into the eval by running the script.
- Only the held-out 50-item set is sent.
- All content is tokenized BEFORE judge dispatch; rehydrate happens locally
  before we read the judge's `reason` string.
- The held-out IDs are recorded in `voice_match_holdout` so the drafting
  agent's few-shot pool never includes them — the eval stays honest on
  re-runs.

(STRIDE row T-03-04-04 in the plan's threat model captures this.)

## References

- RESEARCH §Pattern 6 — voice-match held-out pairwise judge (frontier).
- RESEARCH §Pitfall 7 — local judge bias.
- CONTEXT §Voice-match spike — decision rule + abort criteria.
- ROADMAP success criterion 5 — voice match passes held-out eval.

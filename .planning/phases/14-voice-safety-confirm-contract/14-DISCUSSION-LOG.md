# Phase 14: Voice Safety / Confirm Contract - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 14-voice-safety-confirm-contract
**Areas discussed:** Gate enforcement shape, Staged-state mapping, Voice write-path ratchet, Phase-14 contract surface
**Mode:** advisor (research-backed comparison tables; calibration tier = full_maturity / thorough-evaluator)

---

## Gate enforcement shape

| Option | Description | Selected |
|--------|-------------|----------|
| B+D — Named branch + migration | Add `'voice-explicit'` to union + dedicated `voice-forbidden-forced` error code + defense-in-depth branch; mandatory CHECK migration | ✓ |
| A+D — Implicit reuse + migration | Add `'voice-explicit'`; rely on gate.ts:89's existing `!=='explicit'` rejection; SC2 test asserts only the generic code | |
| C — Orthogonal `confirm_channel` column | Separate how-confirmed from whether-confirmed; cleaner for v2.1 multi-channel, heavier now | |

**User's choice:** Named branch + migration (B+D)
**Notes:** Research found a mandatory constraint under ALL options — every materialized form of the `approval` table pins `approval_path CHECK IN ('explicit','silent')`, so a CHECK-widening migration (live chain + `embedded.ts` snapshot) is unavoidable. The named-branch choice matches Aria's named-error-contract convention and gives SC2's failing-then-passing test an unambiguous assertion target.

---

## Staged-state mapping

| Option | Description | Selected |
|--------|-------------|----------|
| A — Map "draft" → `ready` | `ready→approved` is the only legal approve edge and the exact one the UI fires → SC4 true by construction, zero churn | ✓ |
| D — `ready` + provenance marker | Same plus a dedicated nullable field for voice provenance | |
| B — New `draft` state | First-class voice lifecycle, but parallel `draft→approved` edge breaks SC4 and touches 6+ consumers | |

**User's choice:** Map "draft" → `ready`
**Notes:** Roadmap SC1's `state='draft'` is fictional against the real machine (spec-vs-reality drift). `'voice-explicit'` from the gate decision already supplies provenance off the state axis, so plain Option A effectively delivers what D would add.

---

## Voice write-path static ratchet

| Option | Description | Selected |
|--------|-------------|----------|
| D — Combo: caller allow-list + named voice spec | Allow-list on the 3 exported chokepoints (fail-closed against any rogue caller) + a named SC3-verbatim voice spec | ✓ |
| B — Caller allow-list only | Most robust; satisfies SC3 intent but not its literal "voice handler" wording | |
| A — Vacuous voice-path test only | Reads like SC3 but silently passes if the Phase-17 handler lands at a different path | |

**User's choice:** Combo (D)
**Notes:** Research found the existing write-site ratchets guard the low-level SDK surface but NOT the exported chokepoint entry points (`sendApprovedEmail`/`applyCalendarChange`/`pushApprovedMeetingActions`) — the actual gap a voice handler would exploit. The allow-list closes it; the named spec documents intent.

---

## Phase-14 contract surface

| Option | Description | Selected |
|--------|-------------|----------|
| 2 — Contract + dormant `voiceConfirm` seam | gate/union/ratchet PLUS pure headless `voiceConfirm(db, approvalId)` in `src/main/voice/confirm.ts`; makes SC4 a literal audio-free test | ✓ |
| 1 — Contract-only | Smallest; SC2 provable via `transitionTo` in tests; Phase-17 seam left un-typed | |
| 3 — + read-back payload type | Also freeze the resolved-entities read-back type now; risks a fictional schema before any resolver exists | |

**User's choice:** Contract + dormant `voiceConfirm` seam (Option 2)
**Notes:** Matches the `writeSendLog` dormant-contract precedent; `ARCHITECTURE.md:122` already names `confirm.ts` "the load-bearing trust decision." Signature frozen at `(db, approvalId)` to immunize Phase 17 against re-litigation.

---

## Claude's Discretion

- Exact migration number/filename and in-place CHECK widening vs full table rebuild.
- Exact regex form of the two ratchet specs and where the "no voice file writes `approval_path:'explicit'`" sub-rule lands.
- Exact path of `voiceConfirm` (recommended `src/main/voice/confirm.ts`).

## Deferred Ideas

- Read-back payload type (`VoiceReadBack`) — Phase 17.
- Orthogonal `confirm_channel` column — v2.1, only if 2+ more channels arrive.
- Voice intent handler + `VOICE_CONFIRM` IPC channel — Phase 17.
- Mishear recovery — Phase 17 (VOICE-11).
- `stageVoiceAction()` dedicated staging seam — not needed; staging reuses `insertApproval`.

## Surfaced during research (carried into CONTEXT.md as D-13)

- **`ARCHITECTURE.md` §§122/306/315 is stale** — describes voice-confirm as `approval_path='explicit'`, contradicting ROADMAP/PITFALLS/SUMMARY which specify `'voice-explicit'`. The latter is correct (only it is consistent with SC2). Flagged for correction during this phase rather than silently choosing — per the user's instruction-adherence / flag-conflicts preference.

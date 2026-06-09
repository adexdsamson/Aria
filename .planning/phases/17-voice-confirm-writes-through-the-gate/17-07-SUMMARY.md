# Plan 17-07 Summary — D-17 ratchet update + no-bypass integration test + human-verify

**Status:** Code-complete; SC1–SC6 live acoustic smoke (Task 3 human-verify) DEFERRED to documented debt (user decision 2026-06-09 — proceed automated).
**Plan:** 17-07 · **Wave:** 5 · **Requirements:** VOICE-05, VOICE-08, VOICE-09, VOICE-11

## Commits
- `d84579a` test(17-07): D-17 ratchet update — voiceConfirm removed from WRITE_CHOKEPOINTS
- `9915b2d` test(17-07): voice-write-path integration test (SC2 no-bypass) + extend voice-confirm.spec.ts (SC3/D-11)
- `10fcdc3` docs(17-07): STATE.md — paused at human-verify checkpoint

## What was built

**Task 1 — D-17 ratchet update** (`tests/static/voice-streaming-no-write.spec.ts`):
- `voiceConfirm` removed from `WRITE_CHOKEPOINTS`; the list is now `[sendApprovedEmail, applyCalendarChange, pushApprovedMeetingActions, assertApproved]` — all still banned from `src/main/voice/**` + `src/renderer/features/voice/**`.
- D-17 boundary comment explains voiceConfirm is the allowed staging seam (called from `ipc/voice.ts`, outside the scan scope; routes through `transitionTo`→`assertApproved`).
- Ratchet GREEN (1/1): comment-only references in `voice-intent-router.ts` are stripped before scanning.

**Task 2 — no-bypass integration proof:**
- `tests/integration/voice-write-path.spec.ts` (NEW, 5 tests, SC2): happy path `ready→approved` stamps `approval_path='voice-explicit'` + `assertApproved` does not throw; high-severity forced row → `assertApproved` throws `voice-forbidden-forced`; legal-category forced row → same HARD GATE; cancel path `ready→cancelled` → `assertApproved` throws `not-approved` (write never dispatched); no-bypass invariant: `voiceConfirm` stamps via `transitionTo`, not raw SQL.
- `tests/integration/voice-confirm.spec.ts` extended +7 (total 17, SC3/D-11): migration 137 `foreign_key_check` empty; `user_version >= 137`; `'cancelled'` CHECK accepts raw INSERT; `ready→cancelled` ok; `cancelled→approved` / `cancelled→ready` throw `invalid-transition`; `ready→approved` unaffected.
- Typecheck 84 flat (0 new). Rule-1 fix: raw INSERT test needed `idempotency_key` (NOT NULL in migration 137).

## Verification
- Ratchet 1/1, voice-write-path 5/5, voice-confirm 17/17 — all green (run individually per the parallel-projects race).
- The **no-bypass guarantee is proven by passing tests**: no voice path reaches a raw write without `voiceConfirm`→`transitionTo`→`assertApproved`; forced/high-severity always falls back to the on-screen tap.

## DEFERRED — human-verify (Task 3, SC1–SC6 live acoustic)
Requires `pnpm dev` + mic + speakers; cannot be automated. Steps (see 17-07-PLAN.md / checkpoint report):
1. SC1 — voice `/ask` via same in-process service.
2. SC2 — "schedule…/draft…" → resolved-entity read-back → "yes" → write; ApprovalCard shows staged row.
3. SC3 — PTT/Cancel mid-read-back → row `'cancelled'`, toast, no write.
4. SC4 — enable cloud (consent modal); sensitive turn routes local despite opt-in.
5. SC5 — speed 1.5× honored next turn; useCloud per-turn.
6. D-07 — forced/high-severity row → `explicit-required` chip, voice-confirm suppressed.

Resume signal: run SC1–SC6, report results. This is the only open item for 17-07.

## Decisions
- D-17 ratchet: minimal change (drop voiceConfirm only); voice-intent-router guard comments are comment-only (stripped by the ratchet).
- No-bypass proven structurally (ratchet) + behaviorally (integration test) — the two halves of the write-path safety contract.

---
id: 260523-eaf
slug: onboarding-name-personalization
date: 2026-05-23
status: complete
commit: 74af0e8
spec: docs/superpowers/specs/2026-05-23-onboarding-name-personalization-design.md
---

# Summary — Onboarding name personalization

## Outcome

Personalized UnlockScreen greeting wired end-to-end. `Good morning, Adex.` (or whichever name) replaces the generic `Good morning. Welcome back` on the daily-unlock screen. Falls back cleanly to the generic form whenever no name is set (fresh install, restore-from-mnemonic on new machine, profile.json read failure).

Wizard reshuffled from 4 to 5 steps:
1. **Name** — new (this change)
2. Recovery phrase — show
3. Recovery phrase — confirm
4. Personalise your briefing (country + sectors)
5. Seal your vault (password)

## What shipped

| File | Kind | Purpose |
|---|---|---|
| `src/main/profile/store.ts` | new | Pure-function `readProfile` (null-on-failure) + `writeProfileAtomic` (validates non-empty trimmed string). |
| `src/main/ipc/profile.ts` | new | `PROFILE_GET` / `PROFILE_SET` handlers; no DB dependency; trims before persisting. |
| `src/main/ipc/index.ts` | edit | Register profile handlers right after onboarding — pre-unlock path. |
| `src/shared/ipc-contract.ts` | edit | `PROFILE_GET` / `PROFILE_SET` added to `CHANNELS`, `CHANNEL_METHODS`, `AriaApi`. |
| `src/renderer/features/onboarding/NameStep.tsx` | new | Step 1 of 5; autofocus input; Continue disabled until trimmed non-empty. |
| `src/renderer/features/onboarding/OnboardingWizard.tsx` | edit | `'name'` step added; `displayName` state; `profileSet` invoked in `seal()` before `newsSetBundle`; password eyebrow `Step 4 of 4` → `Step 5 of 5`. |
| `src/renderer/features/onboarding/MnemonicShow.tsx` | edit | Eyebrow `Step 1 of 4` → `Step 2 of 5`. |
| `src/renderer/features/onboarding/MnemonicConfirm.tsx` | edit | Eyebrow `Step 2 of 4` → `Step 3 of 5`. |
| `src/renderer/features/onboarding/CountrySectorPicker.tsx` | edit | Eyebrow `Step 3 of 4` → `Step 4 of 5`. |
| `src/renderer/features/onboarding/UnlockScreen.tsx` | edit | New `displayName` state + mount effect calling `profileGet()`; greeting strings lost trailing period; new `formatGreeting(base, displayName)` helper. |

## Tests

| Spec | Cases | Status |
|---|---|---|
| `tests/unit/main/profile/store.spec.ts` (new) | 11 | ✓ all pass |
| `tests/unit/main/ipc/profile.spec.ts` (new) | 7 | ✓ all pass |
| `tests/unit/renderer/features/onboarding/NameStep.spec.tsx` (new) | 6 | ✓ all pass |
| `tests/unit/renderer/features/onboarding/CountrySectorPicker.spec.tsx` (updated) | 6 | ✓ all pass (regression check for new step order) |

**Total: 30/30 pass.** Typecheck clean for all touched files.

## Decisions locked

All four decisions came from `AskUserQuestion` during brainstorming:

1. **Scope:** just the greeting (not drafted outputs, not full identity object).
2. **Placement:** new first step before mnemonic (5-step wizard).
3. **Validation:** required, non-empty after `trim()`.
4. **Storage:** plaintext `profile.json` sibling to `vault.json` (UnlockScreen runs pre-unlock so the encrypted DB is unreachable; `vault.json` schema is locked).

## Surprises mid-execution

- Spec said "only password step has numbered eyebrow." Codebase reality: **all four** steps display `Step N of 4`. Caught during execution, renumbered all four to `Step N of 5`. Pattern: [[feedback-spec-vs-codebase-reality]].
- Tests blocked on the documented better-sqlite3 EBUSY lock because Aria desktop was running. Closing the app fixed it. Pattern: [[reference-better-sqlite3-abi-lock]].
- Pre-existing baseline: `tests/unit/main/ipc/index.spec.ts` handler-count invariant fails `2 of 4`. Confirmed via stash-test on master that this fails identically without my changes — not introduced here.

## Known follow-ups (deferred)

- Restore-from-mnemonic on a fresh machine has no `profile.json` (lives outside DB backup). UnlockScreen falls back to the generic greeting. Acceptable for v1.
- Settings UI to edit the name later. Add when the user asks.
- Briefing salutation / recap headers / draft signatures using the name. Defer until the user asks.

## Verification not yet done

- **Live UAT** — run the desktop app, walk fresh onboarding, confirm `Good morning, <name>.` renders on the next unlock. Pre-existing baseline test suite blocked the dual-build during this commit; the user should verify manually before relying on the feature.

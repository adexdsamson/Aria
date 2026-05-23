# Onboarding name personalization — design spec

**Date:** 2026-05-23
**Status:** Awaiting user review
**Routing target:** `/gsd-quick`

## Problem

The onboarding wizard collects a mnemonic, a news-bundle, and a daily password, but never asks the user's name. UnlockScreen — the first surface every day — shows a generic "Good morning." "Welcome back" greeting that feels impersonal for an app marketed as a chief-of-staff. The user wants the app to feel personalized starting from the first interaction.

## Scope

In scope:
- Add a `displayName` field collected as the **first step** of onboarding.
- Persist it to a new plaintext `profile.json` file in `dataDir`.
- Read it in `UnlockScreen` and render the greeting as `Good morning, <name>.`.

Explicitly out of scope (deferred until user asks):
- Using the name in briefing prose, recap docs, email-draft signatures, or any LLM prompt.
- Pronouns, role, title, or any other identity fields.
- Settings UI to edit the name later. (User can re-onboard or manually edit `profile.json`; a Settings affordance is a future ticket.)

## Decisions locked

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | How wide does "personalized" reach? | Just the greeting | User selection. Keeps blast radius minimal; LLM prompts stay unchanged. |
| 2 | Where in the 4-step wizard does the name input live? | New first step, before mnemonic-show. Wizard becomes 5 steps. | Sets the personal tone from the very first screen; matches the welcome ritual. |
| 3 | How should the name field behave? | Required, non-empty after `trim()` | Continue disabled until a character is typed. UnlockScreen never falls back. No new IPC for OS username. |
| 4 | Storage location? | New plaintext `profile.json` in `dataDir`, sibling to `vault.json`. | UnlockScreen runs **pre-unlock** so the encrypted DB is unreachable. `vault.json` schema is locked (`v: 1`, kdf/cipher/appSalt/kdfCheck only) and serves a pure key-storage role — polluting it with profile data crosses that boundary. First-name sensitivity ≈ news-bundle sensitivity, which Aria already accepts. |
| 5 | When is the name persisted? | Buffered in wizard state during onboarding, written inside `seal()` right alongside the existing `newsSetBundle` call. | Mirrors the established `newsSelection` pattern. Single persistence point. If seal fails, user re-enters on retry. |

## Architecture

### Main-process: `src/main/profile/store.ts`

New module, mirrors the shape of `src/main/vault/storage.ts`.

```ts
export interface Profile {
  displayName: string;
}

export function profilePathOf(dataDir: string): string {
  return path.join(dataDir, 'profile.json');
}

export function readProfile(dataDir: string): Profile | null {
  // Returns null on: file missing, JSON parse error, schema mismatch.
  // Never throws — caller may run pre-unlock.
}

export function writeProfileAtomic(dataDir: string, profile: Profile): void {
  // tmp-write + rename, same idiom as writeVaultJsonAtomic.
  // Validates displayName is a non-empty trimmed string.
}
```

### IPC channels (`src/shared/ipc-contract.ts`)

Two new channels under the `PROFILE_*` family:

```ts
PROFILE_GET = 'aria:profile:get'
PROFILE_SET = 'aria:profile:set'
```

Contracts:

| Channel | Request | Response | Pre-unlock? |
|---|---|---|---|
| `PROFILE_GET` | `{}` | `{ displayName: string \| null }` | **Yes** — handler reads `profile.json` directly via `readProfile(dataDir)`; never touches `dbHolder`. |
| `PROFILE_SET` | `{ displayName: string }` | `{ ok: true } \| { ok: false, error: string }` | **Yes** — same; writes `profile.json` directly. |

Handler module: `src/main/ipc/profile.ts` (mirrors the registration pattern of `src/main/ipc/onboarding.ts`). Registered once at boot (no db-dependency to skip).

Preload exposes `window.aria.profileGet()` / `window.aria.profileSet({ displayName })`.

### Renderer: new component `src/renderer/features/onboarding/NameStep.tsx`

- Centered card, left gold gutter, Playfair italic — matches `UnlockScreen` and the current password step.
- Eyebrow: `Step 1 of 5 · introduce yourself`.
- H1: `What should Aria call you?`.
- Subline: `This stays on your machine. You can change it any time in Settings.`
- Single text input, autofocus, letterpress baseline matching the unlock field.
- Primary button `Continue`, disabled when `displayName.trim().length === 0`.
- `data-testid`s: `onboarding-name`, `name-input`, `name-submit`.

### Renderer: `OnboardingWizard.tsx` changes

- Add `'name'` to the `Step` union and make it the first step after `'loading'` resolves.
- Add `displayName: string` to wizard state.
- The mnemonic IPC still fires in the existing `useEffect`; its result is held until the user clicks Continue on the name step.
- Inside `seal()`, after `res.ok` is `true`, call `window.aria.profileSet({ displayName })` **before** the existing `newsSetBundle` call. Same non-blocking error handling: log a warning, do not abort `onComplete()`.
- Update the password step's eyebrow from `Step 4 of 4` to `Step 5 of 5`. No other step displays a numbered eyebrow.

### Renderer: `UnlockScreen.tsx` changes

- New `useState<string | null>(null)` for `displayName`.
- New `useEffect` on mount calls `window.aria.profileGet()` and sets state.
- Change `greetingForHour(h)` to return strings without the trailing period (`'Good morning'`, `'Quiet hours'`, etc.).
- Render:
  ```tsx
  <p>{displayName ? `${greeting}, ${displayName}.` : `${greeting}.`}</p>
  ```
- A brief one-frame "Good morning." → "Good morning, Adex." flash is acceptable. The input still autofocuses immediately so it isn't on the user's eye path.

## Data flow

```
Onboarding step 1                       OnboardingWizard.seal()
─────────────────                       ──────────────────────
NameStep                                seal() succeeds
  user types "Adex"                       ↓
  Continue                              window.aria.profileSet({ displayName })
    ↓                                     ↓ (non-blocking)
  setDisplayName('Adex')                src/main/ipc/profile.ts
  setStep('show')                         ↓
                                        writeProfileAtomic(dataDir, { displayName })
                                          ↓
                                        profile.json on disk

Daily unlock                            UnlockScreen mount
────────────                            ──────────────────
profile.json on disk                    useEffect → window.aria.profileGet()
  ↓                                       ↓
readProfile(dataDir)                    src/main/ipc/profile.ts
  ↓                                       ↓
{ displayName: 'Adex' }                 readProfile(dataDir)
                                          ↓
                                        setDisplayName('Adex')
                                          ↓
                                        <p>Good morning, Adex.</p>
```

## Error handling

- `readProfile` returns `null` on any failure (missing file, parse error, schema mismatch). `UnlockScreen` falls back to the generic greeting. No error surfaced to the user.
- `writeProfileAtomic` validates `displayName` is a non-empty trimmed string. Throws on invalid input; the IPC handler catches and returns `{ ok: false, error: '...' }`.
- If `profileSet` fails during `seal()`, log a warning (same pattern as the existing `newsSetBundle` post-seal failure) and proceed with `onComplete()`. UnlockScreen will show the generic greeting until the user re-onboards.

## Known follow-ups (NOT in this change)

1. **Restore-from-mnemonic on a fresh machine** has no `profile.json` (it lives outside the DB backup). User sees the generic greeting until they re-set the name. Acceptable for v1.
2. **Settings UI** to edit the name later. Add when the user asks.
3. **Briefing salutation** using the name. Defer until the user asks.

## Test coverage to add

- Unit: `readProfile` returns `null` on missing file, malformed JSON, and schema mismatch.
- Unit: `writeProfileAtomic` round-trips correctly; rejects empty/whitespace-only names.
- Component: `NameStep` disables Continue when input is empty or whitespace.
- Component: `OnboardingWizard` shows `NameStep` first after `'loading'`.
- E2E (existing onboarding Playwright spec): extend to type a name on the new first step; assert UnlockScreen renders `Good morning, <name>.` on the subsequent unlock.

## Files touched

| File | Change |
|---|---|
| `src/main/profile/store.ts` | **NEW** — read/write helpers + path. |
| `src/main/ipc/profile.ts` | **NEW** — registers `PROFILE_GET` / `PROFILE_SET`. |
| `src/main/ipc/index.ts` | Register `profile` handlers at boot (mirror onboarding pattern). |
| `src/shared/ipc-contract.ts` | Add `PROFILE_GET`, `PROFILE_SET` to `CHANNELS`. |
| `src/preload/index.ts` | Add `profileGet`, `profileSet` to the `aria` bridge. |
| `src/renderer/features/onboarding/NameStep.tsx` | **NEW** — name step component. |
| `src/renderer/features/onboarding/OnboardingWizard.tsx` | Add `'name'` step, state, IPC call inside `seal()`, renumber eyebrow. |
| `src/renderer/features/onboarding/UnlockScreen.tsx` | Add useEffect + state, drop trailing period from greeting, conditional render. |
| `tests/...` | New unit / component / E2E coverage per above. |

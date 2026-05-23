---
id: 260523-eaf
slug: onboarding-name-personalization
date: 2026-05-23
status: in-progress
spec: docs/superpowers/specs/2026-05-23-onboarding-name-personalization-design.md
---

# Quick task — Onboarding name personalization

Add a display-name step as the first step of onboarding so the app feels personalized. Store it in a new plaintext `profile.json` (sibling to `vault.json`) since `UnlockScreen` runs pre-unlock and can't reach the encrypted DB. Render it as `Good morning, <name>.` on the unlock screen, falling back to the generic greeting when absent.

Spec: [2026-05-23-onboarding-name-personalization-design.md](../../../docs/superpowers/specs/2026-05-23-onboarding-name-personalization-design.md)

## Tasks (atomic commits)

1. **Add PROFILE_GET / PROFILE_SET to the IPC contract.** Add channels to `CHANNELS`, method names to `CHANNEL_METHODS`, and method signatures to `AriaApi` in `src/shared/ipc-contract.ts`. No behaviour yet; preload auto-mapping picks them up.
2. **Create `src/main/profile/store.ts`.** Pure-function module mirroring `src/main/vault/storage.ts`:
   - `profilePathOf(dataDir)` → `<dataDir>/profile.json`
   - `readProfile(dataDir): { displayName: string } | null` — returns `null` on ENOENT, JSON parse error, or schema mismatch; never throws.
   - `writeProfileAtomic(dataDir, profile): void` — validates `displayName` is a non-empty trimmed string; tmp-file + atomic rename.
3. **Create `src/main/ipc/profile.ts`.** Mirrors `registerOnboardingHandlers` shape:
   - `PROFILE_GET` → `{ displayName: string | null }`; reads via `readProfile`; never throws.
   - `PROFILE_SET` → `{ ok: true } | { ok: false, error: string }`; validates and writes atomically.
4. **Wire `registerProfileHandlers` in `src/main/ipc/index.ts`.** Register at boot (no DB dependency, no `skipChannels` poisoning gotcha). Goes right after `registerOnboardingHandlers`.
5. **Create `src/renderer/features/onboarding/NameStep.tsx`.** Editorial centered card, left gold gutter, Playfair italic, letterpress input; props `{ initialValue?: string; onContinue: (displayName: string) => void }`. data-testids: `onboarding-name`, `name-input`, `name-submit`.
6. **Update `OnboardingWizard.tsx`.** Add `'name'` to the `Step` union as the first post-`loading` step. Add `displayName` state. Inside `seal()` after `res.ok`, call `window.aria.profileSet({ displayName })` before the existing `newsSetBundle` block, with the same non-blocking error handling. Renumber the password step eyebrow from `Step 4 of 4` to `Step 5 of 5`.
7. **Update `UnlockScreen.tsx`.** Add `displayName` state + mount-effect calling `window.aria.profileGet()`. Drop the trailing period from each `greetingForHour` string. Render `{displayName ? '${greeting}, ${displayName}.' : '${greeting}.'}`.
8. **Add tests.**
   - Unit: `tests/main/profile/store.spec.ts` covers round-trip + null returns for missing/malformed files + rejection of empty/whitespace names.
   - Unit: `tests/main/ipc/profile.spec.ts` covers `PROFILE_GET` + `PROFILE_SET` IPC contracts.
   - Renderer: extend or add a Vitest spec for `NameStep` (continue disabled when empty/whitespace).
   - Renderer: extend `OnboardingWizard` spec to assert `name` is the first post-`loading` step and that `profileSet` is invoked inside `seal()`.
9. **Verify.** Run `npm run lint` (or equivalent) + `npm run typecheck` + `npm test` (subset for the new specs + smoke). Commit each task above atomically.
10. **Write SUMMARY.md + update STATE.md** "Quick Tasks Completed" table.

## Non-goals (deferred)

- Settings UI to edit the name later.
- Briefing salutation, recap headers, draft signatures, or any LLM-prompt usage.
- Restoring `profile.json` from backup. (Documented edge case in spec.)

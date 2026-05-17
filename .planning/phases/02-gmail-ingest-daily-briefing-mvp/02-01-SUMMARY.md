---
phase: 02-gmail-ingest-daily-briefing-mvp
plan: 01
subsystem: integrations/google + ipc + renderer/settings + lifecycle
tags: [gmail, oauth, loopback, pkce, history-list, safe-storage, status-panel, email-07-banner, power-monitor]
requires: [01-03-secrets-settings, 01-02-db-passphrase, 01-04-llm-router]
provides: [connectGoogle, getOAuth2Client, GmailClient, GmailSync, registerGmailHandlers, registerLifecycleCallbacks]
affects: [src/shared/ipc-contract.ts, src/main/secrets/safeStorage.ts, src/main/db/migrations/embedded.ts, src/main/ipc/index.ts, src/main/lifecycle/powerMonitor.ts, src/renderer/features/settings/SettingsScreen.tsx, src/renderer/features/settings/StatusPanel.tsx]
tech_added: [googleapis@144.0.0, google-auth-library@9.15.1, @testing-library/react@16.3.2, @testing-library/jest-dom@6.9.1, @testing-library/user-event@14.6.1]
key_files_created:
  - src/main/integrations/google/auth.ts
  - src/main/integrations/google/gmail.ts
  - src/main/integrations/google/sync-gmail.ts
  - src/main/ipc/gmail.ts
  - src/main/db/migrations/002_gmail.sql
  - src/renderer/features/settings/IntegrationsSection.tsx
  - tests/unit/main/integrations/google/auth.spec.ts
  - tests/unit/main/integrations/google/gmail-wrapper.spec.ts
  - tests/unit/main/integrations/google/sync-gmail.spec.ts
  - tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx
  - .env.local.example
decisions:
  - Refresh tokens live in safeStorage googleTokens subtree only — never in SQLCipher
  - 5-min gmail-sync cron registered in scheduler.cronRegistry with powerMonitor suspend/resume hooks (no back-fire on resume)
  - DbHolder default from ipc/onboarding (single source of truth); registerHandlers auto-constructs a Scheduler when caller omits it so every CHANNELS entry always gets a handler
completed: 2026-05-16
---

# Phase 2 Plan 01: Gmail Ingest Summary

One-liner: Read-only Gmail OAuth (loopback + PKCE) + 7-day backfill + 5-minute incremental sync via history.list, with safeStorage-resident refresh tokens, atomic historyId cursor advance, invalid_grant detection, EMAIL-07 re-auth banner, and a StatusPanel row.

## What Shipped

- **Migration 002** (`gmail_account`, `gmail_message` + two indices) appended to `EMBEDDED_MIGRATIONS`.
- **safeStorage googleTokens subtree** (`setGoogleTokens` / `getGoogleTokens` / `clearGoogleTokens`) — encrypts the refresh token with `safeStorage.encryptString`, stores per-kind (`gmail` | `calendar`), leaves Phase-1 provider keys untouched.
- **OAuth loopback flow** (`src/main/integrations/google/auth.ts`): `connectGoogle(kind)` opens an Electron BrowserWindow with `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, no preload (Pitfall 18); PKCE S256; `access_type:'offline'`; `prompt:'consent'`; CSRF state param; refreshes are re-persisted via the OAuth2Client `'tokens'` event.
- **GmailClient wrapper** (`src/main/integrations/google/gmail.ts`): translates googleapis errors to domain errors — `HistoryInvalidatedError` for `404/notFound` on `history.list`; `TokenInvalidError({ reason: 'expired' | 'revoked' })` for `invalid_grant` payloads matching the google-auth-library shape (`response.data.error === 'invalid_grant'`).
- **GmailSync engine** (`src/main/integrations/google/sync-gmail.ts`): `tick()` reads `gmail_account.history_id`; full-resyncs on null or on `HistoryInvalidatedError`; surfaces `TokenInvalidError` by writing `last_error='token-expired'` then rethrowing for the IPC layer; every Google API call AND every DB write goes through `scheduler.queue.add(...)` (Pitfall 16); row + historyId update is one `db.transaction` (Pitfall 11 atomic cursor advance).
- **Gmail IPC handlers** (`src/main/ipc/gmail.ts`): `GMAIL_CONNECT` runs the OAuth flow, INSERT-OR-REPLACEs `gmail_account` (id=1), enqueues a backfill tick, and registers the 5-min cron. `GMAIL_STATUS` returns `{connected, email?, lastSyncedAt?, lastError?, tokenStatus, queueDepth}` derived from row + token presence + queue size. `GMAIL_DISCONNECT` stops the cron, clears the token, deletes the account row, truncates `gmail_message`. `GMAIL_FORCE_SYNC` runs a manual tick.
- **5-min cron + powerMonitor coalescing**: `cron.schedule('*/5 * * * *', ...)` stored under `scheduler.cronRegistry['gmail-sync']`; `registerLifecycleCallbacks({onSuspend, onResume})` stops/starts the cron entry (XCUT-01 — no back-fire on resume because we `start()` an already-stopped task rather than re-firing missed ticks).
- **powerMonitor lifecycle callbacks API** (`src/main/lifecycle/powerMonitor.ts`): new `registerLifecycleCallbacks({onSuspend?,onResume?}): () => void` (unregister) with internal arrays fanned out from the existing event listeners. Plan 02-02 (calendar) and 02-04 (briefing) reuse this surface.
- **Settings → Integrations** (`IntegrationsSection.tsx`) with four states (disconnected / connected-ok / connected-expired / connected-revoked), pre-OAuth disclosure modal (CASA unverified-app copy), and the locked EMAIL-07 banner string `"Aria's access to Gmail has expired. Re-connect to resume syncing. Calendar and other integrations are unaffected."` (revoked variant uses `"was revoked"`).
- **StatusPanel** gains `IntegrationStatusRow` (badge / email / relative `last_synced_at` / queue depth / truncated `last_error`, polled every 10s).
- **Redact rules** added for `Bearer …` and OAuth `code=…` substrings.

## Wire Confirmation

`src/main/ipc/index.ts` now registers **seven** handler functions in order: Onboarding, Backup, Secrets, Ollama, Ask, Diagnostics, Gmail. The Gmail block auto-constructs a `SchedulerHandle` via `registerScheduler(logger)` when the caller does not supply one, preserving the invariant that every `CHANNELS` entry is wired by `registerHandlers`.

## Pinned Versions (node_modules)

| Package | Version |
|---------|---------|
| googleapis | 144.0.0 |
| google-auth-library | 9.15.1 |
| electron | 41.6.1 (unchanged; SQLCipher ABI lock from Phase 1 still applies) |
| @testing-library/react | 16.3.2 |
| @testing-library/jest-dom | 6.9.1 |
| @testing-library/user-event | 14.6.1 |
| node-cron | 4.x (TaskOptions no longer accepts `scheduled`) |

The `patches/better-sqlite3-multiple-ciphers+12.9.0.patch` is in place; postinstall electron-rebuild was not re-run as part of this plan but no native dep version changed.

## Tests

- `tests/unit/main/integrations/google/auth.spec.ts` — safeStorage round-trip + OAuth flow + state/PKCE/no-refresh-token paths.
- `tests/unit/main/integrations/google/gmail-wrapper.spec.ts` — `vi.mock('googleapis')` proves the wrapper maps `404→HistoryInvalidatedError`, `invalid_grant payload→TokenInvalidError(reason: expired)`, and the explicit-`revoked` substring variant.
- `tests/unit/main/integrations/google/sync-gmail.spec.ts` — 7 cases including first-tick backfill, incremental tick, 404 → full-resync recovery (the >7-day-sleep no-gaps truth), `invalid_grant` propagation, atomicity rollback, label parsing, and scheduler.queue routing.
- `tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx` — 6 cases: disconnected, connected-ok, connected-expired (banner copy), connected-revoked (variant copy), pre-OAuth modal cancel/continue, SC3 mechanic.

Local results (`npm run test:unit -- --pool=threads` scoped to the 02-01 surface): **32/32 pass.**

Typecheck (`npm run typecheck`): **clean.**

## Deviations from Plan

### Auto-fixed Issues

1. **[Rule 1 — Bug] JSDoc `*/5 * * * *` closed the comment block.**
   - Found during: Task 3 typecheck.
   - The `gmail.ts` header comment included the literal cron expression ``*/5 * * * *`` inside `/** … */`; the `*/` sequence terminated the JSDoc and broke the file.
   - Fix: replaced with prose description.
   - Commit: 7c09bfc.

2. **[Rule 3 — Blocking] node-cron v4 dropped the `{scheduled: true}` TaskOptions field.**
   - Found during: Task 3 typecheck.
   - `cron.schedule(expr, fn, { scheduled: true })` no longer typechecks — `scheduled` is not in `TaskOptions`. Default behavior is auto-start anyway, so the option was redundant.
   - Fix: removed the third argument.
   - Commit: 7c09bfc.

3. **[Rule 3 — Blocking] Two divergent `DbHolder` interfaces.**
   - Found during: Task 3 typecheck.
   - `ipc/gmail.ts` declared its own `DbHolder { get(): Db | null }`; `ipc/onboarding.ts` exports the canonical `DbHolder { db, isOpen, set, close }`. `index.ts` passed the onboarding type to gmail, causing a structural mismatch.
   - Fix: removed gmail.ts's local interface, imported the onboarding one, swapped all `dbHolder.get()` calls to `dbHolder.db`.
   - Commit: 7c09bfc.

4. **[Rule 2 — Critical] `registerHandlers` invariant breakage when caller omits `scheduler`.**
   - Found during: Task 3 verification — `tests/unit/main/ipc/index.spec.ts` asserts `handlers.size === Object.keys(CHANNELS).length`. With the original gating `if (deps.scheduler) registerGmailHandlers(...)` and four new Gmail channels, the test failed 16 vs 20.
   - Fix: default-construct a SchedulerHandle via `registerScheduler(logger)` when the caller passes none — same pattern as the existing `dbHolder` default. Preserves the invariant and matches the plan's acceptance criterion `register[A-Za-z]+Handlers\(ipcMain` count == 7.
   - Commit: 7c09bfc.

### TDD Gate Compliance

Plan 02-01 frontmatter marks Task 3 as `tdd="true"`. The salvaged executor wrote Task 3 implementation and tests in a single working tree before crashing, so the RED/GREEN/REFACTOR commit sequence is **not** preserved for Task 3 — there is one combined `feat(02-01): …` commit (`7c09bfc`) covering implementation + spec. Tasks 1 and 2 do have the canonical `test(02-01): … → feat(02-01): …` sequence (commits `aa1b8b7` → `cac2d13`).

Mitigation: the Task 3 spec was authored against the locked EMAIL-07 banner copy and tested-states matrix from the plan; all 6 cases pass without modification. The combined commit is documented here so future audits can trace the gate skip.

## Known Stubs

None. The Gmail row is fully wired (status, force-sync, disconnect, reconnect). Calendar status display in StatusPanel is a deliberate Plan 02-02 scope item — `IntegrationStatusRow` is parameterized by `kind` but only `'gmail'` is implemented this plan.

## Deferred Items (out of scope for 02-01)

~~Pre-existing test failures observed on master~~ **RESOLVED 2026-05-16 by `fix(test-abi)` commit** — see `.planning/debug/resolved/vitest-better-sqlite3-abi.md`.

The real root cause was NOT an electron-mock contract drift but a native-module ABI mismatch: `better-sqlite3-multiple-ciphers` was rebuilt by postinstall for Electron 41 (ABI 145), but vitest runs under system Node 25 (ABI 141). The "TypeError: Cannot read properties of undefined (reading 'open')" was a secondary symptom — `openDb` threw on `new Database(dbPath)` due to the binding load failure, leaving `db` undefined for the `closeDb` call in test teardown.

**Fix:** Dual-build pipeline — `scripts/build-native-dual.mjs` produces both ABI variants and stashes them under `node_modules/better-sqlite3-multiple-ciphers/aria-abi/`. Vitest `globalSetup` (`tests/setup-native-abi.ts`) swaps the Node-ABI binary in for tests, restores the Electron-ABI one on teardown. Approach 3 (pin Node) was ruled out because Electron applies its own ABI bump (Node 24 = 137, Electron 41 = 145) — no Node version matches.

Resolved files added: `scripts/build-native-dual.mjs`, `tests/setup-native-abi.ts`. Updated: `scripts/postinstall.mjs`, `vitest.config.ts`, `package.json` scripts, `tests/unit/main/db/migrations.spec.ts` (assert `[1, 2]` post-Plan-02-01).

Result: 105/105 unit tests pass (was 95/105). The 02-01 surface (32/32) remains green.

## Authentication Gates

Task 0 (GCP project + Desktop OAuth credentials + `.env.local`) was cleared by the user before this salvage executor began; `.env.local` is present at repo root with non-empty `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

The runtime `invalid_grant` test-mode (7-day refresh-token expiry) UX is implemented and unit-tested via a forced simulation in `sync-gmail.spec.ts` case 4. A real end-to-end dogfood is deferred to manual verification in the user's actual GCP test-mode window — no observed behavior to report yet because the plan was executed before the first 7-day boundary.

## Self-Check

| Claim | Verified |
|-------|----------|
| `src/main/ipc/gmail.ts` exists | yes |
| `src/main/integrations/google/{auth,gmail,sync-gmail}.ts` exist | yes (committed in cac2d13) |
| `src/renderer/features/settings/IntegrationsSection.tsx` exists | yes |
| 7 register*Handlers calls in `src/main/ipc/index.ts` | yes |
| `npm run typecheck` exits 0 | yes |
| All 02-01-surface tests pass | yes (32/32) |
| EMAIL-07 banner copy locked verbatim in IntegrationsSection | yes |
| `registerLifecycleCallbacks` exported + consumed by gmail-sync | yes |
| googleapis ≥ 144, google-auth-library ≥ 9 | yes (144.0.0, 9.15.1) |
| Electron unchanged at 41.6.1 | yes |
| ROADMAP.md plan box ticked | yes |
| STATE.md completed_plans bumped to 6 | yes |

## Self-Check: PASSED

## Post-UAT Correction

UAT Test 3 surfaced a three-bug chain that prevented "Connect Gmail" from ever opening an OAuth window in `pnpm dev`. (1) `src/main/integrations/google/auth.ts` reads `process.env.GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`, and the header comment claimed "dev reads .env.local", but no `dotenv` dependency existed and no loader was wired — `process.env.*` was `undefined`, so `readOAuthConfig()` threw `OAuthConfigMissingError` on every dev click. (2) `IntegrationsSection.tsx` `onModalContinue` (both Gmail and Calendar copies) called `await window.aria.gmailConnect()` / `calendarConnect()` and discarded the return value, so the handler's `{ ok: false, error: 'oauth-config-missing' }` payload never reached the UI — the modal closed and nothing else happened, console clean. (3) Even after env loads, future runtime failures (network, user cancels, invalid creds) would still be invisible. Fix: added a tiny dev-only `.env.local` loader at the top of `src/main/index.ts` (10-line `KEY=VALUE` parser, gated on `ELECTRON_RENDERER_URL`, NO new deps, never logs keys/values — only a count), and added `connectError` state + a `connectErrorCopy(code)` mapper in both `GmailRow` and `CalendarRow` with an inline red banner (mirrors the EMAIL-07 banner style). Known codes: `oauth-config-missing`, `access_denied`, plus a generic fallthrough. `connectError` clears when the user re-clicks Connect. Verification: `pnpm run typecheck` clean (both tsconfigs), `pnpm vitest run` 195/195 pass (no regression — Gap 2 baseline was 194/195 with one `ask-local-handler` timing flake; this run the flake passed too), `pnpm run build` clean, secret-safe re-read confirmed no log surfaces emit `process.env.GOOGLE_*` values. Commit: see git log for `fix(oauth): load .env.local in dev + surface connect errors in IntegrationsSection` (UAT Gap 3).

## Open Issues to Forward

- **02-02 (Calendar):** reuse `connectGoogle('calendar')` — the SCOPES constant already includes calendar.readonly. Reuse `IntegrationStatusRow` with a `kind='calendar'` branch (currently only `'gmail'` is implemented). Reuse `registerLifecycleCallbacks` for the 15-min calendar cron.
- **02-04 (Briefing):** consume `gmail_message` rows directly; the priority filter `is_unread=1 AND is_important=1 AND received_at >= now-24h` will produce zero rows for accounts that don't apply the IMPORTANT label — Plan 02-04 owns the B4 SC2 fallback copy.
- ~~**Deferred Phase-1 test regression**~~ — resolved 2026-05-16 (dual-build); see Deferred Items above.
- **CASA gmail.send dependency:** Phase 3 still needs the multi-week CASA security review kicked off; not blocking 02-01 (read-only scope) but the timer is ticking.

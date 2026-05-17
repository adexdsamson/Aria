---
status: testing
phase: 02-gmail-ingest-daily-briefing-mvp
source:
  - 02-01-SUMMARY.md
  - 02-02-SUMMARY.md
  - 02-03-SUMMARY.md
  - 02-04-SUMMARY.md
started: 2026-05-17T05:30:00.000Z
updated: 2026-05-17T07:15:00.000Z
mode: mvp
user_story: "As a busy SMB executive, I want to connect Gmail and Google Calendar to Aria and have it ingest mail and events locally on a schedule, so that I can read a daily briefing without giving Aria send or write permissions yet."
---

## Current Test

number: 3
name: Connect Gmail (read-only)
expected: |
  Settings → Integrations → "Connect Gmail" opens an OAuth browser window
  scoped to `gmail.readonly` only. After approval the window closes; the
  Gmail row in IntegrationsSection flips to connected with the account
  email displayed.
awaiting: user response

## Tests

### 1. Cold Start Smoke Test
expected: |
  `pnpm dev` boots Electron cleanly; onboarding wizard appears on fresh
  profile or unlock screen on returning profile. No native-module load
  errors. SQLCipher DB opens without warnings.
result: pass
notes: |
  Initial run failed (renderer blank). Root cause: strict prod CSP applied
  in dev blocked Vite React Fast-Refresh inline script + HMR WebSocket.
  Resolved by commit 8c4c010 fix(dev-csp). After re-run: onboarding wizard
  reached CountrySectorPicker step (Test 2 surfaced).

### 2. Onboarding — Country / Sector Picker
expected: |
  Fresh profile only: after the mnemonic + confirm steps, a new
  CountrySectorPicker step appears (between MnemonicConfirm and password).
  Selecting "Nigeria" / a sector loads the NG news bundle. Skipping is OK.
  On already-onboarded profile this step is bypassed and the picker is
  available via Settings → News Sources instead.
result: pass
notes: |
  Initial run: picker rendered fine but "Could not save news sources." red
  error appeared because OnboardingWizard's news-picker step ran BEFORE
  password/seal — SQLCipher DB not yet open, NEWS_SET_BUNDLE handler
  returned bare { ok: false }. Resolved by commit b7c931b: picker now
  pure collect-and-report-up; OnboardingWizard buffers selection and
  persists post-seal (non-blocking on failure).
  Re-run: onboarding completed end-to-end. User landed on main app shell
  with SideNav (Briefing/Approvals/Settings) and BriefingScreen rendering
  the GenerateNowAffordance — proves seal + post-seal news persistence
  fired correctly.

### 3. Connect Gmail (read-only)
expected: |
  Settings → Integrations → "Connect Gmail" opens an OAuth browser window
  scoped to `gmail.readonly` only. After approval the window closes; the
  Gmail row in IntegrationsSection flips to connected with the account
  email displayed.
result: [pending]

### 4. Connect Google Calendar (read-only)
expected: |
  Settings → Integrations → "Connect Calendar" reuses the same Google
  account, scoped to `calendar.readonly`. Calendar row flips to connected;
  no second account picker required.
result: [pending]

### 5. Gmail Ingest Visible in StatusPanel
expected: |
  Within ~5 minutes of connecting (or after triggering a manual sync) the
  Gmail row in the StatusPanel shows: state=ok, queue depth=0,
  last_synced_at recent (today), last_error empty. `gmail_message` rows
  exist in the local DB.
result: [pending]

### 6. Calendar Ingest Visible in StatusPanel
expected: |
  Within ~15 minutes (or after manual trigger) the Calendar row shows:
  state=ok, last_synced_at recent, last_error empty. Today's events appear
  in `calendar_event` with start_at_utc (timed) or start_date (all-day)
  populated correctly.
result: [pending]

### 7. Generate Today's Briefing
expected: |
  Open the Briefing screen. If no briefing exists for today's local date,
  a "Generate today's briefing now?" affordance appears. Clicking it
  produces a briefing in <30s with three sections: Today's Calendar,
  Priority Email, News. Each section caps at 3 items; each item shows a
  one-line "why this mattered" rationale (≤140 chars).
result: [pending]

### 8. Briefing — B4 SC2 Email Fallback
expected: |
  If the connected Gmail account has unread mail in the last 24h but none
  flagged IMPORTANT by Gmail, the Priority Email section renders the
  locked copy: "No mail flagged Important by Gmail. Phase 3 adds Aria's
  own priority classifier." This is the documented Phase-2 limitation,
  not an error.
result: [pending]

### 9. Briefing — News Dismiss Per Day
expected: |
  In the News section, dismissing an item removes it from view. Refreshing
  or regenerating the briefing for the same day does not show it again.
  Tomorrow's briefing may show the same source story (per-day dismissal).
result: [pending]

### 10. Daily Briefing Schedule
expected: |
  Settings → Briefing trigger time = 07:00 local. The cron picker shows
  whole-hour options only (DST 02:00–03:00 skipped). Setting it to "next
  hour" (or running `setSystemTime` manually if available) fires the
  briefing once; firing again the same day is a no-op (idempotent on
  YYYY-MM-DD local).
result: [pending]

### 11. EMAIL-07 Re-auth Banner
expected: |
  When the Gmail or Calendar refresh token returns invalid_grant (Google
  Test-mode tokens expire after 7 days — easy to wait for, or simulate by
  invalidating the stored refresh token), an EMAIL-07-style re-auth banner
  appears inline in that integration row. The OTHER integrations and the
  Briefing screen continue to function.
result: [pending]

### 12. Sleep/Wake — No Cron Storm (L2 invariant)
expected: |
  Sleep the machine for ~5 minutes; wake it. Within a few seconds the
  three crons (gmail-sync, calendar-sync, briefing) resume. They do NOT
  back-fire missed runs in a burst (XCUT-01). `scheduler.cronRegistry`
  size stays at exactly 3 across the suspend/resume cycle.
result: [pending]

### 13. Coverage — Send/Write Permissions Are Absent
expected: |
  Goal-backward check on the User Story "without giving Aria send or
  write permissions yet". The OAuth consent screen showed only
  `gmail.readonly` + `calendar.readonly`. There is no "Send", "Compose",
  "Reply", or "Reschedule" action surfaced anywhere in the UI. Aria has
  no Gmail send capability and no Calendar write capability.
result: [pending]

## Technical Checks (deferred — run after user-flow passes)

### T1. Unit Suite Green
expected: `pnpm vitest run` reports 194/194 pass (no regression from `b0f50ab`).
result: [pending]

### T2. Migrations at user_version 5
expected: |
  Fresh profile shows `PRAGMA user_version` = 5 after first launch, and
  `tests/unit/main/db/migrations.spec.ts` asserts `applied=[1,2,3,4,5]`.
result: [pending]

### T3. PII Redaction Regex-Zero on Prompt
expected: |
  In a generated briefing's `routing_log` row, the captured prompt string
  contains zero matches for `\S+@\S+\.\S+`. (M1 invariant — already
  asserted by `tests/unit/main/briefing/redact.spec.ts` case 7 + `generate.spec.ts` case 6.)
result: [pending]

### T4. cronRegistry Size 3 Across Suspend/Resume
expected: |
  Programmatic check (or log inspection) confirms `scheduler.cronRegistry`
  size = 3 (`gmail-sync`, `calendar-sync`, `briefing`) both before and
  after a suspend/resume cycle (L2 invariant — asserted in `schedule.spec.ts` case 7).
result: [pending]

## Summary

total: 13 user-flow + 4 technical
passed: 0
issues: 0
pending: 17
skipped: 0
blocked: 0

## Gaps

### Gap 1
test: 1 (Cold Start Smoke Test)
symptom: |
  `pnpm dev` boots; Electron window stays blank. DevTools console shows:
  (1) "Executing inline script violates the following Content Security
  Policy directive 'script-src 'self'' … hash 'sha256-Z2/iFzh9…' or a
  nonce required" from (index):4; (2) downstream
  "@vitejs/plugin-react can't detect preamble" at SideNav.tsx:27.
root_cause: |
  Vite dev-mode injects the React Fast-Refresh preamble as an inline
  <script> and opens a WebSocket to ws://localhost:5173 for HMR. The
  project's strict CSP (script-src 'self'; no localhost in connect-src)
  is correct for prod (T-01-01b-05) but blocks both in dev. CSP was set
  in two places (renderer/index.html <meta> AND main process
  applyCsp()) — both hardcoded to the prod-strict value.
fix: |
  Split CSP into prodCspHeader() (unchanged) and devCspHeader() (adds
  'unsafe-inline' to script-src and ws://localhost:5173 +
  http://localhost:5173 to connect-src; nothing else loosened).
  applyCsp() picks via process.env.ELECTRON_RENDERER_URL (electron-vite
  dev discriminator) and logs a one-line warning in dev. Removed the
  <meta http-equiv="Content-Security-Policy"> from
  src/renderer/index.html so the main process is the single source of
  truth. Prod posture unchanged.
commit: 8c4c010
artifacts:
  - src/main/index.ts (prodCspHeader / devCspHeader split, applyCsp branching, dev warning log)
  - src/renderer/index.html (CSP meta tag removed, pointer comment added)
verification:
  - pnpm tsc --noEmit (tsconfig.json + tsconfig.node.json): clean
  - pnpm run build: clean (out/renderer/index.html, out/main/index.js produced)
  - pnpm vitest run tests/unit/main/ipc/ask-local-handler.spec.ts (isolation): 1/1 pass (full-suite 193/194 with one pre-existing flake unrelated to CSP)
debug_session: ""
note: |
  Test 1 result stays `issue` for the record. User re-runs `pnpm dev`
  and confirms before flipping to passed.

### Gap 2
test: 2 (Onboarding — Country / Sector Picker)
symptom: |
  Fresh-profile flow reaches CountrySectorPicker (Nigeria + 4 sectors
  pre-checked, correct render) but renders inline red error "Could not
  save news sources." above the Continue button. DevTools console
  otherwise clean (only React Router future-flag warnings).
root_cause: |
  Order-of-operations bug. Onboarding wizard runs
  loading → show → confirm → news-picker → password → sealing, but the
  SQLCipher DB is only opened inside `onboardingSeal` (password step).
  The picker was calling `window.aria.newsSetBundle(...)` directly at
  the news-picker step, so `dbHolder.db` was still null in
  `registerNewsHandlers`. The NEWS_SET_BUNDLE handler returned
  `{ ok: false }` (no `error` string), and the renderer fell through to
  the generic fallback message. The handler was working as designed;
  the call site was simply premature.
fix: |
  Option B — buffered persistence (preserves Plan 02-03 UX order).
  CountrySectorPicker prop changes from `onSubmitted()` to
  `onSelected({country, sectors})` and becomes a pure "collect + report
  up" step (no IPC, no local error/busy state). OnboardingWizard buffers
  the selection in component state and calls `newsSetBundle` AFTER
  `onboardingSeal` returns ok. Post-seal save failure is logged to
  console but does NOT block `onComplete` — news is supplementary; the
  user can re-pick via Settings → News Sources. Settings picker
  (`NewsSourcesSection.tsx`) untouched (lives post-seal, DB already open).
commit: b7c931b
artifacts:
  - src/renderer/features/onboarding/CountrySectorPicker.tsx (prop contract, removed IPC + error state)
  - src/renderer/features/onboarding/OnboardingWizard.tsx (newsSelection state, post-seal persist, non-blocking)
  - tests/unit/renderer/features/onboarding/CountrySectorPicker.spec.tsx (asserts picker does NOT call newsSetBundle; new Case 6 covers post-seal failure non-blocking)
  - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-03-SUMMARY.md (Post-UAT Correction section)
verification:
  - pnpm tsc --noEmit (tsconfig.json + tsconfig.node.json): clean
  - pnpm vitest run tests/.../CountrySectorPicker.spec.tsx: 6/6 pass
  - pnpm vitest run (full suite): 194/195 (the 1 fail is the
    pre-existing `ask-local-handler.spec.ts` timeout flake, unchanged
    from baseline; pass count rose 193 → 194 from new Case 6)
  - pnpm run build: clean
debug_session: ""
note: |
  Test 2 result stays `issue` for the record. User re-runs the
  fresh-profile flow and confirms picker advances to password without
  error before flipping to passed.

### Gap 3
test: 3 (Connect Gmail (read-only))
symptom: |
  Settings → Integrations → "Connect Gmail" → in-app warning modal
  Continue. Modal closes, nothing else happens. No OAuth browser
  window opens. DevTools console clean. (Same chain affects "Connect
  Calendar" — Test 4 latent.)
root_cause: |
  Three bugs chained:
  (1) Dev env not loaded — `src/main/integrations/google/auth.ts`
      reads `process.env.GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`. The
      file's header comment claimed "dev reads .env.local" but no
      `dotenv` dependency was installed and no `.env.local` loader
      was wired anywhere. `process.env.*` was `undefined` in dev, so
      `readOAuthConfig()` threw `OAuthConfigMissingError` every time.
  (2) Renderer swallowed the handler error —
      `IntegrationsSection.tsx` `onModalContinue` (both Gmail and
      Calendar copies) called `await window.aria.gmailConnect()` /
      `calendarConnect()` and discarded the result. The handler's
      `{ ok: false, error: 'oauth-config-missing' }` payload never
      reached the UI — user only saw `setBusy(false)`.
  (3) No error surfacing on the integration row at all — even once
      env loads, future failures (network, user cancels OAuth,
      invalid creds) would remain invisible.
fix: |
  Part A: dev-only `.env.local` loader at the very top of
  `src/main/index.ts`, BEFORE any module reads `process.env.GOOGLE_*`.
  Gated on `ELECTRON_RENDERER_URL` (same dev discriminator the CSP
  fix uses), reads `process.cwd()/.env.local`, ~10-line KEY=VALUE
  parser (NO `dotenv` dep), strips surrounding quotes, only sets
  vars not already in `process.env` (shell exports win), logs ONE
  pino line with `scope: 'env-local', loaded: <N>` — never logs
  keys or values. Packaged builds (no `ELECTRON_RENDERER_URL`)
  skip entirely.
  Part B: `connectError` state added to both `GmailRow` and
  `CalendarRow`. `onModalContinue` now captures the IPC return; if
  `result.error` is a string it sets `connectError` via a new
  `connectErrorCopy(code)` mapper (known codes:
  `oauth-config-missing`, `access_denied`; generic fallthrough).
  Rendered inline above the Connect button using the existing
  banner style (red, role="alert"). Cleared when the user re-clicks
  Connect.
commit: 76aa1f5
artifacts:
  - src/main/index.ts (dev `.env.local` loader)
  - src/renderer/features/settings/IntegrationsSection.tsx (connectError state + banner in both rows; connectErrorCopy mapper)
  - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-01-SUMMARY.md (Post-UAT Correction)
verification:
  - pnpm run typecheck: clean (both tsconfigs)
  - pnpm vitest run: 195/195 pass (Gap 2 baseline 194/195 — flake passed too; no regression)
  - pnpm run build: clean
  - secret-safe re-read of index.ts loader (counts only, never keys/values)
debug_session: ""
note: |
  Test 3 result stays `issue` for the record. User re-runs the
  Connect Gmail flow and confirms the OAuth browser window opens
  before flipping to passed.

## Known Caveats Going In

- E2E tests (`tests/e2e/briefing.spec.ts`, `hello-aria.spec.ts`, `onboarding.spec.ts`)
  are `test.skip` with reason `ONBOARDING_FIXTURE_STALE` because Plan 02-03's
  `CountrySectorPicker` step was added between MnemonicConfirm and password
  but the `runOnboarding` helper was not updated. This is a Plan 02-03 follow-up
  and is acknowledged before UAT begins. Test #2 here is the human stand-in.
- Test #11 (EMAIL-07) may take up to 7 days in pure Test-mode OAuth scope unless
  you can invalidate the refresh token manually. Mark `blocked` with
  `blocked_by: third-party` if waiting isn't practical.

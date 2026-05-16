---
phase: 02-gmail-ingest-daily-briefing-mvp
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .env.local.example
  - package.json
  - package-lock.json
  - src/shared/ipc-contract.ts
  - src/main/secrets/safeStorage.ts
  - src/main/db/migrations/embedded.ts
  - src/main/db/migrations/002_gmail.sql
  - src/main/integrations/google/auth.ts
  - src/main/integrations/google/gmail.ts
  - src/main/integrations/google/sync-gmail.ts
  - src/main/ipc/gmail.ts
  - src/main/ipc/index.ts
  - src/main/log/redact.ts
  - src/main/lifecycle/powerMonitor.ts
  - src/renderer/features/settings/IntegrationsSection.tsx
  - src/renderer/features/settings/StatusPanel.tsx
  - src/renderer/features/settings/SettingsScreen.tsx
  - tests/setup.ts
  - tests/unit/main/integrations/google/auth.spec.ts
  - tests/unit/main/integrations/google/sync-gmail.spec.ts
  - tests/unit/main/integrations/google/gmail-wrapper.spec.ts
  - tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx
autonomous: false
requirements: [EMAIL-01, EMAIL-07, XCUT-06]
tags: [gmail, oauth, loopback, history-list, safe-storage, status-panel, reauth-banner]

must_haves:
  truths:
    - "User completes the Wave-0 GCP setup checkpoint and `.env.local` contains a non-empty GOOGLE_OAUTH_CLIENT_ID (Desktop type)"
    - "Clicking 'Connect Gmail' in Settings → Integrations opens an Electron BrowserWindow with nodeIntegration:false, runs the loopback IP flow with PKCE + access_type=offline + prompt=consent, and persists a refresh_token via safeStorage under googleTokens.gmail"
    - "OAuth refresh tokens NEVER appear in SQLCipher rows; gmail_account holds only email, history_id, last_synced_at, last_error, connected_at"
    - "Initial connect runs a 7-day backfill via users.messages.list?q=newer_than:7d, rate-limited through scheduler.queue (concurrency=1)"
    - "Every 5 minutes a cron tick calls users.history.list(historyId); a 404/notFound triggers full 7-day resync, NOT a crash (Pitfall 11/12)"
    - "After a >7-day app sleep, on the next sync the `gmail_message` table contains every message from the trailing 7 days that exists in the Google account (no silent gaps) — historyId 404 recovery is observable as no missing rows"
    - "When google-auth-library returns invalid_grant on refresh (test-mode 7d expiry), `gmail_account.last_error='token-expired'` and EMAIL-07 banner renders within one cron tick"
    - "gmail_message rows store metadata only (subject, from, snippet, received_at UTC, label_ids JSON, is_unread, is_important) — no message bodies persisted in Phase 2"
    - "historyId is updated in the SAME SQLite transaction as the row inserts it represents (atomic cursor advance)"
    - "Expired refresh_token surfaces as an inline EMAIL-07 re-auth banner inside the Gmail row of IntegrationsSection — NOT a modal; Calendar and other sections continue to function (SC3 partial)"
    - "Status panel row 'Gmail' shows sync state (idle/syncing/error), queue depth, last_synced_at relative, and last_error (XCUT-06 partial)"
    - "New mail seeded by the mock googleapis fixture appears in gmail_message within one tick (proves SC1 mechanic; SC1 user-facing is closed by Plan 02-04's BriefingScreen)"
  artifacts:
    - path: "src/main/integrations/google/auth.ts"
      provides: "OAuth2Client factory + loopback IP listener + PKCE + token persist"
      exports: ["connectGoogle", "getOAuth2Client", "TokenInvalidError"]
    - path: "src/main/integrations/google/gmail.ts"
      provides: "GmailClient interface + googleapis-backed implementation; translates google errors to HistoryInvalidatedError / TokenInvalidError"
      exports: ["GmailClient", "createGmailClient", "HistoryInvalidatedError"]
    - path: "src/main/integrations/google/sync-gmail.ts"
      provides: "GmailSync.tick() — history.list → messages.get(metadata) → upsert; full-resync fallback on 404"
      exports: ["GmailSync", "createGmailSync"]
    - path: "src/main/ipc/gmail.ts"
      provides: "GMAIL_CONNECT / GMAIL_STATUS / GMAIL_DISCONNECT / GMAIL_FORCE_SYNC handlers"
      exports: ["registerGmailHandlers"]
    - path: "src/main/db/migrations/002_gmail.sql"
      provides: "gmail_account + gmail_message tables + indices"
    - path: ".env.local.example"
      provides: "Documented GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET placeholders + GCP setup steps"
  key_links:
    - from: "src/main/integrations/google/auth.ts"
      to: "src/main/secrets/safeStorage.ts (googleTokens subtree)"
      via: "setGoogleTokens / getGoogleTokens / clearGoogleTokens"
      pattern: "googleTokens"
    - from: "src/main/integrations/google/sync-gmail.ts"
      to: "src/main/lifecycle/scheduler.ts (single-writer queue)"
      via: "scheduler.queue.add(() => ...) wraps every Google API call AND every DB write"
      pattern: "queue\\.add\\("
    - from: "src/main/ipc/gmail.ts"
      to: "src/main/ipc/index.ts (registerHandlers chain)"
      via: "registerGmailHandlers appended after registerDiagnosticsHandlers"
      pattern: "registerGmailHandlers"
    - from: "src/renderer/features/settings/IntegrationsSection.tsx"
      to: "window.aria.gmailConnect / gmailStatus / gmailDisconnect"
      via: "preload IPC bridge mirroring Phase 1 pattern"
      pattern: "window\\.aria\\.gmail"
---

<objective>
## Phase Goal

**As a** solo-dev SMB-exec dogfooding Aria on Windows 11, **I want to** OAuth-connect my Gmail account once and have Aria continuously ingest new mail (metadata only) into the encrypted local DB, **so that** the Phase 2 briefing engine has fresh inbox data to surface and an expired token surfaces inline without breaking the rest of the app.

Purpose: Closes EMAIL-01 (OAuth-connect + incremental ingest), EMAIL-07 (expired-token re-auth UX), and the Gmail half of XCUT-06 (status-panel rows). Establishes the OAuth-loopback + PKCE + safeStorage-token + change-token-cursor pattern that Plan 02-02 generalizes for Calendar.

Output: A working Settings → Integrations row for Gmail (connect / disconnect / status / re-auth banner), a `googleapis`-backed Gmail sync engine driven by a 5-minute node-cron tick coalesced through Phase 1's `scheduler.queue`, migration 002 with `gmail_account` + `gmail_message` tables, and unit tests covering the happy path, 404→full-resync fallback, expired-token detection (with Google's actual `invalid_grant` payload), and the EMAIL-07 banner render.

**Cohesion note (H4):** This plan ships 21 modified files spanning four concerns: deps+migrations+ipc-contract (Task 1), OAuth+sync engine (Task 2), and IPC+cron+UI (Task 3). The natural split point (Task 1+2 vs Task 3) was considered. The plan is kept whole because: (a) the OAuth flow, sync engine, and the EMAIL-07 banner copy form one tested contract that is meaningless until end-to-end; (b) Plan 02-02 depends on the powerMonitor callback-registration API that Task 3 extends, so splitting would force a third plan just for that hook; (c) the three tasks individually stay within ~25-35% context each. Each task remains independently shippable to a clean WIP commit.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@CLAUDE.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md
@.planning/phases/01-foundation/01-02-db-passphrase-SUMMARY.md
@.planning/phases/01-foundation/01-03-secrets-settings-SUMMARY.md
@.planning/phases/01-foundation/01-04-llm-router-SUMMARY.md
@.planning/debug/sqlcipher-electron-42-abi.md
@src/shared/ipc-contract.ts
@src/main/ipc/index.ts
@src/main/secrets/safeStorage.ts
@src/main/db/migrations/embedded.ts
@src/main/lifecycle/scheduler.ts
@src/main/lifecycle/powerMonitor.ts
@src/main/log/redact.ts
@src/renderer/features/settings/SettingsScreen.tsx

<interfaces>
<!-- New IPC channels (added to src/shared/ipc-contract.ts CHANNELS map): -->
<!-- GMAIL_CONNECT: 'aria:gmail:connect'                  () => { ok: true, email: string } | { ok: false, error: string } -->
<!-- GMAIL_STATUS: 'aria:gmail:status'                    () => GmailIntegrationStatus -->
<!-- GMAIL_DISCONNECT: 'aria:gmail:disconnect'            () => { ok: true } -->
<!-- GMAIL_FORCE_SYNC: 'aria:gmail:force-sync'            () => { ok: boolean, error?: string } -->
<!-- export interface GmailIntegrationStatus { -->
<!--   connected: boolean; email?: string; lastSyncedAt?: string; lastError?: string; -->
<!--   tokenStatus: 'ok' | 'missing' | 'expired' | 'revoked'; -->
<!--   queueDepth: number; -->
<!-- } -->
<!-- New safeStorage methods on src/main/secrets/safeStorage.ts: -->
<!-- setGoogleTokens({ kind: 'gmail' | 'calendar', refreshToken: string, email: string }): void -->
<!-- getGoogleTokens(kind): { refreshToken: string; email: string } | null -->
<!-- clearGoogleTokens(kind): void -->
<!-- GmailClient interface (src/main/integrations/google/gmail.ts) — injected into GmailSync: -->
<!--   listHistory({ startHistoryId }): Promise<{ history: HistoryEntry[]; historyId: string }> -->
<!--   listMessages({ q, pageToken }): Promise<{ messages: { id: string; threadId: string }[]; nextPageToken?: string; historyId: string }> -->
<!--   getMessageMetadata(id): Promise<GmailMessageMetadata> -->
<!--   getProfile(): Promise<{ emailAddress: string; historyId: string }> -->
<!-- powerMonitor.registerLifecycleCallbacks({ onSuspend?, onResume? }): () => void (unregister) -->
</interfaces>
</context>

<tasks>

<task type="checkpoint:human-action" gate="blocking">
  <name>Task 0 (Wave 0): User creates a GCP project + Desktop OAuth client and populates .env.local</name>
  <what-built>
    The executor has written `.env.local.example` documenting the required env vars and the GCP setup steps. The actual GCP project + OAuth credentials cannot be created by code — the user (project owner) must do this in the Google Cloud Console once, and paste the resulting client ID + client secret into a local `.env.local` (NOT committed). This is the same blocking TODO already tracked in `.planning/phases/01-foundation/01-03-CASA-INTAKE.md` §1.
  </what-built>
  <how-to-verify>
    1. Open `.env.local.example` — it must contain `GOOGLE_OAUTH_CLIENT_ID=`, `GOOGLE_OAUTH_CLIENT_SECRET=`, and a comment block with these instructions:
       a. Go to https://console.cloud.google.com → Create a new project named "Aria (dev)".
       b. APIs & Services → Enable: "Gmail API" and "Google Calendar API".
       c. OAuth consent screen → External, fill app name "Aria", user support email = adexdsamson@gmail.com, developer contact = same. Add scopes `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/calendar.readonly`. Add yourself as a Test user.
       d. Credentials → Create OAuth client ID → Application type **Desktop app** → name "Aria desktop". Copy Client ID and Client secret.
       e. Copy `.env.local.example` to `.env.local`, paste the Client ID into `GOOGLE_OAUTH_CLIENT_ID=` and Client secret into `GOOGLE_OAUTH_CLIENT_SECRET=`. Save.
       f. Confirm `.env.local` is git-ignored (verify via `git status` — it must NOT appear in tracked files).
    2. Reply with `approved` when complete, or describe blockers.
    Note: While the OAuth consent screen is in "Testing" status, refresh tokens expire after 7 days — this is a known Phase 2 gotcha already handled by EMAIL-07 banner logic in Task 3.
  </how-to-verify>
  <resume-signal>Type "approved" once `.env.local` exists with non-empty GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET, or describe issues.</resume-signal>
</task>

<task type="auto" tdd="true">
  <name>Task 1: Install googleapis + google-auth-library; extend ipc-contract; extend safeStorage with googleTokens subtree; append migration 002</name>
  <files>package.json, package-lock.json, src/shared/ipc-contract.ts, src/main/secrets/safeStorage.ts, src/main/db/migrations/embedded.ts, src/main/db/migrations/002_gmail.sql, src/main/log/redact.ts, tests/setup.ts, tests/unit/main/integrations/google/auth.spec.ts</files>
  <read_first>
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Standard Stack" + §"SQLCipher Migration 002 — Recommended Shape" (gmail_account + gmail_message subset only — calendar tables come in plan 02-02; briefing/news tables in 02-03/02-04)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md "Carried forward from Phase 1" + Resolutions §"Gmail OAuth scope"
    - src/shared/ipc-contract.ts (extend CHANNELS map; do not break Phase 1 entries)
    - src/main/secrets/safeStorage.ts (mirror provider-keyed pattern for googleTokens subtree)
    - src/main/db/migrations/embedded.ts (append EMBEDDED_MIGRATIONS[1]; do NOT edit version 1)
    - src/main/log/redact.ts (extend with bearer-token + OAuth code patterns)
  </read_first>
  <behavior>
    - `npm install googleapis@^144 google-auth-library@^9` succeeds; lockfile updated; postinstall electron-rebuild still passes for better-sqlite3-multiple-ciphers (Electron 41.6.1 ABI — DO NOT bump electron).
    - `CHANNELS` exports the four new constants: `GMAIL_CONNECT`, `GMAIL_STATUS`, `GMAIL_DISCONNECT`, `GMAIL_FORCE_SYNC` (literal strings `aria:gmail:connect`, etc.). `GmailIntegrationStatus` interface exported.
    - `safeStorage.ts` exposes `setGoogleTokens({kind,refreshToken,email})`, `getGoogleTokens(kind)`, `clearGoogleTokens(kind)`. Disk shape extends to `{ v: 1, providers: {...}, activeProvider: ..., googleTokens?: { gmail?: { refreshTokenEnc: string, email: string }, calendar?: {...} } }`. Refresh token is `safeStorage.encryptString`-encoded → base64. Same SafeStorageUnavailableError discipline (refuses pre-ready / basic_text). Phase-1 fields untouched on read or write.
    - Migration 002 SQL contains EXACTLY the `gmail_account` table + `gmail_message` table + the two indices from RESEARCH §SQLCipher Migration 002 (calendar tables ship in 003 — Plan 02-02; briefing/news/dismissed in 004 — Plan 02-03; 005 — Plan 02-04).
    - `redact.ts` adds two redaction rules: (a) `Bearer\s+[A-Za-z0-9._\-~+/]+=*` → `Bearer [REDACTED]`; (b) `code=[A-Za-z0-9._\-/]+` → `code=[REDACTED]` (the OAuth authorization code in loopback URLs). Existing Phase-1 patterns unchanged.
    - `tests/setup.ts` adds a `mockGoogleapis()` helper exporting a configurable `{ gmail: GmailClientFake, calendar: ... }` fixture (calendar half is a no-op stub here; plan 02-02 fills it in).
  </behavior>
  <action>
    Install dependencies via `npm install googleapis@^144 google-auth-library@^9`. Verify lockfile and that `electron-rebuild` continues to succeed against Electron 41.6.1 (the `patches/better-sqlite3-multiple-ciphers+12.9.0.patch` from Phase 1 must remain in place — do not modify or remove).

    Append to `src/shared/ipc-contract.ts` `CHANNELS` map: `GMAIL_CONNECT: 'aria:gmail:connect'`, `GMAIL_STATUS: 'aria:gmail:status'`, `GMAIL_DISCONNECT: 'aria:gmail:disconnect'`, `GMAIL_FORCE_SYNC: 'aria:gmail:force-sync'`. Export `GmailIntegrationStatus` interface with the fields listed in the `<interfaces>` block above (connected, email?, lastSyncedAt?, lastError?, tokenStatus: 'ok'|'missing'|'expired'|'revoked', queueDepth). Do NOT alter any existing Phase-1 channel literals.

    Extend `src/main/secrets/safeStorage.ts` with the three googleTokens functions. Reuse the existing on-disk JSON file (`<userData>/secrets.json`) and the existing safeStorage encrypt/decrypt path — same pre-ready / availability guards. Add a `kind` parameter type `'gmail' | 'calendar'` and store under `googleTokens[kind]`. On `clear`, remove the kind sub-key (leave other kinds + frontier providers untouched).

    Create `src/main/db/migrations/002_gmail.sql` with:
    ```
    CREATE TABLE gmail_account (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      email TEXT NOT NULL,
      history_id TEXT,
      last_synced_at TEXT,
      last_error TEXT,
      connected_at TEXT NOT NULL
    );
    CREATE TABLE gmail_message (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      from_addr TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,
      label_ids TEXT NOT NULL,
      is_unread INTEGER NOT NULL DEFAULT 0,
      is_important INTEGER NOT NULL DEFAULT 0,
      history_id TEXT,
      fetched_at TEXT NOT NULL
    );
    CREATE INDEX idx_gmail_message_recv ON gmail_message(received_at DESC);
    CREATE INDEX idx_gmail_message_priority ON gmail_message(is_unread, is_important, received_at DESC);
    ```
    Append the corresponding `EMBEDDED_MIGRATIONS[1] = { version: 2, file: '002_gmail.sql', sql: <verbatim above> }` entry to `embedded.ts`. Reuse Plan 01-02's drift-check pattern: the .sql file and the embedded string must match byte-for-byte (modulo leading/trailing whitespace).

    Create `.env.local.example` at repo root with the GCP setup instructions (full Task 0 verification text, plus `GOOGLE_OAUTH_CLIENT_ID=` and `GOOGLE_OAUTH_CLIENT_SECRET=` placeholders). Confirm `.gitignore` already excludes `.env.local` (Phase 1 already added `.env*`).

    Extend `src/main/log/redact.ts` with the two new patterns. Re-export them in `DEFAULT_PII_PATTERNS` so the Phase 1 classifier picks them up too (defense-in-depth — should never be needed because OAuth flow lives in main only, but keeps the redact list authoritative).

    Extend `tests/setup.ts` with a `mockGoogleapis()` factory returning a `GmailClientFake` shape (`listHistory`, `listMessages`, `getMessageMetadata`, `getProfile` all as `vi.fn()`). Default behavior: all functions return empty results; tests override per case.

    Create `tests/unit/main/integrations/google/auth.spec.ts` (will be expanded in Task 2 — for now write the temp-userData-dir + safeStorage round-trip test covering the three googleTokens functions):
    1. `setGoogleTokens({ kind: 'gmail', refreshToken: 'rt-abc', email: 'foo@bar.com' })` writes the disk file.
    2. `getGoogleTokens('gmail')` returns `{ refreshToken: 'rt-abc', email: 'foo@bar.com' }`.
    3. `clearGoogleTokens('gmail')` removes the entry; `getGoogleTokens('gmail')` returns null.
    4. After write, the raw token `'rt-abc'` is NOT readable from the on-disk JSON (assert via `fs.readFileSync(secretsPath, 'utf8').includes('rt-abc') === false`).
    5. Phase-1 fields untouched: `getActiveProvider()` returns null both before and after the googleTokens write (mirrors Phase-1's secret-isolation test pattern).
  </action>
  <verify>
    <automated>npm install && npm run typecheck && npm run test:unit -- tests/unit/main/integrations/google/auth.spec.ts tests/unit/main/db</automated>
  </verify>
  <acceptance_criteria>
    - `node_modules/googleapis/package.json` major version is `144` or higher; `node_modules/google-auth-library` major is `9` or higher.
    - `node_modules/electron/package.json` version still starts with `41.6.1` (executor verifies and reports — DO NOT bump).
    - `grep -v '^\s*//' src/shared/ipc-contract.ts | grep -c "aria:gmail:"` returns 4.
    - `grep -c "googleTokens" src/main/secrets/safeStorage.ts` returns ≥ 3 (set/get/clear).
    - `grep -c "version: 2" src/main/db/migrations/embedded.ts` returns ≥ 1; `grep -c "CREATE TABLE gmail_message" src/main/db/migrations/002_gmail.sql` returns 1.
    - `grep -c "Bearer" src/main/log/redact.ts` returns ≥ 1.
    - All 5 cases in `auth.spec.ts` pass; raw token NOT readable on disk (case 4).
    - `npm run typecheck` exits 0 (catches any drift between ipc-contract and consumers).
  </acceptance_criteria>
  <done>Phase 2 dependency baseline is locked, the ipc-contract has the four Gmail channels reserved, safeStorage owns OAuth refresh tokens via the documented googleTokens subtree, migration 002 ships the two Gmail tables, redact rules cover OAuth bearer tokens + auth codes, and `.env.local` setup is documented.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: OAuth loopback flow (auth.ts) + GmailClient wrapper (gmail.ts) + GmailSync engine (sync-gmail.ts) with 404→full-resync fallback + invalid_grant detection</name>
  <files>src/main/integrations/google/auth.ts, src/main/integrations/google/gmail.ts, src/main/integrations/google/sync-gmail.ts, tests/unit/main/integrations/google/auth.spec.ts, tests/unit/main/integrations/google/gmail-wrapper.spec.ts, tests/unit/main/integrations/google/sync-gmail.spec.ts</files>
  <read_first>
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Pattern: OAuth Loopback Flow (Desktop)" (full code shape — `access_type:offline`, `prompt:consent`, PKCE S256, BrowserWindow with nodeIntegration:false, http.createServer on 127.0.0.1:0)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Pattern: Gmail history.list with Invalidation Fallback"
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Common Pitfalls" 11, 12, 13, 18 (history-token-as-state, prompt:consent for refresh_token, tokens NEVER in SQLCipher, nodeIntegration:false)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"CASA / Unverified-App UX" (test-mode 7d refresh-token expiry returns `invalid_grant`)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Mocking Strategy (Phase 2 specific)" — define a `GmailClient` interface; real impl wraps googleapis; sync tests inject fakes; one wrapper test does `vi.mock('googleapis')` to verify error translation.
    - src/main/lifecycle/scheduler.ts (queue concurrency=1; ALL google API calls and ALL DB writes go through it)
    - src/main/db/connect.ts (Db type from Plan 01-02)
  </read_first>
  <behavior>
    - `connectGoogle('gmail')`:
      1. Reads `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` from `process.env` (electron-vite `define` injects in production; dev reads `.env.local`); if either is missing throws `OAuthConfigMissingError`.
      2. Starts `http.createServer` on 127.0.0.1 port 0 (kernel picks).
      3. Builds OAuth2Client with that loopback redirectUri; computes a PKCE verifier + S256 challenge.
      4. Generates auth URL with `access_type: 'offline'`, `prompt: 'consent'`, `scope: ['https://www.googleapis.com/auth/gmail.readonly']`, `code_challenge`, `code_challenge_method: 'S256'`.
      5. Opens an Electron BrowserWindow with `webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }`, no preload (Pitfall 18).
      6. Awaits the loopback redirect; extracts `?code=` and `?state=`.
      7. Calls `client.getToken({ code, codeVerifier })`. Asserts `tokens.refresh_token` is non-empty; if empty throws `NoRefreshTokenError` with message guiding the user to re-authorize.
      8. Resolves user email via a one-shot `gmail.users.getProfile`.
      9. Persists via `setGoogleTokens({ kind:'gmail', refreshToken, email })`.
      10. Returns `{ ok: true, email }`. Closes the BrowserWindow + loopback server.
    - `getOAuth2Client('gmail')` reads the persisted refresh token, constructs an OAuth2Client with the refresh token set, and registers a `'tokens'` listener that re-persists `refresh_token` on Google rotation (rare but happens per RESEARCH).
    - `GmailClient` is an interface with the four methods listed in `<interfaces>`. `createGmailClient(oauth2Client)` returns the googleapis-backed impl. The impl translates errors:
      - `404` / `errors[0].reason === 'notFound'` on `users.history.list` → `HistoryInvalidatedError`.
      - **invalid_grant detection (H2):** any error with `response.data.error === 'invalid_grant'` OR `errors[0].reason === 'invalid_grant'` OR `(err.code === 401 && /invalid_grant/i.test(err.message))` → `TokenInvalidError({ reason: 'expired' })`. The wrapper MUST inspect google-auth-library's actual test-mode payload shape: `{ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }`. If `error_description` contains the literal substring `'revoked'`, set `reason: 'revoked'`; otherwise `reason: 'expired'`.
    - `GmailSync.tick(db, client, scheduler)`:
      1. Read `gmail_account` row. If `history_id IS NULL`, run `fullResync7d()` and return.
      2. Call `client.listHistory({ startHistoryId })` via `scheduler.queue.add(...)`.
      3. On `HistoryInvalidatedError`, call `fullResync7d()` and return (delivers the >7-day-sleep-no-gaps truth).
      4. On `TokenInvalidError`, update `gmail_account.last_error = 'token-' + reason` and re-throw so `gmailStatus` reflects it.
      5. For each `messageAdded` entry, call `client.getMessageMetadata(id)` (queued). Build a `gmail_message` row: `received_at = new Date(Number(internalDate)).toISOString()`; `is_unread = labelIds.includes('UNREAD') ? 1 : 0`; `is_important = labelIds.includes('IMPORTANT') ? 1 : 0`; `label_ids = JSON.stringify(labelIds)`; `from_addr` parsed from the `From` header; `subject` from the `Subject` header (default ''); `snippet` from `data.snippet`; `history_id` from message-level `historyId`; `fetched_at` = now.
      6. In a single `db.transaction(() => { upsertMany(rows); updateAccountHistoryId(res.data.historyId); updateLastSyncedAt(now) })` — atomic cursor + rows (Pitfall 11).
    - `fullResync7d()` calls `client.listMessages({ q: 'newer_than:7d' })` with paging; for each message id fetches metadata (queued); after the final page atomically writes all rows + the `historyId` returned by `client.getProfile()`.
  </behavior>
  <action>
    Create `src/main/integrations/google/auth.ts` implementing the full loopback flow per the RESEARCH §"Pattern: OAuth Loopback Flow (Desktop)" shape. Export `connectGoogle(kind: 'gmail' | 'calendar')` (the calendar branch only needs to differ in SCOPES — plan 02-02 will reuse this same function). Define `SCOPES = { gmail: ['https://www.googleapis.com/auth/gmail.readonly'], calendar: ['https://www.googleapis.com/auth/calendar.readonly'] }`. Export `getOAuth2Client(kind)` for downstream consumers. Define and export `OAuthConfigMissingError`, `NoRefreshTokenError`, `TokenInvalidError` classes (TokenInvalidError carries a `reason: 'expired' | 'revoked'` field). The BrowserWindow MUST set `webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }` (Pitfall 18) with no `preload` script. Use a strong random `state` parameter and verify it on the redirect (CSRF defense for the loopback flow).

    Create `src/main/integrations/google/gmail.ts` defining the `GmailClient` interface verbatim per the `<interfaces>` block AND the googleapis-backed `createGmailClient(oauth2Client)` implementation. The implementation MUST translate googleapis errors per the behavior block, including the `invalid_grant` payload shape detection (H2). Export `HistoryInvalidatedError` and `GmailMessageMetadata` types.

    Create `src/main/integrations/google/sync-gmail.ts` exporting `class GmailSync` with constructor `({ db, client, scheduler, logger })` and methods `tick()` + `fullResync7d()`. All Google API calls AND all `db.transaction` writes go through `scheduler.queue.add(...)` (Pitfall 16: single-writer DB queue). Header parsing helper: `function header(msg, name)` walks `payload.headers` case-insensitively.

    Create `tests/unit/main/integrations/google/auth.spec.ts` (add to the file from Task 1):
    - Throws `OAuthConfigMissingError` when env vars are unset.
    - Generates a PKCE challenge (verify `code_challenge_method=S256` in the constructed auth URL).
    - Successful flow: when the loopback receives `?code=test-code&state=<expected>`, the OAuth2Client.getToken stub returns `{ refresh_token: 'rt', access_token: 'at' }`, getProfile returns email `foo@bar.com` → `setGoogleTokens` is called with `{ kind:'gmail', refreshToken:'rt', email:'foo@bar.com' }` and the function resolves `{ ok:true, email:'foo@bar.com' }`.
    - Throws `NoRefreshTokenError` when `getToken` returns no refresh_token (Pitfall 12).
    - State-mismatch redirect rejects with `OAuthStateMismatchError`.

    Create `tests/unit/main/integrations/google/gmail-wrapper.spec.ts` — the ONE `vi.mock('googleapis', ...)` test that proves the wrapper translates errors. Cases:
    - `users.history.list` throws `{ code: 404, errors: [{ reason: 'notFound' }] }` → wrapper throws `HistoryInvalidatedError`.
    - `users.messages.get` throws `{ code: 401, errors: [{ reason: 'invalid_grant' }] }` → wrapper throws `TokenInvalidError` with `reason: 'expired'`.
    - **H2: Google's actual test-mode payload** — `users.history.list` throws an error whose shape matches what google-auth-library raises after the 7d test-mode refresh: `{ response: { status: 400, data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } } }` → wrapper throws `TokenInvalidError` with `reason: 'expired'` (note: the string `'expired or revoked'` MUST map to `expired` because that is the test-mode 7d-expiry case; only explicit user revocation via Google account settings yields `reason: 'revoked'`).
    - Happy path: `users.history.list` returns `{ data: { history: [], historyId: '42' } }` → wrapper returns `{ history: [], historyId: '42' }`.

    Create `tests/unit/main/integrations/google/sync-gmail.spec.ts` injecting a `GmailClientFake` (no `vi.mock` needed — pure DI). Use a real temp SQLCipher DB created via Plan 01-02's `openDb({ runMigrationsOnOpen: true })` with a random 32-byte key. Cases:
    1. **First tick, no history_id**: fake `listMessages` returns 2 message ids; `getMessageMetadata` returns canned headers for each; tick runs full backfill → 2 rows in `gmail_message`, `gmail_account.history_id` = `getProfile().historyId`, `last_synced_at` populated.
    2. **Incremental tick happy path**: seed `history_id='100'`; fake `listHistory` returns `{ history: [{ messagesAdded: [{message:{id:'m3'}}] }], historyId: '101' }`; tick runs → 1 new row, `history_id` updated to `'101'`.
    3. **HistoryInvalidatedError → full resync**: seed `history_id='1'`; fake `listHistory` throws `HistoryInvalidatedError`; fake `listMessages` returns 3 ids (simulating a >7-day-sleep recovery); tick recovers → 3 rows + `history_id` updated to new value (proves no-silent-gap truth).
    4. **invalid_grant from google-auth-library (H2)**: fake `listHistory` throws `TokenInvalidError({reason:'expired'})` — constructed via the same path the wrapper would emit from the `{error:'invalid_grant', error_description:'Token has been expired or revoked.'}` payload; tick → `gmail_account.last_error === 'token-expired'`; tick re-throws so the IPC layer can surface it; one cron-tick window suffices for the banner to render (asserted by spy on `gmailStatus` returning `tokenStatus:'expired'` post-tick).
    5. **Atomicity**: when `upsertMany` fails mid-transaction, neither rows NOR `history_id` are advanced (assert via SELECT before/after — both unchanged).
    6. **Label parsing**: a message with `labelIds: ['INBOX','UNREAD','IMPORTANT']` → row has `is_unread=1, is_important=1, label_ids='["INBOX","UNREAD","IMPORTANT"]'`.
    7. **Queue routing**: spy on `scheduler.queue.add`; assert called ≥ once for the listHistory call AND ≥ once for the DB transaction (Pitfall 16 gate).
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/integrations/google</automated>
  </verify>
  <acceptance_criteria>
    - All 5 auth.spec.ts cases pass.
    - All 4 gmail-wrapper.spec.ts cases pass (including the H2 invalid_grant payload case).
    - All 7 sync-gmail.spec.ts cases pass.
    - `grep -c "access_type: 'offline'" src/main/integrations/google/auth.ts` returns ≥ 1.
    - `grep -c "prompt: 'consent'" src/main/integrations/google/auth.ts` returns ≥ 1.
    - `grep -c "code_challenge_method: 'S256'" src/main/integrations/google/auth.ts` returns ≥ 1.
    - `grep -c "nodeIntegration: false" src/main/integrations/google/auth.ts` returns ≥ 1.
    - `grep -c "contextIsolation: true" src/main/integrations/google/auth.ts` returns ≥ 1.
    - `grep -c "sandbox: true" src/main/integrations/google/auth.ts` returns ≥ 1.
    - `grep -c "setGoogleTokens" src/main/integrations/google/auth.ts` returns ≥ 1.
    - `grep -c "invalid_grant" src/main/integrations/google/gmail.ts` returns ≥ 1.
    - `grep -c "HistoryInvalidatedError" src/main/integrations/google/sync-gmail.ts` returns ≥ 1.
    - `grep -c "scheduler.queue.add\\|queue\\.add" src/main/integrations/google/sync-gmail.ts` returns ≥ 2.
    - `grep -c "db.transaction" src/main/integrations/google/sync-gmail.ts` returns ≥ 1.
    - `grep -c "from 'better-sqlite3-multiple-ciphers'" src/main/integrations/google/sync-gmail.ts` returns 0 (sync engine takes a Db arg; never opens the DB itself).
    - `grep -v '^[[:space:]]*//' src/main/integrations/google/sync-gmail.ts | grep -c "INSERT INTO gmail_message\\|UPSERT\\|INSERT OR REPLACE INTO gmail_message"` returns ≥ 1.
  </acceptance_criteria>
  <done>OAuth loopback flow is implemented and tested (PKCE + offline + consent + sandboxed BrowserWindow + state CSRF), the GmailClient wrapper translates googleapis errors to our domain errors (including Google's actual `invalid_grant` test-mode payload), GmailSync owns the history_id cursor atomically and recovers from invalidation, and every API call + DB write goes through Phase 1's single-writer scheduler queue.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: IPC handlers (gmail.ts) + 5-min cron registration + powerMonitor registerLifecycleCallbacks API + Settings Integrations row + StatusPanel extension + EMAIL-07 banner</name>
  <files>src/main/ipc/gmail.ts, src/main/ipc/index.ts, src/main/lifecycle/powerMonitor.ts, src/renderer/features/settings/IntegrationsSection.tsx, src/renderer/features/settings/StatusPanel.tsx, src/renderer/features/settings/SettingsScreen.tsx, tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx</files>
  <read_first>
    - src/main/ipc/index.ts (registerHandlers chain — Phase 1 baseline is 6 handlers: Onboarding, Backup, Secrets, Ollama, Ask, Diagnostics; append registerGmailHandlers as the 7th)
    - src/main/lifecycle/scheduler.ts (cronRegistry — Phase 2 first real consumer)
    - src/main/lifecycle/powerMonitor.ts (extend to expose `registerLifecycleCallbacks({ onSuspend?, onResume? })` so Plan 02-02 calendar-sync and Plan 02-04 briefing cron can also hook in; the API stores callbacks in an array invoked by the existing event listeners)
    - src/renderer/features/settings/SettingsScreen.tsx + StatusPanel.tsx (Phase 1 composite + status rows pattern)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"CASA / Unverified-App UX" (pre-OAuth modal copy)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md "Expired token UX (EMAIL-07)" — banner inside the affected section, NOT a modal
  </read_first>
  <behavior>
    - `registerGmailHandlers(ipcMain, deps)` registers four channels:
      - `GMAIL_CONNECT`: shows the pre-OAuth disclosure modal copy via return value (renderer renders the modal; user clicks "Continue" → renderer fires the actual `connect` call which proceeds to `connectGoogle('gmail')` + writes `gmail_account` row (`INSERT OR REPLACE WITH id=1, email=..., connected_at=now`)) + immediately enqueues a `GmailSync.tick()` (triggering the 7-day backfill).
      - `GMAIL_STATUS`: returns `GmailIntegrationStatus`. `tokenStatus = 'missing'` when no row; `'ok'` when row + no recent token error; `'expired'` when `last_error` starts with `token-expired`; `'revoked'` when `last_error` starts with `token-revoked`. `queueDepth = scheduler.queue.size + scheduler.queue.pending`.
      - `GMAIL_DISCONNECT`: stops the cron entry, calls `clearGoogleTokens('gmail')`, deletes the `gmail_account` row AND truncates `gmail_message` (so disconnect → reconnect starts clean).
      - `GMAIL_FORCE_SYNC`: enqueues `GmailSync.tick()` and returns when done.
    - On main startup (in `registerGmailHandlers` setup) when a `gmail_account` row exists, register a cron entry `gmail-sync` running every 5 minutes (`'*/5 * * * *'`) calling `GmailSync.tick()`. Register via `powerMonitor.registerLifecycleCallbacks({ onSuspend: () => cronRegistry.get('gmail-sync')?.stop(), onResume: () => cronRegistry.get('gmail-sync')?.start() })` (no back-fire — XCUT-01 enforced here for the gmail cron, generalized by plan 02-04 for the briefing cron).
    - `powerMonitor.registerLifecycleCallbacks({onSuspend?, onResume?})` is the new API: maintains internal `onSuspend[]` + `onResume[]` arrays; the existing event listeners (added in Phase 1) invoke every registered callback. Returns an unregister function. Plan 02-02 (calendar-sync) and Plan 02-04 (briefing) consume this API; Phase 1's existing logger-only behavior remains as the default with no registered callbacks.
    - `IntegrationsSection.tsx` renders a Gmail row with: connect button (if disconnected), email + connected-since timestamp + "Disconnect" + "Sync now" buttons (if connected), AND inline banner when `tokenStatus === 'expired' || 'revoked'` with copy: *"Aria's access to Gmail has expired. Re-connect to resume syncing. Calendar and other integrations are unaffected."* + a "Reconnect" button that re-runs the OAuth flow.
    - Pre-OAuth modal: renders before the BrowserWindow opens, copy = exact RESEARCH §"CASA / Unverified-App UX" recommendation (the "Google will show a warning that Aria hasn't been verified" pre-flight). Buttons: "Continue" / "Cancel".
    - `StatusPanel.tsx` gains a new `<IntegrationStatusRow kind="gmail" />` that polls `GMAIL_STATUS` every 10 seconds and renders sync state badge, queue depth, last_synced_at relative time, and last_error (if present, truncated to 80 chars).
    - The renderer unit test (`IntegrationsSection.spec.tsx`) covers the four UI states: disconnected / connected-ok / connected-expired (banner visible) / connected-revoked (banner visible with different copy variant).
  </behavior>
  <action>
    Create `src/main/ipc/gmail.ts` exporting `registerGmailHandlers(ipcMain, deps)`. Deps: `{ logger, dbHolder, scheduler }`. Construct one shared `GmailSync` per registration. Use `import cron from 'node-cron'` for the 5-min schedule; persist the `ScheduledTask` in `scheduler.cronRegistry` under key `'gmail-sync'`. The cron callback wraps the tick in `try { await sync.tick(); } catch (err) { logger.warn({ scope: 'gmail-sync', err: err.message }) }` — NEVER let cron crash the app.

    Update `src/main/ipc/index.ts` `registerHandlers` to append `registerGmailHandlers` as the 7th call (after Phase 1's six: Onboarding, Backup, Secrets, Ollama, Ask, Diagnostics). Wire the scheduler dep from the existing handle.

    Extend `src/main/lifecycle/powerMonitor.ts` to expose `registerLifecycleCallbacks({ onSuspend?, onResume? }): () => void`. Implementation:
    - Module-scoped arrays `onSuspendCallbacks: (() => void)[]` and `onResumeCallbacks: (() => void)[]`.
    - The existing `powerMonitor.on('suspend', ...)` and `powerMonitor.on('resume', ...)` listeners now iterate the arrays AFTER the existing logger.info call.
    - `registerLifecycleCallbacks` pushes into the arrays and returns an unregister function that splices them out.
    - Phase 1 default behavior (logger only) is preserved when no callbacks are registered.

    Create `src/renderer/features/settings/IntegrationsSection.tsx` rendering the Gmail row per the behavior block. Use the design tokens already shipped by Plan 01-01b. Component uses `useState` for the pre-OAuth modal visibility; polls `gmailStatus` on mount and after every action via TanStack Query or a simple `useEffect` polling pattern (mirror what Phase 1's `OllamaStatusRow` does).

    Extend `src/renderer/features/settings/StatusPanel.tsx` to render `<IntegrationStatusRow kind="gmail" />`. Build that subcomponent with a 10s polling interval. Layout: badge (idle/syncing/error/expired), email, last_synced_at relative (using `Intl.RelativeTimeFormat`), queue depth ("queued: N"), and a truncated `last_error` (or empty).

    Update `src/renderer/features/settings/SettingsScreen.tsx` to mount `<IntegrationsSection />` as a new section under `data-testid="settings-integrations"` between the existing Secrets section and Diagnostics section. Phase-1 sections remain mounted.

    Create `tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx` using `@testing-library/react` + `vi.fn()` stubs for `window.aria.gmailStatus / gmailConnect / gmailDisconnect / gmailForceSync`. Cases:
    1. **Disconnected**: `gmailStatus` returns `{ connected: false, tokenStatus: 'missing', queueDepth: 0 }` → renders "Connect Gmail" button, no banner, no email display.
    2. **Connected (ok)**: returns `{ connected:true, email:'foo@bar.com', tokenStatus:'ok', queueDepth:0, lastSyncedAt: <recent ISO> }` → renders email, "Sync now" + "Disconnect" buttons, NO EMAIL-07 banner.
    3. **Connected (expired token)**: returns `{ connected:true, email:'foo@bar.com', tokenStatus:'expired', queueDepth:0, lastError:'token-expired' }` → renders EMAIL-07 banner with EXACT copy "Aria's access to Gmail has expired. Re-connect to resume syncing. Calendar and other integrations are unaffected." AND a "Reconnect" button.
    4. **Connected (revoked token)**: similar to (3) with a slightly different banner copy variant ("Aria's access to Gmail was revoked").
    5. **Pre-OAuth modal**: clicking "Connect Gmail" renders the modal with the RESEARCH-§10 disclosure copy + "Continue" / "Cancel". Clicking "Cancel" closes the modal WITHOUT calling `gmailConnect`. Clicking "Continue" calls `gmailConnect` exactly once.
    6. **Other integrations unaffected (SC3 mechanic)**: the IntegrationsSection container also receives `calendarStatus: { connected: true, tokenStatus: 'ok' }` and the Gmail-expired banner does NOT visually overlap or hide the Calendar row.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx tests/unit/main/integrations/google && npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - All 6 IntegrationsSection.spec.tsx cases pass.
    - `grep -c "registerGmailHandlers" src/main/ipc/index.ts` returns ≥ 1.
    - `grep -cE '^\s*register[A-Za-z]+Handlers\(ipcMain' src/main/ipc/index.ts` returns 7 (Phase 1 baseline 6 + Gmail).
    - `grep -c "'\\*/5 \\* \\* \\* \\*'" src/main/ipc/gmail.ts` returns ≥ 1.
    - `grep -c "cronRegistry.set\\|cronRegistry\\.get" src/main/ipc/gmail.ts` returns ≥ 1.
    - `grep -c "registerLifecycleCallbacks" src/main/lifecycle/powerMonitor.ts` returns ≥ 1.
    - `grep -c "registerLifecycleCallbacks" src/main/ipc/gmail.ts` returns ≥ 1.
    - `grep -c "Re-connect to resume syncing" src/renderer/features/settings/IntegrationsSection.tsx` returns ≥ 1 (EMAIL-07 banner copy locked).
    - `grep -c "Calendar and other integrations are unaffected" src/renderer/features/settings/IntegrationsSection.tsx` returns ≥ 1 (SC3 mechanic phrasing locked).
    - `grep -c "IntegrationStatusRow" src/renderer/features/settings/StatusPanel.tsx` returns ≥ 1.
    - `grep -c "data-testid=\"settings-integrations\"" src/renderer/features/settings/SettingsScreen.tsx` returns ≥ 1.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>Gmail integration is wired end-to-end: connect/disconnect/status/force-sync IPC channels live, 5-min cron registered with powerMonitor pause/resume hooks via the new `registerLifecycleCallbacks` API (no back-fire on resume → XCUT-01 partial), Settings → Integrations renders the Gmail row with pre-OAuth disclosure modal + EMAIL-07 re-auth banner, and StatusPanel surfaces sync state + queue depth + last error.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User → Google OAuth consent | User authorizes Aria; unverified-app warning expected during CASA review |
| Browser (OAuth window) → Loopback HTTP | 127.0.0.1 only; state param defends CSRF; BrowserWindow sandboxed (no node) |
| Main process → Google APIs | TLS; bearer access_token short-lived; refresh_token at rest in safeStorage |
| Main → SQLCipher gmail_message | Whole-DB AES; only metadata persisted in Phase 2 |
| Renderer → Main gmail handlers | Refresh tokens NEVER cross IPC; renderer only sees `GmailIntegrationStatus` and triggers actions |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-01-01 | Information Disclosure | OAuth refresh_token leaked via SQLCipher backup | mitigate (HIGH) | Tokens in safeStorage `googleTokens` subtree only; gmail_account row holds only email + history_id (Pitfall 13); grep-gate on `refresh_token` in db migrations |
| T-02-01-02 | Information Disclosure | OAuth code / bearer logged | mitigate (HIGH) | Added redact rules in `redact.ts` for `Bearer ...` and `code=...`; loopback redirect URL never logged with query string |
| T-02-01-03 | Tampering | Renderer hijacks OAuth window via node integration | mitigate (HIGH; Pitfall 18) | BrowserWindow has nodeIntegration:false, contextIsolation:true, sandbox:true, no preload; grep-gate enforces |
| T-02-01-04 | Spoofing | CSRF on loopback redirect (attacker tricks user to visit `127.0.0.1:port/callback?code=...`) | mitigate (MEDIUM) | OAuth state parameter (32 bytes random) generated per flow; mismatched state → reject |
| T-02-01-05 | Repudiation | No proof which scopes were granted | mitigate (LOW) | gmail_account.connected_at + SCOPES constant in auth.ts; future audit log records integration connect events (Phase 3) |
| T-02-01-06 | Denial of Service | Gmail API quota burst on first-connect backfill | mitigate (MEDIUM) | All API calls through `scheduler.queue` concurrency=1; metadata format keeps quota cost low (Pitfall 11 quota note) |
| T-02-01-07 | Information Disclosure | Message bodies persisted in DB enable surface for breach | accept (LOW for Phase 2) | Phase 2 uses `format='metadata'` only — no body bytes stored. Phase 3 will re-evaluate when summarization needs body. |
| T-02-01-08 | Tampering | historyId rolled back leaves DB with phantom messages | mitigate (MEDIUM) | `db.transaction(...)` wraps rows + historyId; on transaction failure neither is advanced (sync-gmail.spec case 5) |
| T-02-01-09 | Elevation of Privilege | Renderer fires `gmailDisconnect` while a sync is mid-write | mitigate (LOW) | Disconnect goes through `scheduler.queue.add(...)` → serializes with in-flight sync |
</threat_model>

<verification>
- All three `<automated>` commands pass on Windows 11 with Electron 41.6.1 + the patched better-sqlite3-multiple-ciphers
- Manual: with `.env.local` populated, click "Connect Gmail" → see pre-OAuth modal → "Continue" opens Google's consent screen → after consent the loopback receives the code → IntegrationsSection shows the connected email within ~5 seconds → after ≤ 5 minutes of waiting (or "Sync now") `SELECT COUNT(*) FROM gmail_message` ≥ 1 for any account with mail in the last 7 days
- Manual: with the OAuth client in "Testing" status and the refresh token aged past 7 days, the next cron tick records `last_error='token-expired'` and IntegrationsSection renders the EMAIL-07 banner within one tick; Calendar row (after Plan 02-02) and Diagnostics section remain operational (SC3)
- Phase-1 regression: Phase-1's secrets, settings, onboarding, backup, ask, diagnostics IPC channels all still pass (`npm run test:unit -- tests/unit/main/ipc tests/unit/main/secrets`)
- The sync-gmail spec proves the 5-min mechanic; the per-user-facing 5-min SLA (SC1) is finalized by Plan 02-04's BriefingScreen rendering the message
</verification>

<success_criteria>
Plan 02-01 closes EMAIL-01 (Gmail OAuth + incremental ingest mechanic), EMAIL-07 (re-auth banner UX), and the Gmail half of XCUT-06 (status panel row). Contributes the mechanic for ROADMAP SC1 (new mail within 5 min — user-facing surface lands in Plan 02-04) and SC3 (expired-token banner; other features unaffected — Calendar half lands in Plan 02-02).
</success_criteria>

<out_of_scope>
- Calendar OAuth + sync (Plan 02-02)
- News sources (Plan 02-03)
- Briefing generation + BriefingScreen (Plan 02-04)
- Daily cron + sleep/wake coalescing for the briefing trigger (Plan 02-04) — THIS plan handles only the Gmail-sync cron's pause/resume
- Gmail message body ingest (Phase 3)
- gmail.send scope (Phase 3)
- Multi-account Gmail (Phase 5+)
- Outlook ingest (Phase 5)
- "Today's events" recurring-event expansion (Plan 02-04's briefing read path)
</out_of_scope>

<handoff>
Plan 02-02 (Calendar) reuses `connectGoogle('calendar')`, the `OAuth2Client` factory, the `scheduler.queue` discipline, the `IntegrationsSection` row pattern, AND the `powerMonitor.registerLifecycleCallbacks` API extended in Task 3. Plan 02-04 (Briefing) consumes `gmail_message` rows directly (priority-email candidates: `is_unread=1 AND is_important=1 AND received_at >= now-24h`) and the `IntegrationStatusRow` pattern in StatusPanel.
</handoff>

<output>
After completion, create `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-01-SUMMARY.md` describing:
- Pinned versions of googleapis + google-auth-library from package-lock.json
- Confirmation Electron is still at 41.6.1 and the SQLCipher patch is still applied
- Sample rows from `gmail_account` and `gmail_message` from a real dogfood connect (with `from_addr` redacted)
- Confirmation that the seven handler-registration functions are wired in `src/main/ipc/index.ts` (Onboarding, Backup, Secrets, Ollama, Ask, Diagnostics, Gmail)
- Confirmation that the EMAIL-07 banner copy is the exact locked string
- Confirmation that `powerMonitor.registerLifecycleCallbacks` is exported and consumed by gmail-sync
- Observed behavior of the invalid_grant payload during a real test-mode 7d-expiry (or a forced simulation)
- Open issues to forward to Plan 02-02 / 02-03 / 02-04
</output>
</content>
</invoke>
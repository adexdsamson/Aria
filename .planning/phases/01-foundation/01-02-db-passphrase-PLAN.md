---
phase: 01-foundation
plan: 02
type: execute
wave: 2
depends_on: ["01-foundation/01"]
files_modified:
  - src/main/db/connect.ts
  - src/main/db/migrations/001_init.sql
  - src/main/db/migrations/runner.ts
  - src/main/db/backup.ts
  - src/main/db/restore.ts
  - src/main/vault/mnemonic.ts
  - src/main/vault/derive.ts
  - src/main/vault/unlock.ts
  - src/main/vault/storage.ts
  - src/main/ipc/onboarding.ts
  - src/main/ipc/backup.ts
  - src/renderer/features/onboarding/OnboardingWizard.tsx
  - src/renderer/features/onboarding/MnemonicShow.tsx
  - src/renderer/features/onboarding/MnemonicConfirm.tsx
  - src/renderer/features/onboarding/UnlockScreen.tsx
  - src/renderer/features/settings/BackupRestoreSection.tsx
  - tests/unit/main/db/migrations.spec.ts
  - tests/unit/main/db/backup-restore.spec.ts
  - tests/unit/main/vault/derive.spec.ts
  - tests/unit/main/vault/unlock.spec.ts
  - tests/unit/main/vault/mnemonic.spec.ts
  - tests/e2e/onboarding.spec.ts
autonomous: true
requirements: [FOUND-02, FOUND-03, FOUND-04]
tags: [sqlite, sqlcipher, bip39, scrypt, onboarding, backup-restore]

must_haves:
  truths:
    - "First-launch onboarding generates a 12-word BIP39 mnemonic, displays it once, and requires re-entering 3 words at random positions before proceeding"
    - "On subsequent launches, the daily-unlock password decrypts vault.json, unwraps the mnemonic, derives the 32-byte SQLCipher key via scrypt(N=2^15,r=8,p=1), and opens aria.db"
    - "aria.db is unreadable by a stock sqlite3 CLI without the key"
    - "User can produce an encrypted .ariabackup file and restore it on the same machine (and architecturally on a different machine using only the mnemonic)"
    - "Migration runner is driven by PRAGMA user_version and creates app_meta, routing_log, and settings tables"
    - "Frontier API keys and OAuth tokens are NOT in the backup file (D-04)"
  artifacts:
    - path: "src/main/db/connect.ts"
      provides: "Open SQLCipher DB with PRAGMA cipher='chacha20' + PRAGMA key=\"x'<hex>'\"; run migrations"
      exports: ["openDb", "closeDb", "Db"]
    - path: "src/main/db/migrations/001_init.sql"
      provides: "Initial schema: app_meta, routing_log, settings"
      contains: "CREATE TABLE app_meta"
    - path: "src/main/db/migrations/runner.ts"
      provides: "user_version-driven migration runner"
      exports: ["runMigrations"]
    - path: "src/main/db/backup.ts"
      provides: ".ariabackup creation via VACUUM INTO preserving same SQLCipher key"
      exports: ["createBackup"]
    - path: "src/main/db/restore.ts"
      provides: "Restore .ariabackup into userData (replaces aria.db) after mnemonic verification"
      exports: ["restoreBackup"]
    - path: "src/main/vault/mnemonic.ts"
      provides: "BIP39 generate/validate/positions-to-confirm via @scure/bip39"
      exports: ["generateMnemonic", "validateMnemonic", "pickConfirmPositions"]
    - path: "src/main/vault/derive.ts"
      provides: "mnemonic + appSalt → 32-byte SQLCipher key via scrypt(N=2^15,r=8,p=1)"
      exports: ["deriveDbKey"]
    - path: "src/main/vault/unlock.ts"
      provides: "daily-password → AES-256-GCM unwrap of vault.json → mnemonic in main RAM"
      exports: ["sealVault", "unlockVault", "isVaultPresent"]
  key_links:
    - from: "src/main/ipc/onboarding.ts"
      to: "src/main/vault/mnemonic.ts + src/main/vault/derive.ts + src/main/db/connect.ts"
      via: "onboarding seals vault, derives key, opens db, runs migrations, writes app_meta salt"
      pattern: "deriveDbKey\\("
    - from: "src/renderer/features/onboarding/OnboardingWizard.tsx"
      to: "window.aria.onboardingGenMnemonic / onboardingConfirm / onboardingSeal"
      via: "preload IPC bridge"
      pattern: "window\\.aria\\.onboarding"
    - from: "src/main/db/backup.ts"
      to: "src/main/db/connect.ts"
      via: "VACUUM INTO using the live key; backup is same-cipher same-key copy"
      pattern: "VACUUM\\s+INTO"
---

<objective>
Phase Goal

**As a** new Aria user, **I want to** set a recovery passphrase during onboarding and have all my data encrypted at rest, **so that** my private executive data is unrecoverable from disk without my mnemonic and the daily password I chose.

Purpose: Establish the encryption substrate every later phase persists into. Implements D-01..D-04 (hybrid passphrase, daily unlock, 3-word confirmation, portable encrypted backup). Bypasses SQLCipher's GPU-cheap PBKDF2 default by passing a raw scrypt-derived key. Defines the migration framework (numbered .sql + `PRAGMA user_version`) every later phase will use.

Output: SQLCipher-encrypted `aria.db`; vault-sealed BIP39 mnemonic in `vault.json`; onboarding wizard with show + 3-word confirm; daily unlock screen; encrypted `.ariabackup` backup/restore round-trip.
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
@.planning/phases/01-foundation/01-CONTEXT.md
@.planning/phases/01-foundation/01-RESEARCH.md
@.planning/phases/01-foundation/SKELETON.md
@.planning/phases/01-foundation/01-01-SUMMARY.md
@src/shared/ipc-contract.ts
@src/main/index.ts
@src/main/log/pino.ts
@src/main/ipc/index.ts

<interfaces>
<!-- Plan-01 already created these channels in CHANNELS; this plan IMPLEMENTS them: -->
<!-- ASK_ARIA — stubbed; plan-04 implements -->
<!-- ONBOARDING_GEN_MNEMONIC: () => Promise<{ words: string[] }> -->
<!-- ONBOARDING_CONFIRM: (req: { positions: number[]; answers: string[] }) => Promise<{ ok: boolean }> -->
<!-- ONBOARDING_SEAL: (req: { mnemonic: string; dailyPassword: string }) => Promise<{ ok: true }> -->
<!-- ONBOARDING_UNLOCK: (req: { dailyPassword: string }) => Promise<{ ok: boolean }> -->
<!-- ONBOARDING_STATUS: () => Promise<{ vaultPresent: boolean; dbOpen: boolean }> -->
<!-- BACKUP_CREATE: () => Promise<{ path: string }> -->
<!-- BACKUP_RESTORE: (req: { backupPath: string; mnemonic: string; dailyPassword: string }) => Promise<{ ok: true }> -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Vault primitives — mnemonic, scrypt key derivation, AES-256-GCM-sealed vault.json</name>
  <files>src/main/vault/mnemonic.ts, src/main/vault/derive.ts, src/main/vault/unlock.ts, src/main/vault/storage.ts, tests/unit/main/vault/mnemonic.spec.ts, tests/unit/main/vault/derive.spec.ts, tests/unit/main/vault/unlock.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md lines 343-365 (Pattern 3: BIP39 → SQLCipher key with scrypt N=2^15)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 488-498 (Critical anti-patterns: do NOT store mnemonic in safeStorage; do NOT store SQLCipher key on disk)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 778-795 (KDF design rationale — raw key bypasses SQLCipher PBKDF2; AES-256-GCM for vault.json)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-01 hybrid passphrase, D-03 3-word confirm, D-04 backup portability)
    - src/main/log/pino.ts (logger used for vault errors; never log mnemonic or key bytes)
  </read_first>
  <behavior>
    - `generateMnemonic()` returns 12 English BIP39 words from `@scure/bip39` strength 128
    - `validateMnemonic(words)` returns true only for a valid checksummed 12-word phrase
    - `pickConfirmPositions(seed?)` returns 3 distinct indices in [0..11] used for the D-03 challenge
    - `deriveDbKey(mnemonic, appSalt)` returns a 32-byte `Buffer` produced by `crypto.scrypt(NFKD(mnemonic), appSalt, 32, { N: 1<<15, r: 8, p: 1 })`
    - `sealVault(dailyPassword, mnemonic, vaultPath)` writes `vault.json` containing salt, nonce, ciphertext, tag — all base64; ciphertext is AES-256-GCM over the UTF-8 mnemonic; KDF is `crypto.scrypt(dailyPassword, vaultSalt, 32, { N: 1<<15, r: 8, p: 1 })`
    - `unlockVault(dailyPassword, vaultPath)` returns the mnemonic string on success, throws `VaultUnlockError` on wrong password or tampered file
    - A successful unlock zero-fills the derived password key buffer before return (best-effort `key.fill(0)`)
    - No mnemonic, password, or DB key ever passes through `logger.info/warn`; failures log only `{ event: 'vault.unlock.failed' }` with no payload
  </behavior>
  <action>
    Create `src/main/vault/mnemonic.ts` exporting `generateMnemonic()`, `validateMnemonic(s: string)`, `pickConfirmPositions(rng?: () => number): [number,number,number]`. Use `@scure/bip39` and the English wordlist (`@scure/bip39/wordlists/english`). `pickConfirmPositions` defaults RNG to `crypto.randomInt`; returns three distinct sorted indices in [0,11] (e.g. `[3, 6, 10]` corresponds to D-03 example "#4, #7, #11" — note 0-indexed in code).

    Create `src/main/vault/derive.ts` exporting `deriveDbKey(mnemonic: string, appSalt: Buffer): Promise<Buffer>` using `node:crypto.scrypt` with `{ N: 1<<15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }` and 32-byte output over `mnemonic.normalize('NFKD')`. Also export `toPragmaKeyHex(key: Buffer): string` returning `key.toString('hex')` for use in `PRAGMA key="x'<hex>'"`.

    Create `src/main/vault/storage.ts` exporting low-level read/write helpers for `vault.json` (atomic write via `fs.writeFile` to `.tmp` then `fs.rename`; throws `VaultMissingError` on read miss). Vault JSON shape: `{ v: 1, kdf: { algo: 'scrypt', N: 32768, r: 8, p: 1, salt: <b64> }, cipher: { algo: 'aes-256-gcm', nonce: <b64>, ct: <b64>, tag: <b64> } }`.

    Create `src/main/vault/unlock.ts` exporting `sealVault`, `unlockVault`, `isVaultPresent`, plus custom errors `VaultUnlockError`, `VaultMissingError`, `VaultTamperedError`. `sealVault`: generate 16-byte salt + 12-byte nonce, derive 32-byte key, `crypto.createCipheriv('aes-256-gcm', key, nonce)`, encrypt utf-8 mnemonic, write JSON. `unlockVault`: read JSON, re-derive key with same scrypt params, `createDecipheriv`, `setAuthTag(tag)`, decrypt; on bad tag throw `VaultTamperedError`. After unlock, call `key.fill(0)` before return.

    Write the three vitest specs. `mnemonic.spec.ts` asserts generate returns 12 words, all in wordlist, passes validate; tampering one word fails validate; `pickConfirmPositions` returns 3 distinct sorted indices in [0,11]. `derive.spec.ts` asserts `deriveDbKey('abandon abandon ... about', salt)` is deterministic across calls and is 32 bytes; uses a fixed mnemonic from the BIP39 test vectors (e.g. `abandon` × 11 + `about`) and a fixed salt to lock in a known hex value (capture the produced hex on first run, then assert against it on subsequent runs — prevents accidental KDF parameter drift across plans). `unlock.spec.ts` asserts sealVault → unlockVault round-trip recovers the mnemonic; wrong password throws `VaultUnlockError`; flipping one byte of ciphertext throws `VaultTamperedError`.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/vault</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/vault/mnemonic.spec.ts` passes (≥4 assertions)
    - `tests/unit/main/vault/derive.spec.ts` passes; locks a known hex value for the `abandon×11 about` + fixed salt test vector
    - `tests/unit/main/vault/unlock.spec.ts` passes including the `VaultTamperedError` branch
    - `grep -c "console.log" src/main/vault/*.ts` returns `0`
    - `grep -c "logger.info" src/main/vault/*.ts` returns `0` (only `logger.warn`/`error` with non-sensitive event names allowed)
    - `grep -c "N: 1 *<< *15" src/main/vault/derive.ts` returns ≥`1` (KDF parameter pinned)
    - `grep -c "aes-256-gcm" src/main/vault/unlock.ts` returns ≥`1`
  </acceptance_criteria>
  <done>Vault primitives deterministic, audited via tests, never leak secrets into logs; KDF parameters pinned by tests so future edits trip the suite.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: SQLCipher DB connection, migration runner, backup, restore</name>
  <files>src/main/db/connect.ts, src/main/db/migrations/001_init.sql, src/main/db/migrations/runner.ts, src/main/db/backup.ts, src/main/db/restore.ts, tests/unit/main/db/migrations.spec.ts, tests/unit/main/db/backup-restore.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md lines 311-340 (Pattern 2: SQLCipher open + cipher selection + PRAGMA order)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 480-500 (Pattern 7: VACUUM INTO preserves same key)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 522-532 (Pitfall 1: do NOT load sqlite-vec in Phase 1)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 528-535 (Pitfall 2: electron-rebuild for native ABI on Windows)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 695-720 (routing_log schema preview — defined in Plan 04, but app_meta + settings created here)
    - src/main/vault/derive.ts (created task 1 — produces the 32-byte key passed to PRAGMA key)
    - src/main/log/pino.ts (logger; ALL DB log events redact sql params via redactObject)
  </read_first>
  <behavior>
    - `openDb({ dataDir, dbKey, runMigrationsOnOpen })` opens (or creates) `<dataDir>/aria.db` via better-sqlite3-multiple-ciphers
    - Cipher selection: `PRAGMA cipher='chacha20'` issued BEFORE `PRAGMA key="x'<32-byte-hex>'"`
    - Migration runner reads numbered files in `src/main/db/migrations/*.sql`, compares to `PRAGMA user_version`, applies in transactions, updates `user_version` after each
    - `001_init.sql` creates `app_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)`, `settings(k TEXT PRIMARY KEY, v TEXT NOT NULL)`, `routing_log(...)` (full routing_log columns defined here; Plan 04 writes rows)
    - On first open, `appSalt` row is inserted into `app_meta` (16 random bytes, base64) — same salt used by `deriveDbKey` from then on
    - `createBackup({ outPath })` calls `VACUUM INTO '<outPath>'` while the DB is open with the live key; output is a same-cipher same-key SQLCipher file
    - `restoreBackup({ backupPath, mnemonic, dailyPassword })`: derives key from mnemonic + (backup's own appSalt extracted via an open-test), opens the backup file to verify it decrypts, then atomically replaces `<dataDir>/aria.db` with the backup; if the open-test fails throws `RestoreInvalidError`
    - `sqlite-vec` is NOT loaded; the connect path has no `loadExtension` call
    - A stock `sqlite3` CLI cannot read `aria.db` (manually verified per VALIDATION.md Manual-Only)
  </behavior>
  <action>
    Create `src/main/db/connect.ts` exporting `openDb` and `closeDb` and a `Db` type alias for the better-sqlite3-multiple-ciphers `Database` instance. Open sequence per RESEARCH Pattern 2: `new Database(path)` → `db.pragma("cipher='chacha20'")` → `db.pragma(\`key="x'${keyHex}'"\`)` → `db.pragma('cipher_page_size=4096')` → `db.pragma('journal_mode=WAL')` → `db.pragma('foreign_keys=ON')` → optional `runMigrations(db)`. On any pragma error close and throw `DbOpenError`. On first-time open (app_meta empty), insert `appSalt` row with `crypto.randomBytes(16).toString('base64')`. Export `getAppSalt(db)` helper.

    Create `src/main/db/migrations/001_init.sql` with three statements: (1) `CREATE TABLE app_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);` (2) `CREATE TABLE settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);` (3) `CREATE TABLE routing_log( id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, route TEXT NOT NULL CHECK (route IN ('LOCAL','FRONTIER')), reason TEXT NOT NULL, source TEXT NOT NULL, prompt_hash TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER NOT NULL, ok INTEGER NOT NULL CHECK (ok IN (0,1)) );` plus an index `CREATE INDEX idx_routing_log_ts ON routing_log(ts DESC);`. Plan 04 inserts rows.

    Create `src/main/db/migrations/runner.ts` exporting `runMigrations(db)`. Algorithm: read all `*.sql` files from migrations dir sorted lexicographically; current = `db.pragma('user_version', { simple: true })`; for each file whose numeric prefix > current, execute inside `db.transaction(() => { db.exec(sql); db.pragma(\`user_version=${target}\`); })`. Log each applied migration via `logger.info({ event: 'db.migrate.applied', version: target, file })`.

    Create `src/main/db/backup.ts` exporting `createBackup(db, { outPath })`: runs `db.exec(\`VACUUM INTO '${outPath.replace(/'/g, "''")}'\`)`. Wraps in try/catch; if `outPath` exists, `fs.unlink` first (or refuse based on `overwrite` flag default false). Logs `{ event: 'db.backup.created' }` with sanitized path.

    Create `src/main/db/restore.ts` exporting `restoreBackup({ dataDir, backupPath, mnemonic, dailyPassword })`. Steps: (1) call `unlockVault` no — actually skip vault entirely since mnemonic is provided directly; (2) read appSalt from the BACKUP file by attempting `openDb` against a TEMP path-copy of the backup using a DERIVED key — chicken-and-egg: appSalt is INSIDE the encrypted DB. Resolution: define a per-app constant appSalt baseline path — instead, store appSalt in `vault.json`'s ASSOCIATED data on seal, so restore can read appSalt directly without opening the encrypted DB. Implementation: extend `vault.json` schema with `{ ..., appSalt: <b64> }` (NOT secret; used as KDF salt). Update `vault/unlock.ts` `sealVault` signature to take `appSalt` as well; update task-1 spec to cover this (this task adds the schema field). Then `restoreBackup` reads `vault.json` appSalt, derives key from mnemonic + appSalt, opens the backup copy with that key, on success closes and `fs.rename`s the backup over `aria.db`. On open failure throw `RestoreInvalidError`.

    Create `tests/unit/main/db/migrations.spec.ts` using a temp dir + ephemeral 32-byte key (from `crypto.randomBytes(32)`): assert opening a fresh DB then running migrations creates the three tables (`db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()` contains `app_meta`, `settings`, `routing_log`); `user_version` is 1; re-running runMigrations is a no-op. Also assert that opening with WRONG key throws (replays the misuse — sanity check that encryption is actually on).

    Create `tests/unit/main/db/backup-restore.spec.ts`: open DB with random key, insert a row in `settings`, call `createBackup({ outPath: <tmp> })`, open the backup with the same key, assert the row is present. Then call `restoreBackup` with mismatched mnemonic — assert `RestoreInvalidError`. Tests run in vitest `node` project; do NOT require an Electron environment.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/db</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/db/migrations.spec.ts` passes; wrong-key open is rejected
    - `tests/unit/main/db/backup-restore.spec.ts` passes including the `RestoreInvalidError` branch
    - `grep -c "cipher='chacha20'" src/main/db/connect.ts` returns ≥`1`
    - `grep -c "loadExtension" src/main/db` (any file) returns `0` — sqlite-vec NOT loaded in Phase 1
    - `grep -c "VACUUM INTO" src/main/db/backup.ts` returns ≥`1`
    - `001_init.sql` contains `CREATE TABLE app_meta`, `CREATE TABLE settings`, `CREATE TABLE routing_log`
    - `routing_log` schema contains all columns required by Plan 04: `ts, route, reason, source, prompt_hash, model, latency_ms, ok`
  </acceptance_criteria>
  <done>SQLCipher DB created with chacha20 cipher, migrations applied via user_version, backup/restore round-trips through VACUUM INTO; sqlite-vec correctly deferred.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Onboarding wizard, unlock screen, backup/restore UI, IPC wiring</name>
  <files>src/main/ipc/onboarding.ts, src/main/ipc/backup.ts, src/main/ipc/index.ts, src/renderer/features/onboarding/OnboardingWizard.tsx, src/renderer/features/onboarding/MnemonicShow.tsx, src/renderer/features/onboarding/MnemonicConfirm.tsx, src/renderer/features/onboarding/UnlockScreen.tsx, src/renderer/features/settings/BackupRestoreSection.tsx, src/renderer/app/App.tsx, tests/e2e/onboarding.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-01..D-04 + D-11..D-13)
    - src/shared/ipc-contract.ts (channel constants + payload types)
    - src/main/ipc/index.ts (stub-registration scaffold from plan-01)
    - src/main/vault/unlock.ts, src/main/vault/mnemonic.ts, src/main/db/connect.ts (this plan, tasks 1+2)
    - src/renderer/features/settings/SettingsScreen.tsx (placeholder created in plan-01)
  </read_first>
  <behavior>
    - On launch, main process checks `isVaultPresent(<userData>/vault.json)`; if absent, renderer routes to `/onboarding`; if present, renderer routes to `/unlock`; once unlocked, renderer routes to the default `/briefing`
    - Onboarding step 1 generates and displays the 12-word mnemonic (renderer never receives the mnemonic — it stays in main RAM; renderer receives only the visible word list to display; on "Continue" the wizard discards its local copy)
    - Onboarding step 2 asks for words at 3 random positions (D-03); answers are submitted via `onboardingConfirm`; main verifies against the in-RAM mnemonic
    - Onboarding step 3 collects a daily-unlock password (min 8 chars, no strength meter in v1); `onboardingSeal` writes vault.json with appSalt + sealed mnemonic, derives DB key, opens aria.db, runs migrations
    - Unlock screen on subsequent launches: user enters daily password; main calls `unlockVault`, derives key, opens DB; on 5 consecutive failures shows a `Forgot password? Restore from backup` link
    - Settings → Backup/Restore section offers two actions: "Create backup" (calls `backupCreate`, returns file path written via Electron `dialog.showSaveDialog`) and "Restore backup" (asks for mnemonic + daily password + file path via `dialog.showOpenDialog`, calls `backupRestore`)
    - Playwright e2e: launch with fresh userData → step through onboarding → reach briefing screen
  </behavior>
  <action>
    Create `src/main/ipc/onboarding.ts` exporting `registerOnboardingHandlers(ipcMain, deps)` where deps is `{ logger, dataDir, dbHolder }`. Implementation: keep a module-scoped `pendingMnemonic: string | null` populated by `ONBOARDING_GEN_MNEMONIC` (returns words to renderer) and cleared on seal. `ONBOARDING_CONFIRM` verifies the supplied answers match `pendingMnemonic.split(' ')` at given positions. `ONBOARDING_SEAL` requires `pendingMnemonic` non-null, calls `sealVault(dailyPassword, pendingMnemonic, vaultPath, appSalt = crypto.randomBytes(16))`, derives DB key, opens DB with `runMigrationsOnOpen: true`, stores the live `Db` handle on `dbHolder` (shared singleton across IPC handlers — Plan 04 also reads from it). `ONBOARDING_UNLOCK` reads vault.json, calls `unlockVault`, derives key, opens DB, stores on `dbHolder`. `ONBOARDING_STATUS` returns `{ vaultPresent: isVaultPresent(vaultPath), dbOpen: dbHolder.isOpen }`.

    Create `src/main/ipc/backup.ts` exporting `registerBackupHandlers(ipcMain, deps)` with deps `{ logger, dataDir, dbHolder }`. `BACKUP_CREATE` calls `dialog.showSaveDialog` (defaultPath `aria-<isoDate>.ariabackup`, filter `*.ariabackup`); on confirm calls `createBackup(dbHolder.db, { outPath })` and returns the path. `BACKUP_RESTORE` calls `restoreBackup({ dataDir, backupPath, mnemonic, dailyPassword })`; on success re-opens the new DB and assigns to dbHolder; instructs renderer to reload (return `{ ok: true, restartRequired: true }`).

    Update `src/main/ipc/index.ts` `registerHandlers` to accept a `dbHolder` shared object and to call `registerOnboardingHandlers` + `registerBackupHandlers` with the live deps. Remove the previous no-op stubs for the channels handled here.

    Create the four renderer files. `OnboardingWizard.tsx` is a 3-step state machine (show → confirm → password). `MnemonicShow.tsx` displays the 12 words in a 4×3 grid + a "I've written these down" toggle that gates Continue. `MnemonicConfirm.tsx` displays 3 inputs labeled by the positions returned from `pickConfirmPositions` and submits to `onboardingConfirm`; on failure, regenerate position challenge and show a friendly retry message. `UnlockScreen.tsx` has a password field + Unlock button + counter; after 5 failures shows the `Forgot password? Restore from backup` link routing to `/restore`.

    Create `src/renderer/features/settings/BackupRestoreSection.tsx` with two buttons + file-dialog wrapping. Mount it inside `SettingsScreen.tsx` under the `data-testid="settings-onboarding"` block (rename to `settings-backup` if cleaner; update the e2e test selector accordingly).

    Update `src/renderer/app/App.tsx`: on mount, call `window.aria.onboardingStatus()`; if `!vaultPresent`, render `<OnboardingWizard/>` and block side-nav; if vaultPresent && !dbOpen, render `<UnlockScreen/>` and block side-nav; once unlocked, render the existing layout.

    Create `tests/e2e/onboarding.spec.ts`: launch with an isolated temp userData (use the factory in `tests/setup.ts`); assert the wizard appears; programmatically click through (vitest+Playwright can't read the on-screen mnemonic from a sealed render — instead, expose a test-only IPC hook gated by `process.env.ARIA_E2E === '1'` that returns the current `pendingMnemonic` so the e2e can submit the correct 3-word answer; set the env in `playwright.config.ts`). Submit a daily password ("correct-horse-battery-1"). Assert the wizard disappears and `/briefing` shows "Aria is alive". Then in a second launch (reuse userData), assert the `UnlockScreen` is shown; submit the same password; assert success.
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/onboarding.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/e2e/onboarding.spec.ts` passes both launches (first-run wizard + second-run unlock)
    - `grep -c "ARIA_E2E" src/main/ipc/onboarding.ts` returns ≥`1` (test-only hook gated by env)
    - `grep -c "pendingMnemonic" src/main/ipc/onboarding.ts` returns ≥`1`
    - `grep -c "VaultUnlockError" src/main/ipc/onboarding.ts` returns ≥`1` (failure path handled)
    - `BackupRestoreSection.tsx` references both `window.aria.backupCreate` and `window.aria.backupRestore`
    - After successful onboarding, `<userData>/vault.json` and `<userData>/aria.db` BOTH exist (assert in e2e via filesystem read)
    - `<userData>/aria.db`'s first 16 bytes are NOT `SQLite format 3\\0` (encryption is on — SQLCipher headers are encrypted)
  </acceptance_criteria>
  <done>End-to-end first-launch onboarding + repeat-launch unlock + backup/restore UI all wired; vault and DB live under userData with the documented filenames; e2e test exercises the full IPC bridge.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → Main onboarding IPC | Renderer collects daily password but main owns the mnemonic; renderer sees mnemonic words only during onboarding step 1 (necessary for user to write down) |
| Main RAM → Disk | DB key lives only in main RAM; mnemonic on disk only as AES-256-GCM ciphertext in vault.json |
| Backup file → other machines | Encrypted with same SQLCipher key derived from mnemonic + appSalt; appSalt is NOT secret but is in vault.json (must be supplied alongside backup for cross-machine restore — documented limitation; future enhancement may embed appSalt header) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-02-01 | Information Disclosure | SQLCipher key in main RAM exposed via crash dumps / swap | mitigate (HIGH) | Key lives in a single `Buffer` reference; `key.fill(0)` after each derivation hand-off; Node `--max-old-space-size` tuned to avoid swap; documented as a residual risk in SKELETON.md |
| T-01-02-02 | Tampering | Weak KDF lets brute-force recover mnemonic | mitigate (HIGH) | `crypto.scrypt(N=2^15, r=8, p=1)` for BOTH the DB-key derivation (mnemonic → key) AND the vault-key derivation (daily password → vault key). Pinned by test vectors so future edits to weaken parameters fail CI |
| T-01-02-03 | Spoofing | Restore accepts a backup created by a different mnemonic | mitigate (HIGH) | Restore re-derives key and attempts a real SQLCipher open of the backup; mismatch throws `RestoreInvalidError` before any disk write to `aria.db` |
| T-01-02-04 | Information Disclosure | Mnemonic leaked via pino logs | mitigate (HIGH) | Vault module never calls `logger.info`/`debug` with payload; only event-name logs; redact pipeline in plan-01 covers belt-and-suspenders |
| T-01-02-05 | Repudiation | Migration runs without audit | mitigate (LOW) | Every applied migration logs `{ event: 'db.migrate.applied', version, file }`; user_version atomically advances within the same transaction |
| T-01-02-06 | Tampering | `sqlite-vec` loaded silently → DB corruption | mitigate (HIGH) | Hard grep gate in acceptance criteria forbids `loadExtension` in `src/main/db/*` for Phase 1; Pitfall 1 explicitly defers to Phase 7 |
| T-01-02-07 | Denial of Service | scrypt N=2^15 too slow on low-end laptops | accept (LOW) | RESEARCH A4 records the assumption (~100ms); Phase 1 QA on the Windows dev box validates; tune parameters in a later phase only if real users hit it |
</threat_model>

<verification>
- All three task `<automated>` commands pass on Windows 11
- After onboarding e2e completes, `<userData>/aria.db` opened with the stock `sqlite3` CLI fails or returns no tables (VALIDATION manual-only — record in 01-02-SUMMARY.md)
- After backup, a stock `sqlite3` CLI on the `.ariabackup` file also fails (same encryption)
- The mnemonic test vector in `derive.spec.ts` locks the scrypt-derived hex; any accidental KDF change breaks CI
</verification>

<success_criteria>
Plan 02 satisfies Phase-1 success criteria #1 (sets recovery passphrase during onboarding), #3 (encrypted SQLCipher DB created), and #4 (backup + restore round-trips). It also produces the `routing_log` table that Plan 04 will write into.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-02-SUMMARY.md` describing:
- Exact vault.json + aria.db locations on the dev machine
- Result of the manual-only `sqlite3` CLI inspection (confirming encryption)
- Confirmed scrypt parameter values used (must match the threat-model mitigations literal)
- Time taken for first-launch onboarding scrypt derivation on the dev box (for A4 calibration)
</output>

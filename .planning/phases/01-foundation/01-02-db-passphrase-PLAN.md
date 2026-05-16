---
phase: 01-foundation
plan: 02
type: execute
wave: 3
depends_on: ["01-foundation/01b"]
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
  - src/renderer/features/onboarding/RestoreScreen.tsx
  - src/renderer/app/App.tsx
  - tests/unit/main/db/migrations.spec.ts
  - tests/unit/main/db/backup-restore.spec.ts
  - tests/unit/main/vault/derive.spec.ts
  - tests/unit/main/vault/unlock.spec.ts
  - tests/unit/main/vault/mnemonic.spec.ts
  - tests/e2e/onboarding.spec.ts
  - tests/e2e/fixtures/onboarded.ts
autonomous: true
requirements: [FOUND-02, FOUND-03, FOUND-04]
tags: [sqlite, sqlcipher, bip39, scrypt, onboarding, backup-restore]

# Top-of-plan rationale:
# - vault.json schema includes `appSalt` from Task 1 — there is NO retcon between Task 1 and Task 2 (Warning B fix).
# - This plan does NOT own `src/main/ipc/index.ts` or `src/renderer/features/settings/SettingsScreen.tsx`.
#   Both are owned by Plan 03 (wave 4), which wires Plan 02 + Plan 03 IPC handlers into registerHandlers
#   and mounts the BackupRestoreSection composite. Plan 02 exports a `<BackupRestoreSection/>` from
#   `src/renderer/features/onboarding/` for Plan 03 to mount.
# - Plan 02 owns: App.tsx (onboarding gate + unlock gate) and the four onboarding screens + the BackupRestoreSection component file.
# - Plan 03 (wave 4) extends App.tsx? NO — App.tsx is plan 02 only; Plan 03 only touches SettingsScreen.tsx.
#   This keeps wave-2 files_modified disjoint from wave-3 and wave-4.

must_haves:
  truths:
    - "First-launch onboarding generates a 12-word BIP39 mnemonic, displays it once, and requires re-entering 3 words at random positions before proceeding"
    - "On subsequent launches, the daily-unlock password decrypts vault.json, unwraps the mnemonic, derives the 32-byte SQLCipher key via scrypt(N=2^15,r=8,p=1) over (mnemonic + appSalt from vault.json), and opens aria.db"
    - "aria.db is unreadable by a stock sqlite3 CLI without the key"
    - "User can produce an encrypted .ariabackup file and restore it on the same machine (and architecturally on a different machine using only the mnemonic + the original vault.json's appSalt)"
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
      provides: "daily-password → AES-256-GCM unwrap of vault.json (which contains appSalt + sealed mnemonic) → mnemonic in main RAM"
      exports: ["sealVault", "unlockVault", "isVaultPresent"]
  key_links:
    - from: "src/main/ipc/onboarding.ts"
      to: "src/main/vault/mnemonic.ts + src/main/vault/derive.ts + src/main/db/connect.ts"
      via: "onboarding seals vault (with appSalt), derives key, opens db, runs migrations"
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

Purpose: Establish the encryption substrate every later phase persists into. Implements D-01..D-04 (hybrid passphrase, daily unlock, 3-word confirmation, portable encrypted backup). Bypasses SQLCipher's GPU-cheap PBKDF2 default by passing a raw scrypt-derived key (RESOLVED Open Question 1). Defines the migration framework (numbered .sql + `PRAGMA user_version`) every later phase will use.

Output: SQLCipher-encrypted `aria.db`; vault-sealed BIP39 mnemonic + appSalt in `vault.json`; onboarding wizard with show + 3-word confirm; daily unlock screen; encrypted `.ariabackup` backup/restore round-trip.
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
@.planning/phases/01-foundation/01-01b-SUMMARY.md
@src/shared/ipc-contract.ts
@src/main/index.ts
@src/main/log/pino.ts
@src/main/ipc/index.ts

<interfaces>
<!-- Plan 01b already declared these CHANNELS; this plan IMPLEMENTS the onboarding/backup subset: -->
<!-- ONBOARDING_GEN_MNEMONIC: () => Promise<{ words: string[] }> -->
<!-- ONBOARDING_CONFIRM: (req: { positions: number[]; answers: string[] }) => Promise<{ ok: boolean }> -->
<!-- ONBOARDING_SEAL: (req: { mnemonic: string; dailyPassword: string }) => Promise<{ ok: true }> -->
<!-- ONBOARDING_UNLOCK: (req: { dailyPassword: string }) => Promise<{ ok: boolean }> -->
<!-- ONBOARDING_STATUS: () => Promise<{ vaultPresent: boolean; dbOpen: boolean }> -->
<!-- BACKUP_CREATE: () => Promise<{ path: string }> -->
<!-- BACKUP_RESTORE: (req: { backupPath: string; mnemonic: string; dailyPassword: string }) => Promise<{ ok: true }> -->

<!-- vault.json shape (Task 1 LOCKS this; Task 2 does NOT change it): -->
<!-- { v: 1, -->
<!--   kdf: { algo: 'scrypt', N: 32768, r: 8, p: 1, salt: <b64> },     ← KDF for the vault key (from daily password) -->
<!--   cipher: { algo: 'aes-256-gcm', nonce: <b64>, ct: <b64>, tag: <b64> },  ← AES-256-GCM over mnemonic -->
<!--   appSalt: <b64>                                                  ← 16-byte salt for deriveDbKey(mnemonic, appSalt) -->
<!-- } -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Vault primitives — mnemonic, scrypt key derivation, AES-256-GCM-sealed vault.json (includes appSalt)</name>
  <files>src/main/vault/mnemonic.ts, src/main/vault/derive.ts, src/main/vault/unlock.ts, src/main/vault/storage.ts, tests/unit/main/vault/mnemonic.spec.ts, tests/unit/main/vault/derive.spec.ts, tests/unit/main/vault/unlock.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md lines 343-365 (Pattern 3: BIP39 → SQLCipher key with scrypt N=2^15)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 488-498 (Anti-patterns: do NOT store mnemonic in safeStorage; do NOT store DB key on disk)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 776-795 (RESOLVED Open Question 1 + 3 — raw key + AES-256-GCM vault)
    - .planning/phases/01-foundation/01-CONTEXT.md (D-01 hybrid passphrase, D-03 3-word confirm, D-04 backup portability)
    - src/main/log/pino.ts (logger; never log mnemonic or key bytes)
  </read_first>
  <behavior>
    - `generateMnemonic()` returns 12 English BIP39 words from `@scure/bip39` strength 128
    - `validateMnemonic(words)` returns true only for a valid checksummed 12-word phrase
    - `pickConfirmPositions(seed?)` returns 3 distinct sorted indices in [0..11] for the D-03 challenge
    - `deriveDbKey(mnemonic, appSalt)` returns a 32-byte `Buffer` produced by `crypto.scrypt(NFKD(mnemonic), appSalt, 32, { N: 1<<15, r: 8, p: 1 })`
    - `sealVault(dailyPassword, mnemonic, vaultPath, appSalt)` writes `vault.json` containing the FOUR fields per the `<interfaces>` block: kdf (vault-key KDF over daily password), cipher (AES-256-GCM over mnemonic), AND `appSalt` (16-byte base64 for the deriveDbKey path). `appSalt` is supplied by the caller (onboarding generates fresh; restore reads from the existing vault.json).
    - `unlockVault(dailyPassword, vaultPath)` returns `{ mnemonic, appSalt }` on success; throws `VaultUnlockError` on wrong password; throws `VaultTamperedError` on tag mismatch
    - A successful unlock zero-fills the derived password key buffer before return (best-effort `key.fill(0)`)
    - No mnemonic, password, or DB key ever passes through `logger.info/warn`; failures log only `{ event: 'vault.unlock.failed' }` with no payload
  </behavior>
  <action>
    Create `src/main/vault/mnemonic.ts` exporting `generateMnemonic()`, `validateMnemonic(s: string)`, `pickConfirmPositions(rng?: () => number): [number, number, number]`. Use `@scure/bip39` with the English wordlist (`@scure/bip39/wordlists/english`). `pickConfirmPositions` defaults RNG to `crypto.randomInt`; returns three distinct sorted indices in [0,11].

    Create `src/main/vault/derive.ts` exporting `deriveDbKey(mnemonic: string, appSalt: Buffer): Promise<Buffer>` using `node:crypto.scrypt` with `{ N: 1<<15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }` and 32-byte output over `mnemonic.normalize('NFKD')`. Also export `toPragmaKeyHex(key: Buffer): string` returning `key.toString('hex')` for use in `PRAGMA key="x'<hex>'"`.

    Create `src/main/vault/storage.ts` exporting low-level read/write helpers for `vault.json` (atomic write: `fs.writeFile` to `.tmp` then `fs.rename`; throws `VaultMissingError` on read miss). The JSON shape is LOCKED here per the `<interfaces>` block — Task 2 must not modify it.

    Create `src/main/vault/unlock.ts` exporting `sealVault(dailyPassword, mnemonic, vaultPath, appSalt)`, `unlockVault(dailyPassword, vaultPath)`, `isVaultPresent(vaultPath)`, plus custom errors `VaultUnlockError`, `VaultMissingError`, `VaultTamperedError`. Implementation:
    - `sealVault`: generate 16-byte vault-salt + 12-byte nonce; derive 32-byte vault key via `crypto.scrypt(dailyPassword, vaultSalt, 32, { N: 1<<15, r: 8, p: 1 })`; `crypto.createCipheriv('aes-256-gcm', vaultKey, nonce)`; encrypt UTF-8 mnemonic; write JSON `{ v: 1, kdf: {...}, cipher: {...}, appSalt: appSalt.toString('base64') }`.
    - `unlockVault`: read JSON; re-derive vault key with same scrypt params over the stored kdf.salt; `createDecipheriv`; `setAuthTag(tag)`; decrypt. On bad tag throw `VaultTamperedError`. Return `{ mnemonic, appSalt: Buffer.from(json.appSalt, 'base64') }`. After return, `vaultKey.fill(0)`.

    Write the three vitest specs:
    - `mnemonic.spec.ts`: generate returns 12 words, all in wordlist, passes validate; tampering one word fails validate; `pickConfirmPositions` returns 3 distinct sorted indices in [0,11].
    - `derive.spec.ts`: `deriveDbKey('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', salt)` is deterministic across calls and is 32 bytes; uses the BIP39 test-vector mnemonic and a fixed salt to lock a known hex value (capture on first run, assert thereafter — prevents accidental KDF parameter drift).
    - `unlock.spec.ts`: `sealVault → unlockVault` round-trip recovers BOTH the mnemonic AND the appSalt (assert `unlockVault(...).appSalt.equals(originalAppSalt)`); wrong password throws `VaultUnlockError`; flipping one byte of ciphertext throws `VaultTamperedError`; `vault.json` on disk contains the `appSalt` field as a base64 string.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/vault</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/vault/mnemonic.spec.ts` passes (≥4 assertions)
    - `tests/unit/main/vault/derive.spec.ts` passes and locks a known hex for the `abandon×11 about` + fixed-salt test vector
    - `tests/unit/main/vault/unlock.spec.ts` passes including the `VaultTamperedError` branch AND a "vault.json contains appSalt" assertion AND an "unlockVault returns the original appSalt" assertion
    - `grep -c "console.log" src/main/vault/*.ts` returns `0`
    - `grep -c "logger.info" src/main/vault/*.ts` returns `0` (only `logger.warn`/`error` with non-sensitive event names allowed)
    - `grep -c "N: 1 *<< *15" src/main/vault/derive.ts` returns ≥`1`
    - `grep -c "aes-256-gcm" src/main/vault/unlock.ts` returns ≥`1`
    - `grep -c "appSalt" src/main/vault/unlock.ts` returns ≥`2` (in `sealVault` signature AND in the JSON write)
  </acceptance_criteria>
  <done>Vault primitives are deterministic, audited via tests, never leak secrets into logs. vault.json schema (including `appSalt`) is LOCKED here — Task 2 only consumes it, does not extend it.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: SQLCipher DB connection, migration runner, backup, restore</name>
  <files>src/main/db/connect.ts, src/main/db/migrations/001_init.sql, src/main/db/migrations/runner.ts, src/main/db/backup.ts, src/main/db/restore.ts, tests/unit/main/db/migrations.spec.ts, tests/unit/main/db/backup-restore.spec.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-RESEARCH.md lines 311-340 (Pattern 2: SQLCipher open + cipher selection + PRAGMA order)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 480-500 (Pattern 7: VACUUM INTO preserves same key)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 522-535 (Pitfall 1: do NOT load sqlite-vec in Phase 1; Pitfall 2: electron-rebuild for native ABI on Windows)
    - .planning/phases/01-foundation/01-RESEARCH.md lines 695-720 (routing_log schema preview — Plan 04 writes rows; app_meta + settings + routing_log created here)
    - src/main/vault/derive.ts (created task 1 — produces the 32-byte key)
    - src/main/vault/unlock.ts (vault.json already carries appSalt — restore reads it from there)
    - src/main/log/pino.ts (logger; DB log events redact sql params via redactObject)
  </read_first>
  <behavior>
    - `openDb({ dataDir, dbKey, runMigrationsOnOpen })` opens (or creates) `<dataDir>/aria.db` via better-sqlite3-multiple-ciphers
    - Cipher selection: `PRAGMA cipher='chacha20'` issued BEFORE `PRAGMA key="x'<32-byte-hex>'"`
    - Migration runner reads numbered files in `src/main/db/migrations/*.sql`, compares to `PRAGMA user_version`, applies in transactions, updates `user_version` after each
    - `001_init.sql` creates `app_meta`, `settings`, `routing_log` with the exact schema Plan 04 writes against
    - `createBackup({ outPath })` calls `VACUUM INTO '<outPath>'` while the DB is open with the live key
    - `restoreBackup({ dataDir, backupPath, mnemonic, dailyPassword })`:
      1. Reads `<dataDir>/vault.json` to extract `appSalt` (vault.json is left untouched — same appSalt is reused)
      2. Derives DB key from `mnemonic + appSalt`
      3. Opens the backup file with that key; on failure throws `RestoreInvalidError` (no disk write performed)
      4. On success, atomically replaces `<dataDir>/aria.db` with the backup
    - `sqlite-vec` is NOT loaded; the connect path has no `loadExtension` call
    - A stock `sqlite3` CLI cannot read `aria.db`
  </behavior>
  <action>
    Create `src/main/db/connect.ts` exporting `openDb` and `closeDb` and a `Db` type alias. Open sequence per RESEARCH Pattern 2: `new Database(path)` → `db.pragma("cipher='chacha20'")` → `db.pragma(\`key="x'${keyHex}'"\`)` → `db.pragma('cipher_page_size=4096')` → `db.pragma('journal_mode=WAL')` → `db.pragma('foreign_keys=ON')` → optional `runMigrations(db)`. On any pragma error close and throw `DbOpenError`.

    Create `src/main/db/migrations/001_init.sql` with three statements:
    1. `CREATE TABLE app_meta(k TEXT PRIMARY KEY, v TEXT NOT NULL);`
    2. `CREATE TABLE settings(k TEXT PRIMARY KEY, v TEXT NOT NULL);`
    3. `CREATE TABLE routing_log( id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, route TEXT NOT NULL CHECK (route IN ('LOCAL','FRONTIER')), reason TEXT NOT NULL, source TEXT NOT NULL, prompt_hash TEXT NOT NULL, model TEXT NOT NULL, latency_ms INTEGER NOT NULL, ok INTEGER NOT NULL CHECK (ok IN (0,1)) );`
    Plus `CREATE INDEX idx_routing_log_ts ON routing_log(ts DESC);`.

    Create `src/main/db/migrations/runner.ts` exporting `runMigrations(db)`. Algorithm: read all `*.sql` files from migrations dir sorted lexicographically; current = `db.pragma('user_version', { simple: true })`; for each file whose numeric prefix > current, execute inside `db.transaction(() => { db.exec(sql); db.pragma(\`user_version=${target}\`); })`. Log each applied migration via `logger.info({ event: 'db.migrate.applied', version: target, file })`.

    Create `src/main/db/backup.ts` exporting `createBackup(db, { outPath, overwrite = false })`. Wraps `db.exec(\`VACUUM INTO '${outPath.replace(/'/g, "''")}'\`)`. If `outPath` exists and `!overwrite`, refuse with `BackupOverwriteError`. Logs `{ event: 'db.backup.created' }` with sanitized path.

    Create `src/main/db/restore.ts` exporting `restoreBackup({ dataDir, backupPath, mnemonic, dailyPassword })`:
    1. Read `<dataDir>/vault.json` directly via `src/main/vault/storage.ts` to extract `appSalt` (do NOT call `unlockVault` — restore's purpose is the mnemonic-only path; the `dailyPassword` parameter is reserved for a future safety prompt and is currently unused except for logging context).
    2. `dbKey = deriveDbKey(mnemonic, appSalt)`
    3. Copy the backup to a temp path; attempt `openDb({ dataDir: <tempDir>, dbKey, runMigrationsOnOpen: false })`; if it throws, throw `RestoreInvalidError` and delete the temp copy.
    4. On success, close the temp DB, `fs.rename` the temp copy over `<dataDir>/aria.db`, log `{ event: 'db.restore.applied' }`.

    Create `tests/unit/main/db/migrations.spec.ts` using a temp dir + ephemeral 32-byte key (`crypto.randomBytes(32)`):
    - Open a fresh DB, run migrations; assert `app_meta`, `settings`, `routing_log` all exist (`db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()`)
    - `user_version` is 1 after migration
    - Re-running runMigrations is a no-op
    - Opening with WRONG key throws (sanity: encryption is actually on)

    Create `tests/unit/main/db/backup-restore.spec.ts`:
    - Seal a vault with a fixed mnemonic + fixed appSalt via `sealVault`
    - Open DB with `deriveDbKey(mnemonic, appSalt)`; insert a row into `settings`
    - `createBackup({ outPath })`; open the backup with the same key and assert the row is present
    - `restoreBackup({ dataDir, backupPath, mnemonic, dailyPassword: 'whatever' })` succeeds and `<dataDir>/aria.db` now contains the row from the backup
    - Calling `restoreBackup` with a wrong mnemonic throws `RestoreInvalidError` and `<dataDir>/aria.db` is unchanged
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/db</automated>
  </verify>
  <acceptance_criteria>
    - `tests/unit/main/db/migrations.spec.ts` passes; wrong-key open is rejected
    - `tests/unit/main/db/backup-restore.spec.ts` passes including the `RestoreInvalidError` branch AND the "aria.db unchanged on failure" assertion
    - `grep -c "cipher='chacha20'" src/main/db/connect.ts` returns ≥`1`
    - `grep -rc "loadExtension" src/main/db` returns `0` — sqlite-vec NOT loaded in Phase 1
    - `grep -c "VACUUM INTO" src/main/db/backup.ts` returns ≥`1`
    - `001_init.sql` contains `CREATE TABLE app_meta`, `CREATE TABLE settings`, `CREATE TABLE routing_log`
    - `routing_log` schema contains all columns required by Plan 04: `ts, route, reason, source, prompt_hash, model, latency_ms, ok`
    - `src/main/db/restore.ts` does NOT modify `vault.json` (verify by grep: `grep -c "vault.json" src/main/db/restore.ts` allows read-only access via storage helper only)
  </acceptance_criteria>
  <done>SQLCipher DB created with chacha20 cipher, migrations applied via user_version, backup/restore round-trips through VACUUM INTO; restore reuses the vault.json appSalt locked by Task 1.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3a: Onboarding wizard + unlock screen (renderer + IPC handlers + App.tsx gating)</name>
  <files>src/main/ipc/onboarding.ts, src/renderer/features/onboarding/OnboardingWizard.tsx, src/renderer/features/onboarding/MnemonicShow.tsx, src/renderer/features/onboarding/MnemonicConfirm.tsx, src/renderer/features/onboarding/UnlockScreen.tsx, src/renderer/app/App.tsx, tests/e2e/onboarding.spec.ts, tests/e2e/fixtures/onboarded.ts</files>
  <read_first>
    - .planning/phases/01-foundation/01-CONTEXT.md (D-01..D-04, D-11..D-13)
    - src/shared/ipc-contract.ts
    - src/main/vault/unlock.ts, src/main/vault/mnemonic.ts, src/main/db/connect.ts (tasks 1+2)
    - src/main/ipc/index.ts (stub scaffold from plan 01b; Plan 03 wires `registerOnboardingHandlers` into it at wave 4)
    - src/renderer/app/App.tsx (current shell from plan 01b)
  </read_first>
  <behavior>
    - On launch, main checks `isVaultPresent(<userData>/vault.json)`; if absent → renderer routes to `/onboarding`; if present → `/unlock`; once unlocked → `/briefing`
    - Onboarding step 1: main generates the 12-word mnemonic; renderer receives the word list ONLY for one-time display; on Continue the renderer drops its local copy; main retains a module-scoped `pendingMnemonic` until seal
    - Onboarding step 2: 3-word confirm at random positions (D-03); answers verified against `pendingMnemonic`
    - Onboarding step 3: daily-unlock password (min 8 chars); `onboardingSeal` calls `sealVault(dailyPassword, pendingMnemonic, vaultPath, appSalt = crypto.randomBytes(16))`, then `deriveDbKey(pendingMnemonic, appSalt)`, then `openDb` with `runMigrationsOnOpen: true`, stores `Db` handle on a shared `dbHolder` singleton
    - Unlock screen: user enters daily password; main calls `unlockVault → deriveDbKey → openDb`; on 5 consecutive failures shows a "Forgot password? Restore from backup" link routing to `/restore` (RestoreScreen lives in Task 3b)
    - Playwright e2e: launch with fresh userData → step through onboarding → reach briefing screen
  </behavior>
  <action>
    Create `src/main/ipc/onboarding.ts` exporting `registerOnboardingHandlers(ipcMain, deps)` where deps is `{ logger, dataDir, dbHolder }`. Implementation:
    - Module-scoped `pendingMnemonic: string | null` populated by `ONBOARDING_GEN_MNEMONIC` (returns words) and cleared on seal
    - `ONBOARDING_CONFIRM` verifies the supplied answers against `pendingMnemonic.split(' ')` at the given positions
    - `ONBOARDING_SEAL` requires `pendingMnemonic` non-null; generates `appSalt = crypto.randomBytes(16)`; calls `sealVault(dailyPassword, pendingMnemonic, vaultPath, appSalt)`; derives DB key; opens DB; stores handle on dbHolder
    - `ONBOARDING_UNLOCK` reads vault.json via `unlockVault`; derives key from returned `{ mnemonic, appSalt }`; opens DB; stores on dbHolder
    - `ONBOARDING_STATUS` returns `{ vaultPresent: isVaultPresent(vaultPath), dbOpen: dbHolder.isOpen }`
    - Add a test-only hook gated by `process.env.ARIA_E2E === '1'` that returns the current `pendingMnemonic` so Playwright can submit correct 3-word answers

    NOTE: This task creates `src/main/ipc/onboarding.ts` but does NOT modify `src/main/ipc/index.ts`. Plan 03 (wave 4) wires `registerOnboardingHandlers` into `registerHandlers`.

    Create the four renderer files:
    - `OnboardingWizard.tsx`: 3-step state machine (show → confirm → password) calling `window.aria.onboarding*`
    - `MnemonicShow.tsx`: 4×3 grid of words + a "I've written these down" toggle that gates Continue
    - `MnemonicConfirm.tsx`: 3 inputs labeled by the positions; on failure, regenerate position challenge and show a friendly retry message
    - `UnlockScreen.tsx`: password field + Unlock button + counter; after 5 failures shows the `Forgot password? Restore from backup` link routing to `/restore`

    Update `src/renderer/app/App.tsx`: on mount, call `window.aria.onboardingStatus()`. If `!vaultPresent`, render `<OnboardingWizard/>` and block side-nav. If vaultPresent && !dbOpen, render `<UnlockScreen/>` and block side-nav. Once unlocked, render the existing layout from plan 01b. Wire the route `/restore` to the `<RestoreScreen/>` created in Task 3b.

    Create `tests/e2e/fixtures/onboarded.ts`: a Playwright fixture that launches the Electron app with an isolated temp userData, runs the onboarding flow programmatically (using the `ARIA_E2E` hook to read `pendingMnemonic`), and returns `{ electronApp, userDataDir, mnemonic, dailyPassword }`. Both `tests/e2e/onboarding.spec.ts` (this task) and `tests/e2e/hello-aria.spec.ts` (Plan 04) consume this fixture.

    Create `tests/e2e/onboarding.spec.ts`:
    1. First launch with fresh userData → wizard appears
    2. Programmatically click through (use the `ARIA_E2E` env hook in `playwright.config.ts` to retrieve `pendingMnemonic` from main and submit the correct 3-word answer)
    3. Submit a daily password (`"correct-horse-battery-1"`)
    4. Wizard disappears, `/briefing` shows "Aria is alive"
    5. Restart Electron reusing same userData → `UnlockScreen` is shown
    6. Submit same password → success → `/briefing` reappears
  </action>
  <verify>
    <automated>npm run build && npm run test:e2e -- tests/e2e/onboarding.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `tests/e2e/onboarding.spec.ts` passes both launches
    - `grep -c "ARIA_E2E" src/main/ipc/onboarding.ts` returns ≥`1`
    - `grep -c "pendingMnemonic" src/main/ipc/onboarding.ts` returns ≥`1`
    - `grep -c "VaultUnlockError" src/main/ipc/onboarding.ts` returns ≥`1`
    - After successful onboarding, `<userData>/vault.json` AND `<userData>/aria.db` BOTH exist (assert via fs in the e2e)
    - `<userData>/aria.db` first 16 bytes are NOT `SQLite format 3\0` (encryption is on)
    - `src/renderer/app/App.tsx` references both `<OnboardingWizard/>` and `<UnlockScreen/>` and gates on `onboardingStatus()`
  </acceptance_criteria>
  <done>End-to-end first-launch onboarding + repeat-launch unlock wired; vault and DB live under userData; e2e exercises the full IPC bridge.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3b: Backup/restore IPC handlers + RestoreScreen + BackupRestoreSection component</name>
  <files>src/main/ipc/backup.ts, src/renderer/features/onboarding/RestoreScreen.tsx, src/renderer/features/onboarding/BackupRestoreSection.tsx</files>
  <read_first>
    - src/main/db/backup.ts, src/main/db/restore.ts (task 2)
    - src/shared/ipc-contract.ts
    - src/main/ipc/onboarding.ts (task 3a — shares the `dbHolder` singleton pattern)
  </read_first>
  <behavior>
    - `BACKUP_CREATE` opens an Electron save dialog (defaultPath `aria-<isoDate>.ariabackup`, filter `*.ariabackup`); on confirm calls `createBackup(dbHolder.db, { outPath })` and returns the path
    - `BACKUP_RESTORE` accepts `{ backupPath, mnemonic, dailyPassword }` and calls `restoreBackup({ dataDir, backupPath, mnemonic, dailyPassword })`; on success closes and reopens dbHolder, returns `{ ok: true, restartRequired: true }`
    - `RestoreScreen.tsx` is the renderer destination after the 5-failure unlock link; collects mnemonic + daily password + file path (via Electron open dialog), calls `window.aria.backupRestore`
    - `BackupRestoreSection.tsx` is a **standalone component file** exported as `<BackupRestoreSection/>` — Plan 03 (wave 4) imports and mounts it inside SettingsScreen. This task does NOT touch SettingsScreen.tsx.
  </behavior>
  <action>
    Create `src/main/ipc/backup.ts` exporting `registerBackupHandlers(ipcMain, deps)` with deps `{ logger, dataDir, dbHolder }`. Implements `BACKUP_CREATE` (uses `dialog.showSaveDialog`) and `BACKUP_RESTORE` (uses `restoreBackup` + reopens dbHolder). Plan 03 wires `registerBackupHandlers` into `registerHandlers`.

    Create `src/renderer/features/onboarding/RestoreScreen.tsx`: form with mnemonic textarea (12-word input), daily-password field, "Choose backup file…" button (calls a `window.aria.backupRestore` helper after opening the file dialog). On success, show "Restore successful — restarting…" and trigger an app reload.

    Create `src/renderer/features/onboarding/BackupRestoreSection.tsx`: standalone component exporting two buttons ("Create backup", "Restore from backup") + a result display area. Calls `window.aria.backupCreate` / opens `RestoreScreen` modal. **Plan 03 imports `<BackupRestoreSection/>` from this file and mounts it inside `SettingsScreen.tsx`.**
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/db/backup-restore.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/main/ipc/backup.ts` exports `registerBackupHandlers`
    - `BackupRestoreSection.tsx` references both `window.aria.backupCreate` and `window.aria.backupRestore`
    - `src/renderer/features/onboarding/RestoreScreen.tsx` is the route component for `/restore`
    - No edit to `src/renderer/features/settings/SettingsScreen.tsx` (verify via git status: this plan does NOT modify SettingsScreen.tsx)
  </acceptance_criteria>
  <done>Backup/restore IPC + RestoreScreen + standalone BackupRestoreSection ready. Plan 03 will wire `registerBackupHandlers` into `registerHandlers` and mount `<BackupRestoreSection/>` inside SettingsScreen.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer → Main onboarding IPC | Renderer collects daily password but main owns the mnemonic; renderer sees mnemonic words only during onboarding step 1 |
| Main RAM → Disk | DB key lives only in main RAM; mnemonic on disk only as AES-256-GCM ciphertext in vault.json; appSalt is non-secret KDF salt in vault.json |
| Backup file → other machines | Encrypted with same SQLCipher key derived from mnemonic + appSalt; cross-machine restore requires the source machine's vault.json (specifically its appSalt field) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-02-01 | Information Disclosure | SQLCipher key in main RAM exposed via crash dumps / swap | mitigate (HIGH) | Key lives in a single `Buffer`; `key.fill(0)` after derivation hand-off; documented residual risk in SKELETON.md |
| T-01-02-02 | Tampering | Weak KDF lets brute-force recover mnemonic | mitigate (HIGH) | `crypto.scrypt(N=2^15, r=8, p=1)` for BOTH the DB-key derivation (mnemonic → key) AND the vault-key derivation (daily password → vault key); pinned by test vectors |
| T-01-02-03 | Spoofing | Restore accepts a backup created by a different mnemonic | mitigate (HIGH) | Restore re-derives key and attempts a real SQLCipher open of the backup; mismatch throws `RestoreInvalidError` before any disk write |
| T-01-02-04 | Information Disclosure | Mnemonic leaked via pino logs | mitigate (HIGH) | Vault module never calls `logger.info`/`debug` with payload; only event-name logs; redact pipeline in plan 01b covers belt-and-suspenders |
| T-01-02-05 | Repudiation | Migration runs without audit | mitigate (LOW) | Every applied migration logs `{ event: 'db.migrate.applied', version, file }`; user_version atomically advances within the same transaction |
| T-01-02-06 | Tampering | `sqlite-vec` loaded silently → DB corruption | mitigate (HIGH) | Hard grep gate forbids `loadExtension` in `src/main/db/*` for Phase 1 (Pitfall 1) |
| T-01-02-07 | Denial of Service | scrypt N=2^15 too slow on low-end laptops | accept (LOW) | RESEARCH A4 records the assumption (~100ms); revisit only if real users hit it |
</threat_model>

<verification>
- All three task `<automated>` commands pass on Windows 11
- After onboarding e2e completes, `<userData>/aria.db` opened with the stock `sqlite3` CLI fails or returns no tables (manual; recorded in 01-02-SUMMARY.md)
- The scrypt test vector in `derive.spec.ts` locks the derived hex; any accidental KDF change breaks CI
- vault.json on disk shows the `appSalt` field as a base64 string (verify with `Get-Content vault.json` after onboarding)
</verification>

<success_criteria>
Plan 02 satisfies Phase-1 ROADMAP success criteria #1 (recovery passphrase during onboarding), #3 (encrypted SQLCipher DB created), and #4 (backup + restore round-trips). It also produces the `routing_log` table that Plan 04 writes into.
</success_criteria>

<output>
After completion, create `.planning/phases/01-foundation/01-02-SUMMARY.md` describing:
- Exact vault.json + aria.db locations on the dev machine
- Result of the manual-only `sqlite3` CLI inspection (confirming encryption)
- Confirmed scrypt parameter values (must match the threat-model literal)
- Time taken for first-launch onboarding scrypt derivation on the dev box (A4 calibration)
- Confirmation that vault.json contains `appSalt` as base64
</output>

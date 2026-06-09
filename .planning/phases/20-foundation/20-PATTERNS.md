# Phase 20: Foundation (WhatsApp group-tracking) - Pattern Map

**Mapped:** 2026-06-09
**Files analyzed:** 24 (12 new + 12 modified)
**Analogs found:** 22 / 24 (2 net-new with only role-match, no exact analog)

> All analog paths verified to exist at HEAD 2026-06-09. RESEARCH.md's three live-source corrections are honored throughout: (1) post-unlock wiring is `main/index.ts` bootPoll NOT `ipc/index.ts onDbReady`; (2) `electron.vite.config.ts main:` has NO `plugins` key — it must be ADDED; (3) migration 138's `provider_account` rebuild copies migration **125** (not 011).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/main/db/migrations/138_whatsapp.sql` | migration | transform | `125_todoist_tasks.sql` (cols) + `135_repair_approval_child_fks.sql` (legacy_alter_table) | exact (composite) |
| `src/main/whatsapp/auth-state.ts` | model/adapter | CRUD (transactional) | `src/main/entitlement/service.ts` (db.transaction + prepared stmts) | role-match |
| `src/main/whatsapp/session-manager.ts` | service (singleton) | event-driven / pub-sub | `src/main/entitlement/service.ts` (class+deps) + `sync-orchestrator.ts` (lifecycle) | role-match |
| `src/main/whatsapp/group-sync.ts` | service | event-driven (upsert) | `src/main/ipc/provider-accounts.ts` UPDATE + `sync-gmail.ts` applyRows | role-match |
| `src/main/whatsapp/ingest.ts` | service | streaming / batch | `src/main/integrations/google/sync-gmail.ts` (scheduler.queue.add batch) | role-match |
| `src/main/whatsapp/retention.ts` | service (cron) | batch | `src/main/folder-ingestion/sweep-cron.ts` | exact |
| `src/main/ipc/whatsapp.ts` | route/registrar | request-response | `src/main/ipc/knowledge-folders.ts` (+ `KNOWLEDGE_FOLDER_CHANNELS`) | exact |
| `src/main/ipc/index.ts` (MOD) | route | request-response | `knowledgeChannels` block (488-533) + `pushOnlyChannels` (666-679) | exact |
| `src/main/ipc/provider-accounts.ts` (MOD) | controller | CRUD | self (extend existing disconnect cascade) | exact |
| `src/main/index.ts` (MOD) | config/bootstrap | event-driven | Knowledge Folders bootPoll block (516-557) | exact |
| `electron.vite.config.ts` (MOD) | config | — | `preload:` externalizeDepsPlugin exclude (67) | role-match |
| `src/shared/provider.ts` (MOD) | model | — | self (`ProviderKey` union, line 1) | exact |
| `src/shared/ipc-contract.ts` (MOD) | model | — | self (CHANNELS const + DTOs) | exact |
| `src/renderer/components/WhatsAppConsentModal.tsx` | component (modal) | request-response | `MnemonicShow.tsx` (editorial Checkbox ack-gate) | exact |
| `src/renderer/components/WhatsAppQrModal.tsx` | component (modal) | event-driven (push) | `DisconnectConfirmDialog.tsx` (modal shell) | role-match |
| `src/renderer/components/WhatsAppGroupPickerModal.tsx` | component (modal) | CRUD | `DisconnectConfirmDialog.tsx` shell + `Checkbox` rows | role-match |
| `src/renderer/components/AccountRow.tsx` (MOD) | component | request-response | self (chip/dot/Reconnect) | exact |
| `src/renderer/features/settings/IntegrationsSection.tsx` (MOD) | component | request-response | self (`AddAccountModal` + `AccountRow` + `DisconnectConfirmDialog`) | exact |
| `src/preload/index.ts` (MOD) | provider/bridge | event-driven | existing `WHATSAPP_*`-style invoke + push listener wiring | exact |
| `tests/unit/main/ipc/index.spec.ts` (MOD) | test | — | self (handler-count assertion, 71-81) | exact |
| `tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts` | test (static ratchet) | — | `tests/static/voice-streaming-no-write.spec.ts` | exact |
| `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` | test (static ratchet) | — | `tests/static/voice-streaming-no-write.spec.ts` | exact |
| `tests/unit/main/db/migration-138.spec.ts` | test (integration) | — | (no exact migration-test analog found — see No Analog) | none |
| `tests/unit/main/electron-vite-config.spec.ts` | test (config) | — | (no exact config-test analog found — see No Analog) | none |

## Pattern Assignments

### `src/main/db/migrations/138_whatsapp.sql` (migration, transform)

**Analog:** `src/main/db/migrations/125_todoist_tasks.sql` (verbatim `provider_account` column list) + `src/main/db/migrations/135_repair_approval_child_fks.sql` (the `legacy_alter_table=ON` wrapper).

**CRITICAL — the `legacy_alter_table` wrapper** (135 lines 22-24, 78-80): the `provider_account` RENAME in 138 MUST be guarded or it silently repoints the `provider_sync_state` FK (the migration-124→135 failure mode). Note 125 itself did NOT use this guard — it dodged the bug by also rebuilding `provider_sync_state` in the same migration. 138 only rebuilds `provider_account`, so it MUST use the guard:
```sql
PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;     -- ← from migration 135; prevents provider_sync_state FK repoint
BEGIN;
-- ...rebuild...
COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
PRAGMA user_version = 138;
```

**provider_account rebuild — copy 125 verbatim** (125 lines 9-23), adding `'whatsapp'` to the CHECK:
```sql
CREATE TABLE provider_account (
  account_id          TEXT NOT NULL,
  provider_key        TEXT NOT NULL CHECK (provider_key IN ('google','microsoft','todoist','whatsapp')),  -- ← +whatsapp
  display_email       TEXT NOT NULL,
  display_label       TEXT,
  display_color       TEXT,
  status              TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','degraded','needs-auth','disconnected')),
  identity_set_json   TEXT,
  last_synced_at      TEXT,
  last_error          TEXT,
  last_error_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  capabilities_json   TEXT NOT NULL,                 -- ← NOT NULL no default; WA row must supply (e.g. '{"messaging":1}')
  PRIMARY KEY (provider_key, account_id)
);
INSERT INTO provider_account (account_id, provider_key, display_email, display_label, display_color,
  status, identity_set_json, last_synced_at, last_error, last_error_at, created_at, capabilities_json)
SELECT account_id, provider_key, display_email, display_label, display_color,
  status, identity_set_json, last_synced_at, last_error, last_error_at, created_at, capabilities_json
FROM provider_account_old;
DROP TABLE provider_account_old;
CREATE INDEX IF NOT EXISTS idx_provider_account_status ON provider_account(status);
```
Use the **explicit column-list INSERT** (125 lines 25-34), NOT `INSERT ... SELECT *` — the bare `SELECT *` shown in RESEARCH's example is fragile against column-order drift. The 4 new whatsapp tables + their indexes follow inside the same transaction (DDL in RESEARCH.md Data Model section; resolve the auth-state 2-col vs 4-col conflict — Assumption A2 recommends the STACK.md 4-col shape).

---

### `src/main/whatsapp/auth-state.ts` (model/adapter, CRUD-transactional)

**Analog:** `src/main/entitlement/service.ts` (the deps-injected class with prepared statements; transaction discipline).

**Deps + db typing** (service.ts 9-30, 55-69):
```typescript
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
type Db = Database.Database;
// constructor takes { db, logger } — same shape as EntitlementServiceDeps
```

**Transaction-wrapped `keys.set()`** — HARD GATE 4 (RESEARCH Code Examples + the `db.transaction(() => {...})` pattern used in `provider-accounts.ts` 72-79). Every `keys.set()` runs in ONE `db.transaction()`; a throw mid-loop must roll back ALL rows:
```typescript
set(data: SignalDataSet) {
  const tx = db.transaction(() => {
    for (const [type, entries] of Object.entries(data)) {
      if (!entries) continue;
      for (const [id, value] of Object.entries(entries)) {
        if (value == null) del.run(type, id);
        else upsert.run(type, id, JSON.stringify(value, BufferJSON.replacer)); // BufferJSON — don't hand-roll
      }
    }
  });
  tx();
}
```
Prepare statements once at construction (entitlement style: `this.db.prepare(...)`). Wrap with `makeCacheableSignalKeyStore(store, logger)` before passing to socket (Don't-Hand-Roll table).

---

### `src/main/whatsapp/session-manager.ts` (service singleton, event-driven)

**Analog:** `src/main/entitlement/service.ts` (class + injected deps + `inflight` promise guard) for shape; `src/main/integrations/sync-orchestrator.ts` for the lifecycle/registry idea.

**Class + deps shape** (service.ts 55-69):
```typescript
export interface WhatsAppSessionManagerDeps { db: Db; scheduler: SchedulerHandle; logger: Logger; }
export class WhatsAppSessionManager {
  private socket: WASocket | null = null;
  private startInflight: Promise<void> | null = null;   // ← mirror EntitlementService.bootstrapInflight (single-socket guard)
  constructor(deps: WhatsAppSessionManagerDeps) { /* assign */ }
  start() { /* no-op if no whatsapp provider_account row exists */ }
  stop() { /* socket?.end(); cronRegistry.delete(...) */ }
}
```

**Passive-posture config** — HARD GATES 1/2 + D-13 (RESEARCH Code Examples):
```typescript
const sock = makeWASocket({
  auth: { creds, keys: makeCacheableSignalKeyStore(makeSQLiteSignalKeyStore(db), logger) },
  logger,
  markOnlineOnConnect: false,   // gate 1
  emitOwnEvents: false,         // gate 1
  syncFullHistory: false,       // D-13 explicit
});
sock.ev.on('connection.update', ({ connection }) => {
  if (connection === 'open') void sock.sendPresenceUpdate('unavailable'); // ONLY allowed presence call
});
```
Pin comment required: `// Pinned 6.7.23 (legacy tag). v7 migration blocked on LID API + WASM-asar.`

**Singleton guard** (mirror `EntitlementService.bootstrapInflight` 61): `if (this.socket) await this.disconnect()` before a new `makeWASocket` — prevents the 440 two-socket conflict (Threat table).

**Reconnect classification** (Pattern 4): 401/403/440/500 → no reconnect → `needs-auth`; 408/515 → backoff (use PITFALLS curve per A5) cap 5 → `degraded`. Wire `powerMonitor` suspend/resume (3-5s delay), same as `sweep-cron`/scheduler powerMonitor integration.

**Nightly recycle cron** — HARD GATE 6: register via `scheduler.cronRegistry.set(KEY, task)` exactly like `sweep-cron.ts` 82-84 (no-bare-cron ratchet). Time it at **03:00**; the retention sweep goes at **03:30** (D-14 addendum — must not collide).

---

### `src/main/whatsapp/group-sync.ts` (service, event-driven upsert)

**Analog:** `src/main/ipc/provider-accounts.ts` (UPDATE prepared-statement idiom) for the upsert; D-03 untracked-default.

```typescript
sock.ev.on('groups.upsert', (groups) => {
  for (const g of groups) {
    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, description, member_count, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(jid) DO UPDATE SET display_name=excluded.display_name,
         description=excluded.description, member_count=excluded.member_count, updated_at=datetime('now')`,
    ).run(g.id, g.subject ?? g.id, g.desc ?? null, g.size ?? null);  // tracked defaults to 0 in schema (D-03)
  }
});
```
Newly-joined groups stay `tracked=0` (D-04 badge surfaces them); do NOT default-track. Also handle `group-participants.update` for member_count refresh.

---

### `src/main/whatsapp/ingest.ts` (service, streaming/batch)

**Analog:** `src/main/integrations/google/sync-gmail.ts` (everything routed through `scheduler.queue.add(...)` — the single-writer + serialized-write discipline; sync-gmail.ts 16-19, 128, 170-172).

**Privacy filter — HARD GATES 7/8/9, 3 lines in order, BEFORE any write OR log** (RESEARCH Pattern 3):
```typescript
sock.ev.on('messages.upsert', ({ messages, type }) => {
  if (type !== 'notify') return;                 // LINE 1 (gate 8) — first statement, drop history/append
  for (const msg of messages) {
    const jid = msg.key.remoteJid ?? '';
    if (!jid.endsWith('@g.us')) continue;         // LINE 2 (gate 9) — drop 1:1 DMs
    if (!isTracked(jid)) continue;                // LINE 3 — DB .get(), single source of truth
    const text = extractText(msg);                // text-only whitelist; null → drop (WA-07)
    if (text == null) continue;
    buffer.push({ jid, ... });                    // buffer in memory — NO sync db.run here (gate 7)
  }
});
```
**Batch flush via scheduler.queue.add** (sync-gmail.ts 170-172 is the exact precedent — NEVER `db.run()` inside the event handler):
```typescript
// ~2s flush window (D discretion): one transaction per flush
await scheduler.queue.add(() => {
  const tx = db.transaction(() => { for (const r of batch) insertStmt.run(r.jid, r.senderJid, r.waId, r.sentAt, r.bodyText); });
  tx();
});
```
Use `INSERT OR IGNORE` against the `UNIQUE (jid, wa_id)` constraint. `isTracked` reads `whatsapp_group.tracked` via a prepared `.get()`. NEVER `logger.*` a message body before the filter passes (gate 9).

---

### `src/main/whatsapp/retention.ts` (service cron, batch)

**Analog:** `src/main/folder-ingestion/sweep-cron.ts` — copy the entire shape: `CRON_KEY` const, `SweepCronDeps`/`SweepHandle` interfaces, `runSweep()` + `runNow()`, the `scheduler.cronRegistry.set(KEY, task)` registration (82-84), and the `dbHolder` seal-guard (67-77).

**Cron registration + seal-guard** (sweep-cron.ts 62-94):
```typescript
const CRON_KEY = 'whatsapp-retention-sweep';
const task = nodeCron.schedule(deps.cron ?? '30 3 * * *', () => {   // ← 03:30, NOT 03:00 (D-14: avoid recycle collision)
  const dbRef = deps.dbHolder?.db;
  if (deps.dbHolder && !dbRef) { pendingCatchup.add(CRON_KEY); trayBus.setBadge(); return; }  // seal-guard
  runSweep(db, logger);
});
if (deps.scheduler) deps.scheduler.cronRegistry.set(CRON_KEY, task);   // no-bare-cron ratchet
return { stop() {...}, runNow() { return runSweep(db, logger); } };
```
**runSweep** deletes `whatsapp_message WHERE sent_at < now-30d` (FK CASCADE already removes nothing here — messages are the leaf). Do NOT extend the knowledge `sweep-cron.ts` itself (D-14 addendum: keep it untouched; this is a sibling cron at a distinct minute).

---

### `src/main/ipc/whatsapp.ts` (route/registrar, request-response)

**Analog:** `src/main/ipc/knowledge-folders.ts` — the canonical `EXPORTED_CHANNELS` const-array + registrar-function pattern.

**Channel array export** (knowledge-folders.ts 29-46) — this is the single source of truth the bootPoll `removeHandler` loop and the handler-count test both read:
```typescript
/** Canonical list of every invoke channel registerWhatsAppHandlers() registers.
 *  bootPoll in src/main/index.ts must removeHandler each before real registration. */
export const WHATSAPP_CHANNELS = [
  CHANNELS.WHATSAPP_LINK,
  CHANNELS.WHATSAPP_DISCONNECT,
  CHANNELS.WHATSAPP_LIST_GROUPS,
  CHANNELS.WHATSAPP_SET_TRACKED,
  CHANNELS.WHATSAPP_STATUS,              // 5 invoke channels
] as const;
```
(`WHATSAPP_QR_UPDATE` + `WHATSAPP_STATE_CHANGED` are push-only — they go in `pushOnlyChannels`, NOT here. 5 invoke + 2 push = 7 total channels.)

**Registrar shape** (knowledge-folders.ts 48-58, provider-accounts.ts 18-36):
```typescript
export function registerWhatsAppHandlers(deps: { ipcMain; logger; dbHolder; scheduler; manager }): void {
  const { ipcMain, dbHolder, logger, manager } = deps;
  ipcMain.handle(CHANNELS.WHATSAPP_LINK, async () => { /* manager.startLink() → qr push */ });
  ipcMain.handle(CHANNELS.WHATSAPP_LIST_GROUPS, async () => {
    const db = dbHolder.db; if (!db) return { error: 'DB_NOT_OPEN' };   // notReady() idiom (provider-accounts.ts 14-16)
    return { rows: db.prepare('SELECT * FROM whatsapp_group ...').all() };
  });
  // ... SET_TRACKED (UPDATE), STATUS, DISCONNECT
}
```

---

### `src/main/ipc/index.ts` (MOD — route)

**Analog:** the `knowledgeChannels` block (488-533) for invoke stubs; the `pushOnlyChannels` array (666-679) for push stubs.

**Pre-unlock invoke stubs** (mirror 498-532 else-branch exactly — note the skip.add OUTSIDE the if(db) guard per the db-null skip-trap lesson):
```typescript
const whatsappChannels = [ CHANNELS.WHATSAPP_LINK, CHANNELS.WHATSAPP_DISCONNECT,
  CHANNELS.WHATSAPP_LIST_GROUPS, CHANNELS.WHATSAPP_SET_TRACKED, CHANNELS.WHATSAPP_STATUS ];
if (!whatsappChannels.every((c) => skip.has(c))) {
  // pre-unlock: stubs only — bootPoll re-registers real handlers
  for (const c of whatsappChannels) if (!skip.has(c)) ipcMain.handle(c, () => ({ ok: false, error: 'db-locked' }));
  whatsappChannels.forEach((c) => skip.add(c));   // always mark (handler-count test)
}
```

**Push-only stubs** — append to `pushOnlyChannels` (666-673):
```typescript
const pushOnlyChannels = [ ...existing,
  CHANNELS.WHATSAPP_QR_UPDATE, CHANNELS.WHATSAPP_STATE_CHANGED ];  // main → renderer push, stub handle() to satisfy count
```

---

### `src/main/index.ts` (MOD — config/bootstrap)

**Analog:** the Knowledge Folders bootPoll block (516-557). **This is the corrected location — NOT `ipc/index.ts onDbReady`** (RESEARCH correction #1; onDbReady at 123-130 only does `startSyncOrchestrator`).

**removeHandler loop + construct + real register** (index.ts 516-543, exact template):
```typescript
if (!whatsappBooted) {                       // guard like lifecycleBooted (516)
  whatsappBooted = true;
  const waDb = dbHolder.db;
  for (const ch of WHATSAPP_CHANNELS) ipcMain.removeHandler(ch);   // ← mirror 532-534, remove pre-unlock stubs
  whatsAppManager = new WhatsAppSessionManager({ db: waDb, scheduler, logger });
  whatsAppManager.start();                    // no-op if no whatsapp provider_account row
  registerWhatsAppHandlers({ ipcMain, logger, dbHolder, scheduler, manager: whatsAppManager });
  startWhatsAppRetention({ db: waDb, logger, scheduler, dbHolder });  // 03:30 cron
}
```
Wrap `start()` so a socket throw NEVER rejects boot (WA-12 degradable) — same defensive `.catch()` as `startKnowledgeFolderLifecycle` (551-556).

---

### `electron.vite.config.ts` (MOD — config)

**Analog:** the `preload:` `externalizeDepsPlugin({ exclude: ['zod'] })` (line 67). **RESEARCH correction #2: `main:` currently has NO `plugins` key (46-60) — it must be ADDED, not edited.**

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';   // already imported (line 2)
// in config.main, alongside the existing define/build/resolve:
main: {
  plugins: [externalizeDepsPlugin({ exclude: ['@whiskeysockets/baileys'] })],  // ← NEW key; bundles Baileys ESM→CJS, keeps all else external
  define: oauthDefine,
  build: { ... },
  resolve: { ... },
},
```

---

### `src/shared/provider.ts` + `src/shared/ipc-contract.ts` (MOD — model)

**provider.ts** (line 1): `export type ProviderKey = 'google' | 'microsoft' | 'todoist' | 'whatsapp';`

**ipc-contract.ts:** add 7 `WHATSAPP_*` channel constants to `CHANNELS` + Zod DTOs (group row, status, QR-update payload). Follow the existing `CHANNELS` const-object shape consumed everywhere. The handler-count test reads `Object.keys(CHANNELS).length` — adding 7 channels is what the `index.spec.ts` update tracks.

---

### `src/renderer/components/WhatsAppConsentModal.tsx` (component modal)

**Analog:** `src/renderer/features/onboarding/MnemonicShow.tsx` (the editorial Checkbox ack-gate — exact D-05 precedent) + `DisconnectConfirmDialog.tsx` (the fixed-overlay modal shell + `borderTop: 2px solid var(--rose)` callout treatment for D-06).

**Ack-gated action** (MnemonicShow.tsx 16, 126-142 — the gate is the disabled prop):
```typescript
const [acknowledged, setAcknowledged] = useState(false);
<Checkbox data-testid="whatsapp-consent-ack" checked={acknowledged}
  onChange={(e) => setAcknowledged(e.target.checked)}
  label="I understand the risks of linking my personal WhatsApp number." />
<Button variant="primary" data-testid="whatsapp-show-qr"
  disabled={!acknowledged}                       // ← HARD GATE D-07/SC-1: QR generation gated, not just visibility
  onClick={onShowQr}>Show QR code</Button>
```
D-06 secondary-number callout = a `Card`/box with `borderTop: '2px solid var(--rose)'` (MnemonicShow.tsx 109; DisconnectConfirmDialog.tsx 79) — emphasized, not a bullet.

---

### `src/renderer/components/WhatsAppQrModal.tsx` (component modal, push-driven)

**Analog:** `DisconnectConfirmDialog.tsx` (modal shell 57-87: `role="dialog"`, `aria-modal`, fixed overlay, Escape-closes 45-51).

Renders the `WHATSAPP_QR_UPDATE` push payload (a data-URL `<img>`) + countdown + refresh (Pitfall 12 — QR expiry). The QR string→data-URL conversion happens in MAIN (`qrcode.toDataURL`); this modal only displays. Per RESEARCH Open-Question #4, the QR modal IS the "linking" affordance — there is no AccountRow chip until `connection:'open'` inserts the `provider_account` row.

---

### `src/renderer/components/WhatsAppGroupPickerModal.tsx` (component modal, CRUD)

**Analog:** `DisconnectConfirmDialog.tsx` (modal shell) + `editorial/Checkbox.tsx` (per-group track toggles) + `MnemonicShow.tsx` list-row styling (62-108).

Search/filter field (D-02) over `WHATSAPP_LIST_GROUPS` rows; each row a `Checkbox` (or toggle) that fires `WHATSAPP_SET_TRACKED` immediately (D-03/D-05). Newly-joined groups sort to the top, untracked (D-04). Within editorial design system (D discretion on layout).

---

### `src/renderer/components/AccountRow.tsx` (MOD — component)

**Analog:** self. Three concrete edits:

1. **providerDisplayName** (123-127) — add `if (providerKey === 'whatsapp') return 'WhatsApp';`
2. **Status chip/dot** (14-20, 150-163) — already maps `needs-auth`→`#c98a3a` and `degraded`→`#b34`. D-08 maps WA session states onto these EXISTING styles; no new chip code, just ensure the `provider_account.status` values flow through. The `needs-auth` Reconnect button (90-98) already renders — wire its `onClick` to dispatch `WHATSAPP_LINK` (currently it has no onClick).
3. **"Manage groups" link** (D-01) — add a `linkBtnStyle()` button in the action row (79-118) shown only for `providerKey === 'whatsapp'`, opening the group-picker; render the D-04 count badge on it.

---

### `src/renderer/features/settings/IntegrationsSection.tsx` (MOD — component)

**Analog:** self — it already orchestrates `AddAccountModal` (connect), `AccountRow` (render), `DisconnectConfirmDialog` (destroy). Add the WhatsApp branch: AddAccountModal entry → opens `WhatsAppConsentModal` → `WhatsAppQrModal` (NOT an OAuth BrowserWindow); render WhatsApp `AccountRow` with the "Manage groups" link → `WhatsAppGroupPickerModal`; disconnect routes through the existing `DisconnectConfirmDialog` → `providerAccountDisconnect` IPC.

---

### `src/main/ipc/provider-accounts.ts` (MOD — controller, CRUD)

**Analog:** self. TWO type sites + cascade:
1. **providerKey type union** (42, 61): add `| 'whatsapp'` to both `PROVIDER_ACCOUNT_UPDATE` and `PROVIDER_ACCOUNT_DISCONNECT` casts.
2. **Disconnect cascade** (72-79): add a `'whatsapp'` branch BEFORE the generic `provider_account` delete that calls `manager.stop()` then deletes `whatsapp_auth_state` + `whatsapp_group` (FK CASCADE removes `whatsapp_message` + `whatsapp_group_digest` automatically). The existing `db.transaction(() => {...})` wrapper (72-79) is the exact pattern; add the WA deletes inside it. WA-04 integration test asserts 0 rows across all 4 tables + the provider_account row.

---

### `tests/unit/main/ipc/index.spec.ts` (MOD — test)

**Analog:** self (71-81). The assertion is `expect(handlers.size).toBe(Object.keys(CHANNELS).length)` — it auto-tracks the +7 WHATSAPP channels once they're in `CHANNELS` AND stubbed/registered. The +7 stubs (5 invoke + 2 push) must all be registered pre-unlock in `ipc/index.ts` or this test fails (the IPC double-register lesson). No hard-coded count to bump — it reads `Object.keys(CHANNELS).length`.

---

### `tests/unit/main/whatsapp/*.ratchet.spec.ts` (test — static ratchets)

**Analog:** `tests/static/voice-streaming-no-write.spec.ts` (the `walk()` + `stripComments` + identifier-boundary-RE structural template, 26-45) and `tests/static/no-bare-cron-schedule.spec.ts`.

- **passive-posture.ratchet** (gates 1/2/WA-11): `walk('src/main/whatsapp')`, assert ZERO matches for `\.sendMessage\(`, `\.sendReceipt\(`, `\.readMessages\(`, `\.sendPresenceUpdate\((?!'unavailable')`; assert config literal has `markOnlineOnConnect: false` + `emitOwnEvents: false` + `syncFullHistory: false`. Copy the missing-dir guard (`fs.existsSync` 41) so it's green before the dir exists.
- **no-frontier.ratchet** (gate 3): same walk, ZERO matches for `getFrontierModel`, `@ai-sdk/(anthropic|openai|google)`. Directory + ratchet land in Phase 20 even though the digest is Phase 21.

## Shared Patterns

### Canonical-channel-array + removeHandler re-registration
**Source:** `src/main/ipc/knowledge-folders.ts:29-46` (export) + `src/main/index.ts:516-557` (bootPoll loop) + `src/main/ipc/index.ts:498-532` (pre-unlock stubs).
**Apply to:** `ipc/whatsapp.ts`, `ipc/index.ts`, `index.ts`. Export `WHATSAPP_CHANNELS`; stub pre-unlock; `for (const ch of WHATSAPP_CHANNELS) ipcMain.removeHandler(ch)` in bootPoll before real register. Prevents the double-register throw that hit all 4 sites on 2026-06-09.

### Cron registration via scheduler.cronRegistry (no-bare-cron ratchet)
**Source:** `src/main/folder-ingestion/sweep-cron.ts:82-84` + seal-guard 67-77.
**Apply to:** `whatsapp/retention.ts` (03:30) AND the session-manager nightly recycle (03:00). Never bare `nodeCron.schedule` without `scheduler.cronRegistry.set(KEY, task)` — `tests/static/no-bare-cron-schedule.spec.ts` enforces it.

### db.transaction() atomicity + notReady() guard
**Source:** `src/main/ipc/provider-accounts.ts:14-16` (notReady) + 72-79 (transaction); `entitlement/service.ts:32-40` (best-effort audit).
**Apply to:** `auth-state.ts keys.set()` (gate 4), `ingest.ts` batch flush (gate 7), disconnect cascade. Every multi-row mutation wraps in `db.transaction(() => {...})`; every IPC handler guards `if (!db) return { error: 'DB_NOT_OPEN' }`.

### scheduler.queue.add single-writer serialization
**Source:** `src/main/integrations/google/sync-gmail.ts:16-19, 128, 170-172`.
**Apply to:** `ingest.ts` batch flush. ALL DB writes from Baileys event handlers funnel through `scheduler.queue.add(() => tx())` — never a sync `db.run()` inside the `messages.upsert` callback.

### Editorial Checkbox ack-gate
**Source:** `src/renderer/features/onboarding/MnemonicShow.tsx:16, 126-142` + `src/renderer/components/editorial/Checkbox.tsx`.
**Apply to:** `WhatsAppConsentModal.tsx` (D-05/D-07) and group-picker toggles (D-03). `useState(false)` + `disabled={!acknowledged}` on the primary action = the QR hard gate.

### Editorial modal shell
**Source:** `src/renderer/components/DisconnectConfirmDialog.tsx:45-51, 57-87` (`role="dialog"`, `aria-modal`, fixed overlay, Escape-closes, `borderTop: 2px solid var(--rose)` for emphasis).
**Apply to:** all three new WhatsApp modals (consent, QR, group-picker).

## No Analog Found

| File | Role | Data Flow | Reason / Planner guidance |
|------|------|-----------|---------------------------|
| `tests/unit/main/db/migration-138.spec.ts` | test (integration) | — | No existing per-migration integration test in `tests/unit/main/db/`. Use RESEARCH VALIDATION gate 12: apply 138 to a temp SQLCipher DB, assert `legacy_alter_table=ON` present in file, `PRAGMA user_version==138`, and a `provider_sync_state` INSERT succeeds (the migration-135 dangling-FK regression). Migration runner is `src/main/db/migrations/runner.ts`. |
| `tests/unit/main/electron-vite-config.spec.ts` | test (config) | — | No existing config-import test. Gate 11: `import config from electron.vite.config`, assert `config.main.plugins` exists and the externalize `exclude` contains `@whiskeysockets/baileys`; assert D-13 flags. (RESEARCH notes this is a NEW `main.plugins` key.) |

> Both gaps are tests, not source — the planner writes them fresh from the VALIDATION Architecture's concrete assertions. `auth-state.ts` and `session-manager.ts` are net-new domains (Baileys adapters) with only role-match analogs (entitlement service shape) — the protocol/crypto logic is Baileys', so the analog covers structure (deps, transaction, singleton guard) not the Signal internals (RESEARCH "the custom code is exactly four thin adapters").

## Metadata

**Analog search scope:** `src/main/{db/migrations,whatsapp,ipc,integrations,entitlement,folder-ingestion,lifecycle,secrets}`, `src/shared`, `src/renderer/{components,features}`, `tests/{unit,static}`.
**Files scanned:** ~18 source files read; all 22 cited analog paths verified present at HEAD 2026-06-09.
**Live-source corrections honored:** bootPoll (not onDbReady) wiring; `main.plugins` ADD (not edit); migration 125 (not 011) as provider_account source; sweep at 03:30 sibling cron (not extend knowledge sweep-cron).
**Pattern extraction date:** 2026-06-09

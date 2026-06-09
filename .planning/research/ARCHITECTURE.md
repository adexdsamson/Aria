# Architecture Research: Baileys WhatsApp Integration

**Domain:** Electron main-process push-socket integration layered onto Aria's existing Provider/SyncOrchestrator architecture
**Researched:** 2026-06-09
**Confidence:** HIGH (all integration points verified against live source files)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                                        │
│  WhatsApp UI: QR modal · group picker · digest in briefing section       │
└─────────────────────────┬───────────────────────────────────────────────┘
                          │  IPC (invoke/handle + push webContents.send)
┌─────────────────────────▼───────────────────────────────────────────────┐
│  Main Process                                                            │
│                                                                          │
│  ipc/index.ts ──── ipc/whatsapp.ts ──── WhatsAppSessionManager          │
│       │                │                     │                          │
│       │                │               Baileys makeWASocket             │
│       │                │               (ONE socket, singleton)          │
│       │                │                     │ push events              │
│       │                │               ┌─────▼──────────────────────┐   │
│       │                │               │ connection.update           │   │
│       │                │               │ creds.update               │   │
│       │                │               │ messages.upsert            │   │
│       │                │               │ groups.upsert              │   │
│       │                │               │ group-participants.update  │   │
│       │                │               └─────────────────────────── ┘   │
│       │                │                                                 │
│  provider-accounts.ts  │  (disconnect cascade extends here)             │
│  (existing, modified)  │                                                 │
│                                                                          │
│  digest-cron.ts  ──── node-cron '0 5 * * *'  ──── p-queue (shared)     │
│       │                                                                  │
│  briefing/generate.ts  (gatherWhatsAppDigests added)                    │
└─────────────────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────────────┐
│  SQLite (SQLCipher)                                                      │
│  whatsapp_auth_state · whatsapp_group · whatsapp_message                │
│  whatsapp_group_digest                                                   │
│  provider_account (provider_key loosened to include 'whatsapp')         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | New vs Modified |
|-----------|---------------|----------------|
| `src/main/whatsapp/session-manager.ts` | Owns the single Baileys socket: lifecycle, reconnect backoff, event dispatch to DB | NEW |
| `src/main/whatsapp/auth-state.ts` | SQLite-backed `AuthenticationState` adapter (replaces `useMultiFileAuthState`) | NEW |
| `src/main/whatsapp/ingest.ts` | `messages.upsert` handler: privacy filter, normalize, write `whatsapp_message` | NEW |
| `src/main/whatsapp/group-sync.ts` | `groups.upsert` + `group-participants.update` handler, upsert `whatsapp_group` | NEW |
| `src/main/whatsapp/digest-cron.ts` | node-cron job: read messages → Ollama generateObject → write `whatsapp_group_digest` | NEW |
| `src/main/ipc/whatsapp.ts` | IPC registrar for all WhatsApp channels (canonical channel array + removeHandler pattern) | NEW |
| `src/main/ipc/index.ts` | Register `whatsapp.ts` registrar; add `whatsapp` to `onDbReady` callback | MODIFIED |
| `src/main/ipc/provider-accounts.ts` | Extend disconnect cascade: stop socket + delete `whatsapp_*` tables on disconnect | MODIFIED |
| `src/main/briefing/generate.ts` | Add `gatherWhatsAppDigests(db)` gatherer; inject into `runBriefing` Promise.allSettled | MODIFIED |
| `src/shared/ipc-contract.ts` | Add `WHATSAPP_*` channel constants + DTOs | MODIFIED |
| `src/shared/provider.ts` | Add `'whatsapp'` to `ProviderKey` union (type only — NO interface additions) | MODIFIED |
| `src/main/db/migrations/138_whatsapp.sql` | 4 new tables + provider_key CHECK constraint rebuild | NEW |

---

## Session Manager: Lifecycle and State Machine

### Singleton vs Registry

Use a **singleton** `WhatsAppSessionManager`. Rationale: WhatsApp's linked-device model allows only one active WebSocket connection per linked device. Multiple sockets to the same account will conflict. The `provider_account` row exists for identity/UI/disconnect reuse, not to imply multiple concurrent sockets.

The manager holds no `accountId` registry — it manages exactly one socket keyed on the single `whatsapp` provider_account row (PK: `provider_key='whatsapp'`, `account_id` = the user's phone JID or a stable `'primary'` sentinel set at link time).

### Construction and Teardown

**Post-unlock pattern** — identical to how `startSyncOrchestrator` is constructed in `src/main/ipc/index.ts`:

```typescript
// In registerOnboardingHandlers onDbReady callback (ipc/index.ts):
onDbReady: (db) => {
  stopSyncOrchestrator(syncOrchestrator);
  syncOrchestrator = startSyncOrchestrator({ db, scheduler: getScheduler(), logger });

  // NEW: construct WhatsApp manager post-unlock
  stopWhatsAppSessionManager(whatsAppManager);
  whatsAppManager = createWhatsAppSessionManager({ db, scheduler: getScheduler(), logger });
  whatsAppManager.start();   // starts socket only if provider_account row exists
}
```

**Teardown:** `whatsAppManager.stop()` closes the socket and cancels reconnect timers. Called on app quit (`app.on('before-quit')`) and when the vault is re-locked (same `onDbReady` path resets it).

**Power suspend/resume:** Register `registerLifecycleCallbacks` (same as `ipc/gmail.ts`) to call socket close on suspend and `reconnect()` on resume. Do NOT keep a socket alive during machine sleep — WhatsApp Web drops connections within seconds; a reconnect storm on resume can trigger rate-limits.

### State Machine

States map to `provider_account.status` values (the shared enum). WhatsApp adds one ephemeral state (`qr-pending`) that is NOT persisted to `provider_account` — it exists only in memory on the manager instance.

```
              [manager created]
              no row → idle (start() is a no-op)
                    │
                    │ IPC: WHATSAPP_LINK
                    ▼
┌──────────────────────────────────────────────────────────────┐
│  LINKING (socket created, connection='connecting')           │
│  provider_account: status='needs-auth'                       │
│  manager internal: qrString = null                           │
└──────────────┬───────────────────────────────────────────────┘
               │ connection.update: qr present
               ▼
┌──────────────────────────────────────────────────────────────┐
│  QR_PENDING (waiting for phone scan)                         │
│  provider_account: status='needs-auth'                       │
│  manager internal: qrString = <base64>                       │
│  IPC push: WHATSAPP_QR_UPDATE → renderer shows QR            │
└──────────────┬───────────────────────────────────────────────┘
               │ connection.update: connection='open'
               ▼
┌──────────────────────────────────────────────────────────────┐
│  CONNECTED (operational)                                     │
│  provider_account: status='ok'                               │
│  manager internal: socket alive, events flowing              │
└──────────────┬───────────────────────────────────────────────┘
               │ connection.update: connection='close'
               ▼
┌──────────────────────────────────────────────────────────────┐
│  DISCONNECTED (evaluate lastDisconnect.error.output.status)  │
└──────┬────────────────┬──────────────────────┬───────────────┘
       │ restartRequired│ connectionLost/       │ loggedOut/forbidden/
       │ (515)          │ timedOut/closed (408) │ connectionReplaced/badSession
       ▼                ▼                       ▼
 RECONNECTING      RECONNECTING           LOGGED_OUT
 immediate         exp backoff            provider_account: status='needs-auth'
 (max 1 attempt)   1s/2s/4s/8s/30s cap   qrString=null, socket destroyed
                   after 10 fails →       IPC push: WHATSAPP_STATE_CHANGED
                   status='degraded'      requires re-link (WHATSAPP_LINK)
```

### DisconnectReason Mapping

| `statusCode` | Baileys constant | Action | `provider_account.status` |
|---|---|---|---|
| 515 | `restartRequired` | Reconnect immediately (server is requesting restart) | `'degraded'` during, `'ok'` on reconnect |
| 408 | `connectionLost` / `timedOut` / `connectionClosed` | Exponential backoff 1s/2s/4s/8s/30s cap; max 10 attempts then stay degraded | `'degraded'` after exhausting |
| 440 | `connectionReplaced` | Soft-close, do NOT reconnect; another device took the connection | `'needs-auth'` |
| 401 | `loggedOut` | Destroy socket, clear `whatsapp_auth_state`, set needs-auth; user must re-link | `'needs-auth'` |
| 403 | `forbidden` | Same as loggedOut; indicates potential ban | `'needs-auth'` |
| 500 | `badSession` | Clear auth state entirely, treat as loggedOut | `'needs-auth'` |

**Code pattern for the close handler:**

```typescript
sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
  if (qr) { pushQrToRenderer(qr); return; }
  if (connection === 'open') { onConnected(); return; }
  if (connection === 'close') {
    const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
    const shouldDestroy =
      code === DisconnectReason.loggedOut ||
      code === DisconnectReason.forbidden ||
      code === DisconnectReason.badSession ||
      code === DisconnectReason.connectionReplaced;
    if (shouldDestroy) {
      onLoggedOut(code);      // sets status='needs-auth', clears qrString
    } else {
      scheduleReconnect();    // exponential backoff
    }
  }
});
```

---

## Auth State: SQLite Adapter

Baileys' default `useMultiFileAuthState` writes JSON files to disk. For Aria this is wrong: auth material must live inside the SQLCipher-encrypted DB, not as plaintext files in the data directory.

**Implement `useSQLiteAuthState(db)`** returning `{ state: AuthenticationState, saveCreds: () => void }`.

The `AuthenticationState` has two parts:
- `creds: AuthenticationCreds` — a single JSON blob, stored as one row in `whatsapp_auth_state WHERE key='creds'`
- `keys: SignalKeyStore` — key/value store for pre-keys, sessions, sender-keys, etc.; stored as rows in `whatsapp_auth_state WHERE key LIKE 'keys:<type>:<id>'`

`saveCreds()` serializes current `state.creds` and upserts into `whatsapp_auth_state`. The `SignalKeyStore.set()` method upserts key rows; `get()` reads and deserializes; `clear()` deletes.

All reads and writes are synchronous (`better-sqlite3` API), which is correct for Electron's main-process single-writer model. No async needed here.

---

## Message Ingestion: Privacy Filter Placement

The privacy filter MUST be the first operation inside `messages.upsert` — before any DB write, before any logging, before any other processing. Untracked-group and 1:1 content must never touch SQLite.

```typescript
sock.ev.on('messages.upsert', ({ messages, type }) => {
  if (type !== 'notify') return;   // 'append' = history-sync batch; skip

  for (const msg of messages) {
    const jid = msg.key.remoteJid ?? '';

    // ── PRIVACY FILTER (must be first) ─────────────────────────────────
    if (!jid.endsWith('@g.us')) continue;           // not a group: drop silently
    const trackedRow = db.prepare(
      'SELECT 1 FROM whatsapp_group WHERE jid = ? AND tracked = 1'
    ).get(jid);
    if (!trackedRow) continue;                      // untracked group: drop silently
    // ── END PRIVACY FILTER ─────────────────────────────────────────────

    if (msg.message?.protocolMessage) continue;     // control/ephemeral: skip
    if (!msg.message) continue;

    const bodyText = extractText(msg);              // text-only; null for media
    if (!bodyText) continue;                        // skip images/audio/video

    db.prepare(`
      INSERT OR IGNORE INTO whatsapp_message
        (jid, sender_jid, wa_id, sent_at, body_text, ingested_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(jid, msg.key.participant ?? '', msg.key.id ?? '', msgTimestamp(msg), bodyText);
  }
});
```

**`extractText(msg)`** covers: `conversation`, `extendedTextMessage.text`, `buttonsResponseMessage.selectedDisplayText`. Returns `null` for image/video/audio/document/sticker — those are never stored.

The `type === 'notify'` guard is critical: `type='append'` fires on reconnect for the full history buffer (potentially thousands of messages). The `UNIQUE(jid, wa_id)` constraint would prevent true duplication but the loop would still run and lock the main process.

---

## Data Model

### New Tables (migration 138)

**`whatsapp_auth_state`** — encrypted creds blob + signal keys

```sql
CREATE TABLE whatsapp_auth_state (
  key   TEXT NOT NULL PRIMARY KEY,   -- 'creds' | 'keys:<type>:<id>'
  value TEXT NOT NULL                -- JSON-serialized
);
```

**`whatsapp_group`** — user's group list + privacy toggles

```sql
CREATE TABLE whatsapp_group (
  jid          TEXT NOT NULL PRIMARY KEY,   -- e.g. 123456789-group@g.us
  display_name TEXT NOT NULL,
  description  TEXT,
  tracked      INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0,1)),
  member_count INTEGER,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_whatsapp_group_tracked ON whatsapp_group(tracked);
```

**`whatsapp_message`** — 30-day rolling retention, text only

```sql
CREATE TABLE whatsapp_message (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  jid         TEXT NOT NULL,              -- group JID (FK whatsapp_group)
  sender_jid  TEXT NOT NULL,              -- participant JID
  wa_id       TEXT NOT NULL,              -- WhatsApp message ID
  sent_at     TEXT NOT NULL,              -- ISO-8601 from msg timestamp
  body_text   TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (jid, wa_id),                    -- idempotent on re-ingest
  FOREIGN KEY (jid) REFERENCES whatsapp_group(jid) ON DELETE CASCADE
);
CREATE INDEX idx_whatsapp_message_jid_sent ON whatsapp_message(jid, sent_at DESC);
CREATE INDEX idx_whatsapp_message_sent     ON whatsapp_message(sent_at DESC);
```

**`whatsapp_group_digest`** — daily LLM output per tracked group

```sql
CREATE TABLE whatsapp_group_digest (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  jid          TEXT NOT NULL,
  date         TEXT NOT NULL,              -- YYYY-MM-DD
  summary      TEXT NOT NULL,
  decisions    TEXT,                       -- JSON array of strings
  open_qx      TEXT,                       -- JSON array of open questions
  model_id     TEXT NOT NULL,              -- Ollama model that produced this
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (jid, date),                      -- idempotent re-runs
  FOREIGN KEY (jid) REFERENCES whatsapp_group(jid) ON DELETE CASCADE
);
CREATE INDEX idx_whatsapp_group_digest_date ON whatsapp_group_digest(date DESC);
```

### Migration 138: provider_key CHECK Constraint Rebuild

The `provider_account` table (migration 011) has `CHECK (provider_key IN ('google','microsoft'))`. Adding `'whatsapp'` requires a table rebuild. Because `provider_sync_state` has a FK pointing at `provider_account(provider_key, account_id)`, the RENAME inside the rebuild **must** be wrapped in `PRAGMA legacy_alter_table=ON` to prevent SQLite from silently rewriting that FK to point at `provider_account_old` — which would then be dropped, leaving a dangling reference. This is the exact pitfall documented in migration 135.

The full migration wrapper:

```sql
PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;
BEGIN;

CREATE TABLE provider_account_new (
  account_id        TEXT NOT NULL,
  provider_key      TEXT NOT NULL CHECK (provider_key IN ('google','microsoft','todoist','whatsapp')),
  -- ... all other columns verbatim from 011 ...
  PRIMARY KEY (provider_key, account_id)
);
INSERT INTO provider_account_new SELECT * FROM provider_account;
DROP TABLE provider_account;
ALTER TABLE provider_account_new RENAME TO provider_account;
CREATE INDEX IF NOT EXISTS idx_provider_account_status ON provider_account(status);

-- ... 4 new whatsapp tables here ...

COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
PRAGMA user_version = 138;
```

**Note:** `todoist` must also appear in the new CHECK because it was added by a later migration without a table rebuild (it used `INSERT OR REPLACE` in practice). The `provider_account_new` DDL must match the full live schema column-for-column.

### Disconnect Cascade Additions

In `src/main/ipc/provider-accounts.ts`, the `PROVIDER_ACCOUNT_DISCONNECT` handler adds a `'whatsapp'` branch:

```typescript
if (r.providerKey === 'whatsapp') {
  whatsAppManager?.stop();  // close socket immediately (injected via deps)
}
const tx = db.transaction(() => {
  // ... existing provider_sync_state + gmail_message + calendar_event + approval deletes ...
  if (r.providerKey === 'whatsapp') {
    db.prepare('DELETE FROM whatsapp_auth_state').run();
    db.prepare('DELETE FROM whatsapp_group WHERE 1=1').run();
    // whatsapp_message + whatsapp_group_digest cascade via ON DELETE CASCADE from whatsapp_group
  }
  db.prepare('DELETE FROM provider_account WHERE provider_key = ? AND account_id = ?')
    .run(r.providerKey, r.accountId);
});
tx();
```

The `whatsAppManager` reference is threaded into `registerProviderAccountHandlers` deps — same pattern as `scheduler` is threaded into `registerGmailHandlers`.

---

## Digest Job

### Cron Registration

Register in `src/main/whatsapp/digest-cron.ts`. Pattern mirrors `src/main/briefing/schedule.ts`:

```typescript
const CRON_KEY = 'whatsapp-digest';
const CRON_SCHEDULE = '0 5 * * *';  // 05:00 local daily — runs before briefing (07:00)
```

Register via `scheduler.cronRegistry` (the shared `SchedulerHandle`). The p-queue from the same handle serializes this job against all other LLM calls.

**DB-null guard** (same as `ipc/gmail.ts` lines 91–100):

```typescript
const task = cron.schedule(CRON_SCHEDULE, () => {
  const db = dbHolder.db;
  if (!db) {
    pendingCatchup.add('whatsapp-digest');
    return;
  }
  void runWhatsAppDigest({ db, scheduler, logger }).catch((err) => {
    logger.warn({ scope: 'whatsapp-digest', err }, 'digest cron error');
  });
});
scheduler.cronRegistry.set(CRON_KEY, task);
```

### Digest Engine: `runWhatsAppDigest`

```typescript
async function runWhatsAppDigest({ db, scheduler, logger, today }) {
  const trackedGroups = db.prepare(
    'SELECT jid, display_name FROM whatsapp_group WHERE tracked = 1'
  ).all();

  for (const group of trackedGroups) {
    const existing = db.prepare(
      'SELECT 1 FROM whatsapp_group_digest WHERE jid = ? AND date = ?'
    ).get(group.jid, today);
    if (existing) continue;  // idempotent

    const messages = db.prepare(`
      SELECT sender_jid, sent_at, body_text
        FROM whatsapp_message
       WHERE jid = ? AND sent_at >= datetime('now', '-24 hours')
       ORDER BY sent_at ASC
    `).all(group.jid);
    if (messages.length === 0) continue;

    const prompt = buildDigestPrompt(group.display_name, messages);

    const result = await scheduler.queue.add(() =>
      generateObject({
        model: getLocalModel(),   // LOCAL ONLY — never frontier for group content
        schema: DigestSchema,
        prompt,
      })
    );

    db.prepare(`
      INSERT OR REPLACE INTO whatsapp_group_digest
        (jid, date, summary, decisions, open_qx, model_id, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      group.jid, today,
      result.object.summary,
      JSON.stringify(result.object.decisions ?? []),
      JSON.stringify(result.object.open_questions ?? []),
      getLocalModel().modelId,
    );
  }
}
```

**`DigestSchema`** (Zod):

```typescript
const DigestSchema = z.object({
  summary:        z.string().max(500),
  decisions:      z.array(z.string().max(200)).max(5).default([]),
  open_questions: z.array(z.string().max(200)).max(5).default([]),
});
```

**Local-model invariant:** `getLocalModel()` is called unconditionally. No `router.classify()`. Group chat content is third-party PII; it must never be sent to a frontier model. This is a hard invariant, not a routing preference.

---

## Briefing Integration

### Adding the WhatsApp Gatherer

In `src/main/briefing/generate.ts`, add `gatherWhatsAppDigests` as a fourth gatherer alongside the existing three:

```typescript
function gatherWhatsAppDigests(db: Db, date: string): WhatsAppDigestCandidate[] {
  try {
    return db.prepare(`
      SELECT g.display_name AS name, d.summary, d.decisions, d.open_qx, d.jid
        FROM whatsapp_group_digest d
        JOIN whatsapp_group g ON g.jid = d.jid
       WHERE d.date = ? AND g.tracked = 1
       ORDER BY d.generated_at ASC
    `).all(date) as WhatsAppDigestCandidate[];
  } catch {
    return [];   // table not yet migrated; graceful degradation
  }
}
```

Integrate into `runBriefing` via the existing `Promise.allSettled` fan-out:

```typescript
const waPromise = Promise.resolve(gatherWhatsAppDigests(db, date));
const [calRes, emailRes, newsRes, waRes] = await Promise.allSettled([
  calPromise, emailPromise, newsPromise, waPromise
]);
```

The section is additive — if empty or rejected, the briefing proceeds without error (consistent with the existing error-isolation pattern). Inject digests into `buildBriefingPrompt` as a new `=== WHATSAPP GROUPS ===` section.

**`BriefingSchema` extension** (Zod, inside `generate.ts`):

```typescript
whatsapp: z.array(z.object({
  jid:     z.string(),
  name:    z.string(),
  summary: z.string().max(200),
})).max(3).default([]),
```

The renderer briefing section reads `payload.whatsapp[]` and renders an optional fourth section. An empty array hides the section entirely.

---

## IPC Layer

### New Channels (ipc-contract.ts)

```typescript
// WhatsApp invoke channels (renderer → main)
WHATSAPP_LINK          = 'whatsapp:link',           // start QR flow
WHATSAPP_STATUS        = 'whatsapp:status',          // get connection state + QR string
WHATSAPP_DISCONNECT    = 'whatsapp:disconnect',      // unlink + cascade
WHATSAPP_LIST_GROUPS   = 'whatsapp:list-groups',     // list known groups from DB
WHATSAPP_SET_TRACKED   = 'whatsapp:set-tracked',     // toggle tracking on a group
// WhatsApp push channels (main → renderer, no-op handle stubs)
WHATSAPP_QR_UPDATE     = 'whatsapp:qr-update',       // new QR string
WHATSAPP_STATE_CHANGED = 'whatsapp:state-changed',   // connection state change
```

### IPC Registrar: `ipc/whatsapp.ts`

Follow the exact pattern from `ipc/gmail.ts`:

1. Export a `WHATSAPP_CHANNELS` const array — used in `ipc/index.ts` for the `skip` guard and for `ipcMain.removeHandler` loops before re-registration post-unlock.
2. DB-null guard: return `{ error: 'DB_NOT_OPEN' }` if `dbHolder.db` is null.
3. The two push-only channels (`WHATSAPP_QR_UPDATE`, `WHATSAPP_STATE_CHANGED`) are added to the `pushOnlyChannels` array in `ipc/index.ts` (same array as `VOICE_TRANSCRIPT_DELTA` etc.) — they need no-op `ipcMain.handle` stubs to pass the handler-count test.

### Wiring in `ipc/index.ts`

Pre-unlock stubs (matching `knowledgeChannels` pattern, lines 488–533):

```typescript
const whatsappInvokeChannels = [
  CHANNELS.WHATSAPP_LINK, CHANNELS.WHATSAPP_STATUS, CHANNELS.WHATSAPP_DISCONNECT,
  CHANNELS.WHATSAPP_LIST_GROUPS, CHANNELS.WHATSAPP_SET_TRACKED,
];
if (!whatsappInvokeChannels.every((c) => skip.has(c))) {
  for (const c of whatsappInvokeChannels) {
    if (!skip.has(c)) ipcMain.handle(c, () => ({ ok: false, error: 'db-locked' }));
  }
  whatsappInvokeChannels.forEach((c) => skip.add(c));
}
```

Post-unlock real handlers (in `onDbReady`):

```typescript
onDbReady: (db) => {
  stopSyncOrchestrator(syncOrchestrator);
  syncOrchestrator = startSyncOrchestrator({ db, scheduler: getScheduler(), logger });

  stopWhatsAppSessionManager(whatsAppManager);
  whatsAppManager = createWhatsAppSessionManager({ db, scheduler: getScheduler(), logger });
  whatsAppManager.start();

  for (const c of WHATSAPP_CHANNELS) ipcMain.removeHandler(c);
  registerWhatsAppHandlers(ipcMain, {
    logger, dbHolder, scheduler: getScheduler(), manager: whatsAppManager,
  });
}
```

The `whatsAppManager` reference is also threaded into `registerProviderAccountHandlers` deps via the same post-unlock registration slot.

---

## File / Directory Structure

```
src/
├── main/
│   ├── whatsapp/
│   │   ├── session-manager.ts    # Socket lifecycle, state machine, reconnect backoff
│   │   ├── auth-state.ts         # useSQLiteAuthState — SQLite-backed creds + signal keys
│   │   ├── ingest.ts             # messages.upsert handler: privacy filter + DB write
│   │   ├── group-sync.ts         # groups.upsert + group-participants.update
│   │   ├── digest-cron.ts        # node-cron job + runWhatsAppDigest engine
│   │   └── digest-schema.ts      # Zod DigestSchema + buildDigestPrompt
│   ├── ipc/
│   │   ├── whatsapp.ts           # IPC registrar (NEW)
│   │   ├── index.ts              # MODIFIED: pre-unlock stubs + onDbReady wiring
│   │   └── provider-accounts.ts  # MODIFIED: whatsapp disconnect cascade
│   ├── briefing/
│   │   └── generate.ts           # MODIFIED: gatherWhatsAppDigests + BriefingSchema.whatsapp
│   └── db/migrations/
│       └── 138_whatsapp.sql      # 4 new tables + provider_account rebuild
├── shared/
│   ├── ipc-contract.ts           # MODIFIED: WHATSAPP_* constants + DTOs
│   └── provider.ts               # MODIFIED: ProviderKey += 'whatsapp'
└── renderer/
    └── (QR modal + group picker + briefing whatsapp section — Wave 2 UI)
```

---

## Architectural Patterns

### Pattern 1: Post-Unlock Service Construction

**What:** Stateful main-process services that need DB access are constructed inside the `onDbReady` callback in `ipc/index.ts`. A `null`-initialized reference is swapped when the DB unlocks.

**When to use:** Any service that reads from or writes to SQLite on startup. `WhatsAppSessionManager` fits because it reads `whatsapp_auth_state` to restore the socket.

**Aria precedents:** `startSyncOrchestrator`, `createFolderRegistry`, entitlement service. The pattern is well-established and tested.

### Pattern 2: Push Socket vs Poll Delta (Hybrid C)

**What:** Baileys is event-driven (WebSocket push), not poll-delta. The `SyncOrchestrator` is built around `listMessagesDelta` + cursors + `provider_sync_state`. WhatsApp uses a dedicated `WhatsAppSessionManager` as a peer service.

**Guard that prevents accidental routing:** `isMailCalendarAccount()` in `sync-orchestrator.ts` already gates `tickAccount` to `'google' | 'microsoft'`. A `provider_account` row with `provider_key='whatsapp'` will be silently skipped by the orchestrator at startup — no change needed there.

**The `provider_account` row serves only three purposes for WhatsApp:** UI display in the accounts list, status tracking (`status` field maps to socket state), and the disconnect cascade trigger. It does not participate in `scheduleAccount`, `tickAccount`, or `provider_sync_state`.

### Pattern 3: Privacy Filter at Ingestion Boundary

**What:** The tracked-group check is the absolute first operation on any inbound message — before any logging, buffering, or transformation.

**Why:** 1:1 messages are the user's personal communications. Untracked group messages belong to people who did not consent to Aria processing them. The filter must be synchronous (sqlite `.get()`) so it cannot be skipped by async ordering.

**Single source of truth:** `whatsapp_group.tracked = 1` in the DB. Not an in-memory set. This means the filter stays current across hot group additions from the UI without requiring a restart.

### Pattern 4: Canonical Channel Array + removeHandler

**What:** Each IPC registrar exports a `const WHATSAPP_CHANNELS: readonly string[]`. `ipc/index.ts` loops `ipcMain.removeHandler(c)` over this array before re-registering real handlers post-unlock.

**Why:** Aria's known pitfall — `ipcMain.handle` throws on second registration (MEMORY: `reference_electron_ipc_double_register`). Every channel that is stub-registered pre-unlock must be explicitly removed before the real registrar runs.

---

## Anti-Patterns

### Anti-Pattern 1: Routing WhatsApp Through SyncOrchestrator

**What people do:** Add `'whatsapp'` to `isMailCalendarAccount()`, create a fake `listMessagesDelta` adapter that returns empty deltas.

**Why it's wrong:** WhatsApp pushes messages over a persistent WebSocket. There is no cursor API. A fake adapter misses messages during any poll interval and adds reconnect complexity inside the orchestrator's error handling path.

**Do this instead:** `WhatsAppSessionManager` as a peer service to `SyncOrchestrator`, constructed in the same `onDbReady` slot.

### Anti-Pattern 2: File-System Auth State

**What people do:** Use Baileys' built-in `useMultiFileAuthState('auth_dir')` pointing to the Electron userData directory.

**Why it's wrong:** Auth material (noise key, signal identity key, session keys, pre-keys) sits in plaintext JSON files outside the SQLCipher envelope. The `auth_info_baileys/` directory contains sufficient material to impersonate the user's WhatsApp account.

**Do this instead:** `useSQLiteAuthState(db)` — all creds + signal keys stored as rows in `whatsapp_auth_state` inside the encrypted DB.

### Anti-Pattern 3: Persisting Media

**What people do:** Store `imageMessage`, `audioMessage`, `videoMessage` blobs alongside text.

**Why it's wrong:** Media blobs are 100KB–5MB each. 30-day retention for a busy group produces gigabytes. Baileys does not auto-download media; it requires an explicit `downloadMediaMessage()` call. Digest quality is not improved by images.

**Do this instead:** `extractText(msg)` returns `null` for non-text messages; the `if (!bodyText) continue` guard drops them before any DB call.

### Anti-Pattern 4: Frontier Model for Digest

**What people do:** Route digest generation through `router.classify()` which may send content to Anthropic/OpenAI based on routing logic.

**Why it's wrong:** Group chat messages are third-party PII. Members of those groups did not consent to their words being sent to a cloud API.

**Do this instead:** Call `getLocalModel()` directly in `runWhatsAppDigest`. No classify step, no routing. Consider a linter rule or static grep ratchet that whatsapp source files never import `getFrontierModel`.

### Anti-Pattern 5: Processing `type='append'` Messages

**What people do:** Handle all `messages.upsert` events regardless of the `type` field.

**Why it's wrong:** On reconnect, Baileys fires `type='append'` for the full message history buffer (potentially thousands of messages). Running the privacy filter + DB insert loop thousands of times blocks the main process and generates spurious `ingested_at` timestamps.

**Do this instead:** `if (type !== 'notify') return;` as the very first guard in the `messages.upsert` handler.

---

## Build Order

### Wave 1: Foundation (no renderer changes; establishes the seam)

1. **Migration 138** — all 4 tables + `provider_account` rebuild. Must land first; everything else depends on the schema.
2. **`whatsapp/auth-state.ts`** — `useSQLiteAuthState`. Self-contained; testable in isolation against an in-memory DB.
3. **`whatsapp/session-manager.ts`** — State machine, `useSQLiteAuthState`, reconnect backoff. Depends on auth-state.ts.
4. **`whatsapp/group-sync.ts`** — `groups.upsert` + `group-participants.update` handlers attached to session manager events.
5. **`whatsapp/ingest.ts`** — `messages.upsert` handler with privacy filter + DB write attached to session manager.

### Wave 2: IPC + UI (makes the feature user-accessible)

6. **`shared/ipc-contract.ts`** — `WHATSAPP_*` channel constants + DTOs.
7. **`shared/provider.ts`** — `ProviderKey` union += `'whatsapp'`.
8. **`ipc/whatsapp.ts`** — IPC registrar with canonical channel array.
9. **`ipc/index.ts`** — Pre-unlock stubs + `onDbReady` real-handler registration.
10. **`ipc/provider-accounts.ts`** — Extend disconnect cascade.
11. **Renderer: QR modal + group picker** — Depends on `WHATSAPP_*` IPC channels being live.

### Wave 3: Digest + Briefing (the value delivery)

12. **`whatsapp/digest-schema.ts`** — `DigestSchema` + `buildDigestPrompt`. Self-contained.
13. **`whatsapp/digest-cron.ts`** — `runWhatsAppDigest` + cron registration at `'0 5 * * *'`.
14. **`ipc/index.ts`** — Register digest cron in `onDbReady` alongside sync orchestrator start.
15. **`briefing/generate.ts`** — `gatherWhatsAppDigests` + fourth `Promise.allSettled` arm + `BriefingSchema.whatsapp`.
16. **Renderer: WhatsApp section in briefing** — Reads `payload.whatsapp[]`, renders as optional fourth section.

### Deferred Seam Costs (kept cheap by this order)

**Action-item extraction → `task_batch`:** Add a second `generateObject` call in `runWhatsAppDigest` with an `ActionItemSchema`. Writes rows to `task_batch` (Phase 6 existing table). Zero schema changes. `whatsapp_message` rows already exist.

**Meeting-proposal detection → `calendar_change` approval:** Same pattern — a third `generateObject` call in the digest job, or a separate `messages.upsert` handler path. Routes output through the existing `approval` table (Phase 3). Zero schema changes.

**RAG capture:** `whatsapp_message.body_text` is already plain text in the correct format for the existing chunker pipeline. Add `source_kind='whatsapp'` to the `rag_chunk` INSERT in `ingest.ts` and a `corpus='whatsapp'` filter in the RAG query path. Zero new tables.

---

## Integration Points Summary

| Seam | File | Change Type |
|------|------|------------|
| DB schema | `migrations/138_whatsapp.sql` | NEW: 4 tables + provider_account rebuild with `legacy_alter_table=ON` |
| Post-unlock construction | `ipc/index.ts` `onDbReady` callback | MODIFIED: add `whatsAppManager` alongside `syncOrchestrator` |
| Pre-unlock stubs | `ipc/index.ts` (new block) | MODIFIED: stub WHATSAPP invoke channels; push channels into `pushOnlyChannels` |
| Disconnect cascade | `ipc/provider-accounts.ts` ~line 58 | MODIFIED: `'whatsapp'` branch — stop manager + delete auth state + cascade |
| Briefing gatherer | `briefing/generate.ts` ~line 378 | MODIFIED: 4th `Promise.allSettled` arm + `gatherWhatsAppDigests` |
| Briefing schema | `briefing/generate.ts` `BriefingSchema` | MODIFIED: add `whatsapp: z.array(...).default([])` |
| Shared types | `shared/provider.ts` | MODIFIED: `ProviderKey` += `'whatsapp'` |
| IPC contract | `shared/ipc-contract.ts` | MODIFIED: 7 new WHATSAPP channel constants + DTOs |
| ProviderRegistry | `integrations/registry.ts` | NO CHANGE: `buildProvider` already throws for unknown keys; WhatsApp never calls `registry.get()` |
| SyncOrchestrator | `integrations/sync-orchestrator.ts` | NO CHANGE: `isMailCalendarAccount()` returns false for `'whatsapp'`; rows silently skipped |

---

## Sources

- Baileys `ConnectionState` type (qr, connection values, lastDisconnect): `github.com/WhiskeySockets/Baileys/blob/master/src/Types/State.ts` — HIGH confidence (verified live)
- Baileys `DisconnectReason` enum (all numeric codes): `github.com/WhiskeySockets/Baileys/blob/master/src/Types/index.ts` — HIGH confidence (verified live)
- Baileys `BaileysEventMap` (messages.upsert type field, groups.upsert shape): `github.com/WhiskeySockets/Baileys/blob/master/src/Types/Events.ts` — HIGH confidence (verified live)
- Baileys `AuthenticationState`/`AuthenticationCreds` (creds + keys structure): `github.com/WhiskeySockets/Baileys/blob/master/src/Types/Auth.ts` — HIGH confidence (verified live)
- Aria `provider_account` DDL + FK structure: `src/main/db/migrations/011_provider_accounts.sql` — HIGH confidence (read live at HEAD)
- Aria `legacy_alter_table` pattern: `src/main/db/migrations/135_repair_approval_child_fks.sql` — HIGH confidence (read live at HEAD)
- Aria `ipc/index.ts` (pre-unlock stub + onDbReady patterns): read live at HEAD, all patterns verified
- Aria `ipc/gmail.ts` (cron + db-null guard + suspend/resume pattern): read live at HEAD
- Aria `ipc/provider-accounts.ts` (disconnect cascade pattern): read live at HEAD
- Aria `briefing/generate.ts` (Promise.allSettled gatherer fan-out pattern): read live at HEAD
- Aria `integrations/sync-orchestrator.ts` (`isMailCalendarAccount` guard): read live at HEAD

---

*Architecture research for: Baileys WhatsApp integration into Aria's Electron main-process integration layer*
*Researched: 2026-06-09*

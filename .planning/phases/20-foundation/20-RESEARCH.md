# Phase 20: Foundation (WhatsApp group-tracking) — Research

**Researched:** 2026-06-09
**Domain:** Baileys WhatsApp Web integration into Aria's Electron main-process integration layer (push-socket peer to SyncOrchestrator)
**Confidence:** HIGH — milestone research is locked HIGH-confidence; every live integration point in this pass was re-verified against HEAD source on 2026-06-09; net-new value is the Validation Architecture + three live-source corrections.

> **Scope of this pass.** The technical approach is ALREADY LOCKED in `.planning/research/{SUMMARY,ARCHITECTURE,PITFALLS,STACK,FEATURES}.md` and `20-CONTEXT.md` (D-01..D-14). This document does **not** re-derive it. It (1) synthesizes the locked research into a planner-actionable build order + file list + hard-gate list, (2) produces the REQUIRED `## Validation Architecture` section that maps all 9 requirements and all 12 hard gates to concrete testable assertions, and (3) flags three genuine live-source gaps where the locked research's instructions need correction before planning. **None of the locked decisions are re-opened.**

---

## Summary

Phase 20 builds the entire WhatsApp foundation: a `WhatsAppSessionManager` singleton owning one Baileys (`@whiskeysockets/baileys@6.7.23`) socket, SQLCipher-backed auth state, a privacy-filtered ingest path writing tracked-group text to `whatsapp_message`, migration 138 (4 new tables + a `provider_account` CHECK rebuild), the IPC surface (7 channels), and the renderer (consent-gate modal, QR modal, AccountRow extension, group-picker modal, disconnect cascade). All 12 security/safety pitfalls land here as hard gates — none can be deferred without leaving a security or reliability hole.

The build order is locked: **migration 138 → auth-state → session-manager → group-sync → ingest → ipc/whatsapp → ipc wiring (pre-unlock stubs + post-unlock re-register) → provider-accounts cascade → renderer**. The digest cron and briefing section are explicitly Phase 21; the only Phase-20 obligation toward them is exposing `provider_account.status` so Phase 21 can read it.

**Primary recommendation:** Follow ARCHITECTURE.md's build order exactly, BUT apply the three live-source corrections below — they are the difference between a plan that wires cleanly and one that fails at the IPC handler-count test, the ESM build, and the migration-138 column list. Wire every hard gate as a static-grep ratchet or test **before** the first `makeWASocket()` call, per the locked SUMMARY directive.

### Live-source corrections to the locked research (verified 2026-06-09)

These do not change any locked *decision*; they correct three *implementation pointers* in ARCHITECTURE.md / STACK.md that drifted from HEAD.

1. **Post-unlock handler registration happens in `main/index.ts` `bootPoll`, NOT in `ipc/index.ts` `onDbReady`.** [VERIFIED: src/main/ipc/index.ts:123-130 + src/main/index.ts:501-557] ARCHITECTURE.md shows `registerWhatsAppHandlers` + `ipcMain.removeHandler` loop inside the `onDbReady` callback. In live source, `onDbReady` (ipc/index.ts:123) ONLY does `startSyncOrchestrator` — it does not re-register IPC handlers. The canonical post-unlock re-registration template is the **Knowledge Folders** block in `main/index.ts` bootPoll (lines 501-557): a `setInterval` polls `dbHolder.db`, and once unlocked it loops `for (const ch of KNOWLEDGE_FOLDER_CHANNELS) ipcMain.removeHandler(ch)` then calls the real registrar. WhatsApp must follow THIS pattern: pre-unlock stubs in `ipc/index.ts`, real wiring + `removeHandler(WHATSAPP_CHANNELS)` loop in `main/index.ts` bootPoll. The `WhatsAppSessionManager` construction (which needs `db`) also belongs in bootPoll, not `onDbReady`.

2. **The main-process electron-vite config has NO `externalizeDepsPlugin` to add an `exclude` to.** [VERIFIED: electron.vite.config.ts:46-60] STACK.md says "add `@whiskeysockets/baileys` to the `exclude` list in the main-process section." Live source: `main:` has only `define`, `build`, `resolve` — no `plugins` array at all. Only `preload:` has `externalizeDepsPlugin({ exclude: ['zod'] })`. Two valid fixes: (a) add `plugins: [externalizeDepsPlugin({ exclude: ['@whiskeysockets/baileys'] })]` to `main:` (gives Baileys ESM→CJS interop via Rollup AND keeps every other dep external — matches research intent); or (b) add the same plugin scoped only to bundle Baileys. **Recommend (a)** — it is the exact `zod`-in-preload pattern the research cited, just applied to a `main` section that currently has no plugins line. The planner MUST add the `plugins` key; it cannot "edit the exclude list" because the list does not exist yet.

3. **Migration 138 must reproduce the `provider_account` schema from migration 125, NOT migration 011.** [VERIFIED: src/main/db/migrations/125_todoist_tasks.sql:9-23 + grep of all `provider_key IN` CHECKs] ARCHITECTURE.md cites migration 011 as the column source and notes "todoist must also appear." Live source: migration **125** already rebuilt `provider_account` to the 12-column post-Phase-6 schema with CHECK `('google','microsoft','todoist')`. Migration 011's 2-column CHECK is stale. The verbatim column list migration 138 must copy is the **125** DDL (reproduced in the Data Model section below). Migrations 134 and 137 touched the `approval` table, not `provider_account` — 125 is the latest `provider_account` rebuild.

**Also confirmed:** latest migration on disk is `137_approval_cancelled_state.sql` [VERIFIED: ls src/main/db/migrations/]. **Migration 138 is the correct next number.** (Research said "research said 137, confirm" — 137 is the latest *existing*; 138 is correct for the new one.)

---

<user_constraints>
## User Constraints (from 20-CONTEXT.md)

### Locked Decisions (D-01..D-14 — do NOT re-open)

**Group-picker placement & UX**
- **D-01:** Tracked-group management = a **modal** opened from a **"Manage groups" link on the WhatsApp AccountRow** (reuses AccountRow action-button + `DisconnectConfirmDialog` modal pattern). Reachable any time, not only at link (WA-05).
- **D-02:** Group-picker modal includes a **search/filter field** for large lists.
- **D-03:** All groups **untracked by default** (privacy boundary, WA-06). The track toggle is the only thing authorizing ingestion.
- **D-04:** A **newly-joined group** (from `groups.upsert`) surfaces as a **count badge on the "Manage groups" link** and appears **untracked at the top** of the picker. No toast.

**Ban-risk consent gate**
- **D-05:** Pre-QR disclosure = a **single editorial-`Checkbox` acknowledgement** modal (mirrors `MnemonicShow` / `CountrySectorPicker` editorial Checkbox at `src/renderer/components/editorial/Checkbox.tsx`). 3–4 bullet risks; one checkbox enables "Show QR code".
- **D-06:** The **"use a secondary number" recommendation** = an **emphasized callout** within the consent modal (not a buried bullet).
- **D-07:** **QR does not render until the checkbox is acknowledged** (hard gate, SC-1). Consent state gates QR *generation*, not just visibility.

**Connection status & degraded UX**
- **D-08:** **AccountRow status chip is the source of truth.** Map session states to existing chip styling: `needs-relink` → `needs-auth` style (amber `#c98a3a`) + inline Reconnect button; `reconnecting`/dropped → `degraded` style (red `#b34`).
- **D-09:** **No toasts** on connection drop/needs-relink (passive/degradable posture).
- **D-10:** Quiet degraded note in the briefing WhatsApp section = secondary surfacing, **Phase 21**. Phase 20 only exposes status via `provider_account` so Phase 21 can read it.

**Technical gap confirmations**
- **D-11:** `account_id` = **phone JID from `creds.me.id`** after link.
- **D-12:** **QR only** in v2.1. No pairing-code linking.
- **D-13:** Set **`syncFullHistory:false` explicitly** in `makeWASocket` config.
- **D-14:** **30-day retention sweep in the existing `sweep-cron`**, timed to avoid overlap with the 03:00 socket recycle and the 05:00 digest cron. *(See "Open Questions / Conflicts" — the existing sweep-cron currently runs AT 03:00; this needs a timing decision in plan phase.)*

### Claude's Discretion
- Exact bullet wording of the consent-modal risk copy and the one-sentence "no history before link" notice (within the locked structure).
- Internal state-machine naming, table column details beyond migration-138 spec, exact `p-queue` batch-flush interval (~2s).
- Group-picker modal visual layout within the editorial design system.

### Deferred Ideas (OUT OF SCOPE for Phase 20)
- Briefing WhatsApp degraded-note rendering (Phase 21).
- Pairing-code linking (future).
- Per-group / configurable retention window (locked at fixed 30-day rolling).
- Daily digest + per-group summaries (Phase 21).
- Action-item / meeting-proposal / RAG extraction consumers (Phase 22).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support (how Phase 20 satisfies it) |
|----|-------------|-----------------------------------------------|
| **WA-01** | Link WhatsApp by scanning a QR shown in Aria | `WHATSAPP_LINK` IPC starts `makeWASocket`; `connection.update.qr` → `QRCode.toDataURL` → `WHATSAPP_QR_UPDATE` push to renderer QR modal. STACK.md QR rendering pattern. |
| **WA-02** | Explicit ban-risk disclosure (recommends secondary number) acknowledged before QR appears | Consent modal (D-05/D-06) with editorial Checkbox; consent state hard-gates QR *generation* (D-07). |
| **WA-03** | See connection status (linked/needs-relink/disconnected) + re-link on expiry | `provider_account.status` mapped to AccountRow chip (D-08); `WHATSAPP_STATE_CHANGED` push; Reconnect button → `WHATSAPP_LINK`. |
| **WA-04** | Disconnect tears down session + deletes all WhatsApp data | `WHATSAPP_DISCONNECT` → `manager.stop()` + disconnect-cascade transaction in `provider-accounts.ts`; `ON DELETE CASCADE` from `whatsapp_group` covers messages + digests. |
| **WA-05** | See groups + toggle which are tracked, reachable any time | `WHATSAPP_LIST_GROUPS` + `WHATSAPP_SET_TRACKED`; "Manage groups" link on AccountRow opens the picker modal (D-01/D-02). |
| **WA-06** | Store only tracked-group messages; untracked + 1:1 DMs never persisted | Privacy filter in `ingest.ts`: `type!=='notify'` (line 1), `@g.us` (line 2), `is_tracked` DB check (line 3) — before any write OR log. |
| **WA-07** | Stored messages text-only, 30-day rolling retention | `extractText()` returns `null` for media → dropped; retention sweep deletes rows older than 30 days (D-14). |
| **WA-11** | Passive read-only: never sends messages/receipts/presence; static guard blocks any outbound send | `markOnlineOnConnect:false` + `sendPresenceUpdate('unavailable')` + `emitOwnEvents:false`; static-grep ratchet blocks `sendMessage`/`sendReceipt` in session-manager. |
| **WA-12** | Degradable capability — drop/protocol break surfaces as visible degraded status; rest of Aria functional | Socket startup wrapped so failure never blocks boot; `isMailCalendarAccount()` excludes whatsapp from SyncOrchestrator; reconnect classification → `status='degraded'`; briefing/email/calendar/tasks untouched. |

All 9 IDs are Phase-20-owned (REQUIREMENTS.md traceability table). WA-08/09/10 are Phase 21.
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Baileys socket lifecycle, reconnect, passive posture | Main / `WhatsAppSessionManager` | — | One persistent WebSocket; main-process single-writer model; never renderer. |
| Auth state (Signal creds + keys) | Main + SQLCipher DB | — | Must live inside the encrypted envelope, never flat JSON files. |
| Privacy filter (tracked/untracked/DM) | Main / `ingest.ts` | DB (`whatsapp_group.tracked`) | Synchronous `.get()` filter at ingestion boundary; DB is single source of truth. |
| Message persistence (batched) | Main / `p-queue` flush | DB | Buffer in memory, flush via p-queue transaction — never sync `db.run()` in event handler. |
| QR string → data-URL | Main (`qrcode`) | Renderer (display) | Conversion in main; renderer only displays the data-URL + countdown. |
| Consent gate (ack before QR) | Renderer | Main (gates generation) | Editorial Checkbox in renderer; main refuses to start QR flow until ack arrives. |
| Connection status display | Renderer / AccountRow | Main (`provider_account.status`) | Chip reads DTO; main owns the canonical status. |
| Group track/untrack toggle | Renderer / picker modal | Main + DB | UI toggles `whatsapp_group.tracked`; immediately changes filter behavior (no restart). |
| Disconnect cascade | Main / `provider-accounts.ts` | DB (`ON DELETE CASCADE`) | Reuses generic provider disconnect; stops socket + deletes all WA rows. |
| Retention sweep | Main / cron | DB | 30-day rolling delete (D-14). |

## Standard Stack

> Locked in STACK.md (HIGH confidence, npm-verified 2026-06-09). Reproduced here for the planner; not re-researched.

### Core additions (exactly two production packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@whiskeysockets/baileys` | **`6.7.23` exact pin (no caret/tilde)** | WhatsApp Web multi-device WebSocket client | Pure-JS, no native rebuild, MIT. `latest`=`7.0.0-rc13` (RC: auth bugs, LID API churn, WASM dep, p-queue@9 conflict). `6.7.23` = most-patched stable 6.x, ESM. [CITED: STACK.md; VERIFIED: npm registry 2026-06-09] |
| `qrcode` | `1.5.4` | Render Baileys QR string → data-URL for renderer | Pure-JS, 135 kB, zero native deps. [CITED: STACK.md] |
| `@types/qrcode` (dev) | latest | TS types | — |

**Install:**
```bash
pnpm add @whiskeysockets/baileys@6.7.23 qrcode@1.5.4
pnpm add -D @types/qrcode
pnpm install --lockfile-only   # commit pnpm-lock.yaml (supply-chain gate)
```

**Version verification (planner: re-run before locking the plan):**
```bash
npm view @whiskeysockets/baileys@6.7.23 version type   # expect 6.7.23, "module"
npm view qrcode@1.5.4 version
```
[VERIFIED 2026-06-09: baileys present? — grep of package.json returned nothing; NEITHER package is installed yet. Wave 1 must add them.]

**Must NOT add:** `sharp`, `jimp`, `audio-decode`, `link-preview-js` (optional Baileys peers — text-only doesn't need them), `whatsapp-web.js` (~170 MB Chromium), or ANY package named `baileys`/`lotusbail`/`*-baileys-*` (confirmed supply-chain attack vector). [CITED: PITFALLS.md Pitfall 8]

### Pin strategy
`package.json`: `"@whiskeysockets/baileys": "6.7.23"` (no caret). Comment in `session-manager.ts`: "Pinned 6.7.23 (legacy tag). v7 migration blocked on LID API + WASM-asar." CI must run `--frozen-lockfile`.

## Architecture Patterns

### System Architecture Diagram (data flow)
```
Renderer                                  Main process                            SQLCipher DB
────────                                  ────────────                            ────────────
[Consent modal] ──ack──▶ WHATSAPP_LINK ──▶ WhatsAppSessionManager
                                            │ makeWASocket (ONE socket)
[QR modal] ◀──WHATSAPP_QR_UPDATE── qrcode ◀─┤ connection.update.qr
                                            │ connection.update(open) ──▶ provider_account.status='ok'
[AccountRow chip] ◀─WHATSAPP_STATE_CHANGED─┤ connection.update(close)→classify→reconnect|needs-auth|degraded
                                            │
                                  messages.upsert ─▶ ingest.ts
                                    line1: type!=='notify'? drop
                                    line2: !@g.us? drop (DM)
                                    line3: !tracked? drop ──────────▶ (NOTHING written)
                                    text-only? else drop
                                    ▼ buffer in memory
                                    p-queue flush (~2s, 1 txn) ─────▶ whatsapp_message (INSERT OR IGNORE)
                                  groups.upsert ─▶ group-sync.ts ────▶ whatsapp_group (untracked default)
[Group picker] ──WHATSAPP_SET_TRACKED──────▶ UPDATE whatsapp_group.tracked
[Group picker] ◀─WHATSAPP_LIST_GROUPS──────  SELECT whatsapp_group
[Disconnect]  ──WHATSAPP_DISCONNECT────────▶ manager.stop() + cascade txn ─▶ DELETE auth_state, group(→CASCADE msg+digest), provider_account
cron (nightly 03:00-ish): socket recycle (heap mitigation)
cron (30-day): retention sweep ────────────────────────────────────▶ DELETE whatsapp_message WHERE sent_at < now-30d
```

### Recommended file/directory structure
```
src/
├── main/
│   ├── whatsapp/
│   │   ├── auth-state.ts        # NEW  useSQLiteAuthState(db): creds + signal keys, db.transaction() on keys.set()
│   │   ├── session-manager.ts   # NEW  singleton socket, state machine, reconnect classify, passive posture, nightly recycle
│   │   ├── group-sync.ts        # NEW  groups.upsert + group-participants.update → upsert whatsapp_group
│   │   ├── ingest.ts            # NEW  messages.upsert: privacy filter + p-queue batch flush
│   │   └── retention.ts         # NEW (or extend sweep-cron) 30-day sweep
│   ├── ipc/
│   │   ├── whatsapp.ts          # NEW  registrar; exports WHATSAPP_CHANNELS const array
│   │   ├── index.ts             # MOD  pre-unlock stubs for WHATSAPP invoke channels + push channels into pushOnlyChannels
│   │   └── provider-accounts.ts # MOD  'whatsapp' disconnect branch (TWO type sites + cascade txn)
│   ├── index.ts                 # MOD  bootPoll: removeHandler(WHATSAPP_CHANNELS) + construct manager + real registrar
│   └── db/migrations/
│       └── 138_whatsapp.sql     # NEW  4 tables + provider_account CHECK rebuild (legacy_alter_table=ON)
├── shared/
│   ├── ipc-contract.ts          # MOD  7 WHATSAPP_* channel constants + DTOs
│   └── provider.ts              # MOD  ProviderKey += 'whatsapp' (line 1)
└── renderer/
    ├── components/
    │   ├── AccountRow.tsx        # MOD  providerDisplayName 'whatsapp'→'WhatsApp'; "Manage groups" link; wire Reconnect onClick
    │   ├── WhatsAppConsentModal.tsx  # NEW  editorial Checkbox ack (D-05/06/07)
    │   ├── WhatsAppQrModal.tsx       # NEW  QR data-URL + countdown + refresh (Pitfall 12)
    │   └── WhatsAppGroupPickerModal.tsx # NEW  search + per-group toggle (D-01..04)
    └── features/settings/
        └── IntegrationsSection.tsx # MOD  AddAccountModal WhatsApp entry → consent→QR; AccountRow render; disconnect flow
```
[VERIFIED: AccountRow.tsx, IntegrationsSection.tsx, AddAccountModal.tsx, editorial/Checkbox.tsx, sweep-cron.ts, provider.ts, ipc-contract.ts all exist at the cited paths, 2026-06-09]

### Pattern 1: Post-unlock service construction + handler re-registration (CORRECTED location)
**What:** DB-dependent services construct after vault unlock. **Where:** `main/index.ts` `bootPoll` `setInterval` (lines 501-557), NOT `ipc/index.ts onDbReady`. The Knowledge Folders block is the template.
**Apply to WhatsApp:**
```typescript
// main/index.ts bootPoll, once dbHolder.db is truthy (mirror Knowledge Folders):
for (const ch of WHATSAPP_CHANNELS) ipcMain.removeHandler(ch);   // remove pre-unlock stubs
whatsAppManager = createWhatsAppSessionManager({ db: dbHolder.db, scheduler, logger });
whatsAppManager.start();   // no-op if no whatsapp provider_account row exists
registerWhatsAppHandlers(ipcMain, { logger, dbHolder, scheduler, manager: whatsAppManager });
```
[VERIFIED: src/main/index.ts:532-543 KNOWLEDGE_FOLDER_CHANNELS removeHandler loop is the exact precedent]

### Pattern 2: Pre-unlock stubs (so handler-count test passes)
**What:** `ipc/index.ts` registers `db-locked` stub handlers for every invoke channel before unlock; push-only channels get no-op stubs. Template: `knowledgeChannels` block (ipc/index.ts:488-533) for invoke; `pushOnlyChannels` array (ipc/index.ts:666-679) for push.
**WhatsApp:** 5 invoke channels → stub block (mirror knowledgeChannels else-branch); 2 push channels (`WHATSAPP_QR_UPDATE`, `WHATSAPP_STATE_CHANGED`) → append to `pushOnlyChannels`. [VERIFIED: ipc/index.ts:666-679]

### Pattern 3: Privacy filter at ingestion boundary (3 lines, in order, before any write OR log)
```typescript
sock.ev.on('messages.upsert', ({ messages, type }) => {
  if (type !== 'notify') return;                 // LINE 1 — drop history/append batches
  for (const msg of messages) {
    const jid = msg.key.remoteJid ?? '';
    if (!jid.endsWith('@g.us')) continue;         // LINE 2 — drop 1:1 DMs
    if (!isTracked(jid)) continue;                // LINE 3 — drop untracked groups (DB .get(), single source of truth)
    // ...text-only extraction → buffer → p-queue flush (NOT sync db.run here)
  }
});
```
[CITED: ARCHITECTURE.md "Privacy Filter Placement"; PITFALLS.md Pitfalls 9, 11]

### Pattern 4: Reconnect classification (close handler)
Non-recoverable (NO reconnect, → `needs-auth`): 401 `loggedOut`, 403 `forbidden`, 440 `connectionReplaced`, 500 `badSession`. Recoverable (exponential backoff + jitter, cap at 5 → `degraded`): 408 timeout/lost, 515 `restartRequired`. Wire `powerMonitor` suspend/resume (3-5s delay on resume). [CITED: ARCHITECTURE.md DisconnectReason table; PITFALLS.md Pitfall 5]

### Anti-Patterns (locked — do NOT do)
- Routing WhatsApp through SyncOrchestrator / faking `listMessagesDelta`. `isMailCalendarAccount()` already excludes it [VERIFIED: sync-orchestrator.ts:57-61] — no change there.
- `useMultiFileAuthState` in production (flat JSON outside SQLCipher; "do not use in prod").
- Synchronous `db.run()` inside a Baileys event handler (blocks single writer).
- Storing raw Baileys event objects beyond the handler (0.1 MB/msg leak, #2090).
- Any frontier-model import in `src/main/whatsapp/` (third-party PII). Phase 21 owns the digest call, but the ratchet + directory land NOW.
- `fetchLatestWaWebVersion()` on every connect (fingerprinting/incompat). Pin the version.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signal-protocol crypto | Custom encryption | Baileys internal libsignal | Reverse-engineered protocol; rolling your own = guaranteed Bad MAC |
| Auth serialization | `JSON.stringify` on creds | `BufferJSON.replacer/reviver` (exported by Baileys) | Buffers/Uint8Arrays need the custom replacer or creds corrupt [CITED: STACK.md] |
| Signal key caching | Raw store passed to socket | `makeCacheableSignalKeyStore(store, logger)` | LRU over DB reads; always wrap |
| QR rendering | Manual QR matrix | `qrcode.toDataURL(qr, {errorCorrectionLevel:'L'})` | Pure-JS, forward-compatible with RC10 QR format [CITED: STACK.md] |
| Reconnect backoff | `setTimeout` ad hoc | Classified backoff + cap (Pattern 4) | Naive reconnect = ban signal |
| Write batching | `db.run()` per event | In-memory buffer + `p-queue@8` flush txn | Single-writer; UI freeze under message flood |

**Key insight:** In this domain, the custom code is exactly four thin adapters (`useSQLiteAuthState`, the state machine, the privacy filter, the batch flush). Everything cryptographic/protocol-level is Baileys'. The danger is *adding* code (sends, frontier calls), not missing it.

## Runtime State Inventory

> Phase 20 is greenfield within Aria (new tables, new module) but it introduces NEW runtime state that future rename/migration work must know about. Recorded for completeness; no existing state needs migrating.

| Category | Items | Action Required |
|----------|-------|------------------|
| Stored data | NEW: `whatsapp_auth_state` (Signal creds/keys), `whatsapp_group`, `whatsapp_message`, `whatsapp_group_digest` | Created by migration 138. No pre-existing data. |
| Live service config | WhatsApp linked-device slot on the user's phone (server-side) | Created on QR scan; destroyed on disconnect (user must also remove from phone's Linked Devices for full revocation — surface in copy). |
| OS-registered state | New crons: nightly socket recycle (~03:00) + 30-day retention sweep | Register via `scheduler.cronRegistry` (no-bare-cron ratchet). |
| Secrets/env vars | None new. Auth material lives in SQLCipher DB, not env/keychain. | None. |
| Build artifacts | `@whiskeysockets/baileys` + `qrcode` added to node_modules + bundled into `out/main` (Baileys via the new main `externalizeDepsPlugin exclude`) | `pnpm install` + commit lockfile. No native rebuild. |

## Common Pitfalls

> All 12 are in PITFALLS.md (HIGH confidence). Each maps to a hard gate in the Validation Architecture below. The five most load-bearing:

### Pitfall 1: Outbound send in "passive" posture [HARD GATE + STATIC RATCHET]
**Goes wrong:** Baileys emits ACKs/presence by default; any send frame on a flagged account = fastest ban. **Avoid:** `markOnlineOnConnect:false` + `await sock.sendPresenceUpdate('unavailable')` on connect + `emitOwnEvents:false`; static-grep ratchet bans `sendMessage`/`sendReceipt` in `whatsapp/`. **Warning sign:** any send/presence call outside the two suppress calls.

### Pitfall 2: Auth corruption on unclean shutdown
**Goes wrong:** partial `keys.set()` on crash → Bad MAC → forced logout. **Avoid:** every `keys.set()` in one `db.transaction()`; never `useMultiFileAuthState`. **Warning sign:** Bad MAC in logs after restart.

### Pitfall 3: Reconnect loop = ban signal
**Goes wrong:** unconditional reconnect on `close` looks like credential stuffing. **Avoid:** classify (Pattern 4); cap at 5 → degraded; powerMonitor. **Warning sign:** no 401-vs-408 distinction.

### Pitfall 9: Third-party PII to frontier LLM [STATIC RATCHET]
**Goes wrong:** group content sent to cloud; members never consented. **Avoid:** ratchet — no `getFrontierModel`/frontier import in `whatsapp/`; bug-report export deny-lists `whatsapp_*` tables. **Warning sign:** any non-Ollama AI call reachable from WA content.

### Pitfall 8: Supply-chain
**Goes wrong:** malicious fork (`lotusbail`) exfiltrates session tokens. **Avoid:** only `@whiskeysockets/baileys` exact pin; commit lockfile; CI `--frozen-lockfile`. **Warning sign:** any other `baileys`-ish package name.

## Code Examples

### SQLite auth-state (the load-bearing transaction wrapper)
```typescript
// Source: STACK.md (verified against Baileys src/Types/Auth.ts HEAD 2026-06-09)
set(data: SignalDataSet) {
  const tx = db.transaction(() => {                       // ← atomicity gate (Pitfall 2)
    for (const [type, entries] of Object.entries(data)) {
      if (!entries) continue;
      for (const [id, value] of Object.entries(entries)) {
        if (value == null) del.run(type, id);
        else upsert.run(type, id, JSON.stringify(value, BufferJSON.replacer));
      }
    }
  });
  tx();
}
```

### Passive-posture socket config (the WA-11 hard gate)
```typescript
// Source: PITFALLS.md Pitfall 1 + STACK.md makeWASocket wiring
const sock = makeWASocket({
  auth: { creds, keys: makeCacheableSignalKeyStore(makeSQLiteSignalKeyStore(db), logger) },
  logger,
  markOnlineOnConnect: false,   // ← passive
  emitOwnEvents: false,         // ← passive
  syncFullHistory: false,       // ← D-13 explicit, prevent first-link write storm
});
sock.ev.on('connection.update', ({ connection }) => {
  if (connection === 'open') void sock.sendPresenceUpdate('unavailable');  // ← go dark (only allowed presence call)
});
```

### Migration 138 wrapper (the legacy_alter_table gate — schema from migration 125)
```sql
-- Source: src/main/db/migrations/135 (legacy_alter_table pattern) + 125 (verbatim provider_account columns)
PRAGMA foreign_keys=OFF;
PRAGMA legacy_alter_table=ON;          -- ← prevents provider_sync_state FK repoint (migration 135 lesson)
BEGIN;
ALTER TABLE provider_account RENAME TO provider_account_old;
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
  capabilities_json   TEXT NOT NULL,
  PRIMARY KEY (provider_key, account_id)
);
INSERT INTO provider_account SELECT * FROM provider_account_old;
DROP TABLE provider_account_old;
CREATE INDEX IF NOT EXISTS idx_provider_account_status ON provider_account(status);
-- + 4 whatsapp tables (see Data Model)
COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
PRAGMA user_version = 138;
```
**Note:** `capabilities_json` is `NOT NULL` with no default — the WhatsApp `provider_account` row inserted at link time must supply a value (e.g. `'{"messaging":1}'`). [VERIFIED: migration 125 line 21]

### Data Model — 4 new tables (migration 138)
[CITED: ARCHITECTURE.md Data Model; ESM/auth-state column shape per STACK.md — see Conflict #1 below]
```sql
CREATE TABLE whatsapp_auth_state (   -- see Open Questions: ARCHITECTURE.md (key,value) vs STACK.md (key_type,key_id,value)
  key_type   TEXT NOT NULL, key_id TEXT NOT NULL, value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (key_type, key_id)
);
CREATE TABLE whatsapp_group (
  jid TEXT NOT NULL PRIMARY KEY, display_name TEXT NOT NULL, description TEXT,
  tracked INTEGER NOT NULL DEFAULT 0 CHECK (tracked IN (0,1)),
  member_count INTEGER, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_whatsapp_group_tracked ON whatsapp_group(tracked);
CREATE TABLE whatsapp_message (
  id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT NOT NULL, sender_jid TEXT NOT NULL,
  wa_id TEXT NOT NULL, sent_at TEXT NOT NULL, body_text TEXT NOT NULL,
  ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (jid, wa_id),
  FOREIGN KEY (jid) REFERENCES whatsapp_group(jid) ON DELETE CASCADE
);
CREATE INDEX idx_whatsapp_message_jid_sent ON whatsapp_message(jid, sent_at DESC);
CREATE INDEX idx_whatsapp_message_sent ON whatsapp_message(sent_at DESC);
CREATE TABLE whatsapp_group_digest (   -- written by Phase 21; table lands now (zero-schema-add for Ph21)
  id INTEGER PRIMARY KEY AUTOINCREMENT, jid TEXT NOT NULL, date TEXT NOT NULL,
  summary TEXT NOT NULL, decisions TEXT, open_qx TEXT, model_id TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (jid, date),
  FOREIGN KEY (jid) REFERENCES whatsapp_group(jid) ON DELETE CASCADE
);
CREATE INDEX idx_whatsapp_group_digest_date ON whatsapp_group_digest(date DESC);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Baileys sends delivery ACKs by default | v7 removed ACKs (ban mitigation) | v7.0.0 | On 6.7.23 you MUST manually suppress (passive posture); v7's auto-suppress is NOT available |
| `useMultiFileAuthState` in examples | SQLCipher-backed custom adapter | — | Examples are demo-only; prod = `useSQLiteAuthState` |
| QR high error-correction | `errorCorrectionLevel:'L'` | RC10 | Smaller/faster QR; use 'L' on 6.7.23 for forward-compat |

**Deprecated/outdated:** migration 011's `provider_account` 2-column CHECK (superseded by 125); ARCHITECTURE.md's `onDbReady` handler-registration pointer (real location is bootPoll); STACK.md's "edit the main exclude list" (no main plugins line exists yet).

## Project Constraints (from CLAUDE.md)
- TypeScript/Node throughout; Electron 41 (pinned; ABI trap — Baileys is pure-JS so no rebuild). [CITED: CLAUDE.md]
- `better-sqlite3-multiple-ciphers` SQLCipher, synchronous single-writer — correct for the auth-state adapter and the batch flush. Auth material inside the encrypted DB only.
- `p-queue@8` for serializing DB/LLM work — Baileys 6.7.23 does NOT pull p-queue (v7 would pull p-queue@9 — another reason to stay on 6.x).
- `pino@9` logger — Baileys uses pino 9.x too; no conflict; wire to Aria's instance.
- All outbound comms / material changes / sensitive content require explicit user confirmation — WhatsApp is read-only, so the only "outbound" is the QR-link consent itself (gated, D-07).
- GSD workflow enforcement: all edits go through a GSD command. Run `npm run typecheck` after main/preload edits (esbuild skips typecheck). [CITED: MEMORY reference_esbuild_skips_typecheck]

## Validation Architecture

> REQUIRED — drives Nyquist VALIDATION.md (`workflow.nyquist_validation: true` [VERIFIED: .planning/config.json:18]).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2 (unit/integration) + Playwright `_electron` (E2E/smoke) [CITED: CLAUDE.md testing stack] |
| Config | `electron.vite.config.ts` / vitest projects (main/renderer split) |
| Quick run command | `npx vitest run <spec> -t "<name>"` (run ONE spec at a time — parallel-projects race [CITED: MEMORY reference_vitest_parallel_projects_quirk]) |
| Full suite command | `pnpm test` (+ `npm run typecheck` — esbuild skips typecheck) |
| Static ratchet style | Vitest spec that greps source files (precedent: `voice-streaming-no-write.spec.ts`, the Phase-14/16 ratchets) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Concrete assertion / command |
|-----|----------|-----------|------------------------------|
| WA-01 | QR shown, link completes | smoke (E2E) + unit | Unit: `connection.update.qr` → `WHATSAPP_QR_UPDATE` push fires with a data-URL string. Smoke: real link against a staging number, group message received <60s. |
| WA-02 | Consent ack gates QR | unit (renderer) | `WhatsAppConsentModal`: "Show QR" disabled until Checkbox checked; `onShowQr` not callable while unchecked. `npx vitest run whatsapp-consent.spec` |
| WA-03 | Status visible + re-link | unit | AccountRow renders chip `#c98a3a` for `needs-auth`, `#b34` for `degraded`; Reconnect button present + onClick dispatches `WHATSAPP_LINK` when `needs-auth`. |
| WA-04 | Disconnect deletes all WA data | integration | After `WHATSAPP_DISCONNECT`: assert 0 rows in `whatsapp_auth_state`, `whatsapp_group`, `whatsapp_message`, `whatsapp_group_digest`, and the `provider_account` row; assert `manager.stop()` called. |
| WA-05 | Group toggle reachable any time | unit | `WHATSAPP_SET_TRACKED` flips `whatsapp_group.tracked`; `WHATSAPP_LIST_GROUPS` returns rows; picker opens from AccountRow "Manage groups" link. |
| WA-06 | Privacy filter (untracked + DM never stored) | **integration (CRITICAL)** | Feed `messages.upsert` with (a) a 1:1 `@s.whatsapp.net` msg, (b) an untracked-`@g.us` msg, (c) a tracked-`@g.us` msg. Assert ONLY (c) is written; assert (a)/(b) produce ZERO rows AND no log line containing their body. Assert `type:'append'` batch writes nothing. |
| WA-07 | Text-only + 30-day retention | unit | `extractText` returns `null` for image/audio/video/document/sticker (no row). Retention sweep `runNow()` deletes rows with `sent_at < now-30d`, keeps newer. |
| WA-11 | Passive, no outbound [HARD GATE] | **static-grep ratchet** | Spec greps `src/main/whatsapp/**`: assert ZERO matches for `\.sendMessage\(`, `\.sendReceipt\(`, `\.readMessages\(`, `\.sendPresenceUpdate\((?!'unavailable')`. Assert config object contains `markOnlineOnConnect: false`, `emitOwnEvents: false`. |
| WA-12 | Degradable | integration | Briefing/email/calendar/tasks IPC succeed when WhatsApp `status='degraded'` and socket is down. Assert `isMailCalendarAccount({providerKey:'whatsapp'})===false` (no SyncOrchestrator routing). Socket startup throw does not reject app boot. |

### Hard Gates → Validation (the 12)
| # | Hard gate | Type | Concrete assertion |
|---|-----------|------|--------------------|
| 1 | `markOnlineOnConnect:false` + `sendPresenceUpdate('unavailable')` + `emitOwnEvents:false` | unit + static-grep | Config object literal asserts the two flags `false`; the only `sendPresenceUpdate` arg in `whatsapp/` is `'unavailable'`. |
| 2 | No `sendMessage`/`sendReceipt` in session-manager (except suppression) | static-grep ratchet | grep `src/main/whatsapp/**` → 0 matches for send/receipt frames. Build fails on any match. |
| 3 | No frontier LLM import in `src/main/whatsapp/` | static-grep ratchet | grep `whatsapp/**` → 0 matches for `getFrontierModel`, `@ai-sdk/anthropic|openai|google`, frontier router calls. Directory + ratchet land in Phase 20 even though digest is Phase 21. |
| 4 | `db.transaction()` on every `authState.keys.set()` | unit | `set()` partial-failure test: throw mid-loop → assert NO rows persisted (transaction rolled back). |
| 5 | Reconnect classification (401/403/440/500 = no reconnect) | unit | Simulate each code: assert no reconnect scheduled for 401/403/440/500 (→ `needs-auth`); assert backoff scheduled for 408/515; assert cap→`degraded` after 5. |
| 6 | Nightly socket recycle ~03:00 | unit | Cron registered in `scheduler.cronRegistry` with a recycle key; firing it calls `disconnect()` then `start()`; no bare `cron.schedule` (no-bare-cron ratchet). |
| 7 | Batch flush via p-queue (NOT sync per-event `db.run()`) | unit + static-grep | grep `whatsapp/ingest.ts` → 0 `db.*\.run(` inside the `messages.upsert` callback. Unit: N messages in a window → ONE transaction (p-queue add called once per flush). |
| 8 | `type!=='notify'` line-1 of `messages.upsert` | unit | First statement in handler returns on `type!=='notify'`; `type:'append'` payload writes nothing. (Covered by WA-06 integration too.) |
| 9 | `@g.us` filter + `is_tracked` as lines 2-3 (before any write OR log) | integration | (= WA-06.) Additionally assert NO `logger.*` call references untracked/DM body before the filter. |
| 10 | `pnpm-lock.yaml` committed with baileys@6.7.23 exact | CI / file check | Spec/CI: `package.json` baileys == `"6.7.23"` (no `^`/`~`); lockfile resolves `@whiskeysockets/baileys@6.7.23`; CI uses `--frozen-lockfile`. |
| 11 | `externalizeDepsPlugin exclude: ['@whiskeysockets/baileys']` in main | unit (config) | Import `electron.vite.config.ts`; assert `main.plugins` exists and the externalize exclude contains the baileys id. (NEW main plugins key — see Correction #2.) |
| 12 | Migration 138 uses `PRAGMA legacy_alter_table=ON` around the rebuild | integration + file check | Migration file contains `legacy_alter_table=ON`. Integration: after applying 138, inserting into `provider_sync_state` succeeds (no dangling `provider_account_old` FK — the migration-135 failure mode). `PRAGMA user_version` == 138. |
| + | `syncFullHistory:false` explicit (D-13) | unit (config) | Config object literal contains `syncFullHistory: false`. |
| + | IPC double-register safety | unit | After `registerHandlers` (pre-unlock stubs) + bootPoll `removeHandler(WHATSAPP_CHANNELS)` + real register, no `ipcMain.handle` throws; `ipc/index.spec.ts` handler-count == `Object.keys(CHANNELS).length` (update count for +7 channels). [VERIFIED: tests/unit/main/ipc/index.spec.ts:71-81] |

### Sampling Rate
- **Per task commit:** `npx vitest run <the spec touched> ` + `npm run typecheck` (one spec at a time).
- **Per wave merge:** full `pnpm test` + all WhatsApp ratchet specs green.
- **Phase gate:** full suite green + 3 static ratchets (WA-11 send-ban, frontier-import-ban, no-bare-cron) green + handler-count test updated, before `/gsd-verify-work`.

### Wave 0 Gaps (test infra to create before/with implementation)
- [ ] `tests/unit/main/whatsapp/auth-state.spec.ts` — covers gate 4 (transaction atomicity), WA-06 helpers
- [ ] `tests/unit/main/whatsapp/ingest-privacy.spec.ts` — covers WA-06, gates 7/8/9 (the CRITICAL privacy integration)
- [ ] `tests/unit/main/whatsapp/session-reconnect.spec.ts` — covers gate 5 (DisconnectReason classification)
- [ ] `tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts` — covers gates 1/2 (WA-11 static grep)
- [ ] `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` — covers gate 3 (frontier-import ban)
- [ ] `tests/unit/main/db/migration-138.spec.ts` — covers gate 12 (legacy_alter_table + provider_sync_state insert)
- [ ] `tests/unit/main/ipc/index.spec.ts` — UPDATE handler-count for +7 WHATSAPP channels (gate "IPC double-register")
- [ ] `tests/unit/main/electron-vite-config.spec.ts` — covers gate 11 (main externalize exclude) + D-13 config flags
- [ ] `tests/unit/renderer/whatsapp-consent.spec.ts` — covers WA-02 (D-07 QR gating)
- [ ] No new framework install needed (Vitest + Playwright already present).

## Security Domain

> `security_enforcement` not set to `false` → included.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | WhatsApp QR device-link; Signal creds in SQLCipher; never flat files. |
| V3 Session Management | yes | Single-socket guard; 401/440 → re-link; session_generation discipline; disconnect destroys session. |
| V4 Access Control | yes | Privacy filter = the access boundary; tracked-flag DB authorization; DMs never read. |
| V5 Input Validation | yes | `extractText` whitelists message types; Zod DTOs on IPC; `type==='notify'` guard. |
| V6 Cryptography | yes | SQLCipher AES-256 (existing) wraps auth state; Signal protocol via Baileys — NEVER hand-rolled; `BufferJSON` serialization. |
| V8 Data Protection | yes | 30-day retention; bug-report export deny-list for `whatsapp_*`; third-party PII never to frontier (ratchet). |

### Known Threat Patterns for Baileys / Aria
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Personal-number ban (passive fingerprint / send leak) | Denial of Service (to user) | Passive posture + send-ban ratchet + consent + secondary-number recommendation (WA-02/11) |
| Malicious npm fork (lotusbail) | Tampering / Info disclosure | Exact pin + committed lockfile + `--frozen-lockfile` + name allow-list (gate 10) |
| Third-party group PII to cloud | Info disclosure | Frontier-import ratchet (gate 3) + export deny-list |
| Auth-state corruption → impersonation surface | Tampering / Elevation | `db.transaction()` atomicity (gate 4) + SQLCipher envelope |
| Reconnect storm flagged as credential-stuffing | Spoofing (to WhatsApp detection) | Reconnect classification + backoff + cap (gate 5) |
| Two-socket conflict (440) | DoS | Singleton guard `if(this.socket) await disconnect()` + single-instance-lock gate |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 30-day sweep can co-exist in (or beside) the existing `sweep-cron` without colliding with the 03:00 recycle | D-14 / Conflict #2 | Two crons at 03:00 contend; recycle + delete overlap. Mitigated by giving the sweep a distinct time (e.g. 03:30) — decide in plan. |
| A2 | `whatsapp_auth_state` uses the STACK.md `(key_type,key_id,value,updated_at)` shape (4-col) rather than ARCHITECTURE.md's `(key,value)` (2-col) | Data Model / Conflict #1 | Adapter code and migration must agree; picking one resolves it. STACK.md's 4-col is the more-detailed/verified-against-Baileys-types version — recommend it. |
| A3 | `getMessage` retry handler (STACK.md) needs a `proto_bytes`/`wa_msg_id` column to return message protos on retry | STACK.md auth wiring | If retries need proto replay and the column is absent, retries return `undefined` (acceptable for passive read-only; Baileys tolerates `undefined`). Low risk — passive client rarely needs retry. Confirm whether to add the column or return `undefined`. |
| A4 | `capabilities_json` for the WhatsApp row can be a minimal sentinel (e.g. `'{"messaging":1}'`) since WhatsApp doesn't use the mail/calendar capability flags | Migration 138 note | If downstream code assumes `mail`/`calendar` keys exist, a minimal JSON could trip a `json_extract`. Low — the gmail/calendar views filter `provider_key='google'` so whatsapp rows are excluded. |
| A5 | Reconnect backoff timing: ARCHITECTURE.md says 1s/2s/4s/8s/30s; PITFALLS.md says 5s/15s/60s/300s/600s | Pattern 4 | Two locked docs disagree on the curve. The PITFALLS.md (longer) curve is the safer anti-ban choice; recommend it. Plan must pick one explicitly. |

## Open Questions / Conflicts (flagged, not silently resolved)

1. **`whatsapp_auth_state` schema: 2-col vs 4-col.** ARCHITECTURE.md uses `(key TEXT PK, value TEXT)`; STACK.md uses `(key_type, key_id, value, updated_at)` with composite PK. Both work. **Recommendation:** use STACK.md's 4-column shape — it's verified against Baileys' `SignalDataTypeMap` key structure (`type` + `id`) and the migration/adapter code in STACK.md is written for it. The planner must lock ONE in migration 138 and `auth-state.ts` so they agree. (Logged A2.)

2. **D-14 timing collision.** The existing `sweep-cron.ts` (`startTombstoneSweep`) is **knowledge-folder-specific** (`CRON_KEY='knowledge-folder-sweep'`, deletes `knowledge_files`) and runs at **`'0 3 * * *'`** [VERIFIED: src/main/folder-ingestion/sweep-cron.ts:18,64]. D-14 says "put the 30-day WhatsApp sweep in the existing sweep-cron, timed to avoid the 03:00 socket recycle." But that file IS the 03:00 job, and it's single-purpose. **Two clean options:** (a) generalize `sweep-cron.ts` to run multiple retention deletes (add a WhatsApp delete inside `runSweep`, keep 03:00 but ensure the socket recycle runs at a *different* minute, e.g. recycle 03:00 / sweep 03:30); or (b) add a sibling `whatsapp/retention.ts` cron at 03:30 registered via the same `scheduler.cronRegistry`. **Recommendation:** (b) — keeps the knowledge sweep untouched and gives a distinct cron time, satisfying "avoid overlap" literally. Either way, recycle and sweep must NOT share the same minute. (Logged A1.) This is a genuine D-14 wording-vs-reality gap the planner must resolve.

3. **Reconnect backoff curve disagreement** between ARCHITECTURE.md and PITFALLS.md (A5). Recommend PITFALLS.md's longer curve (anti-ban). Plan must pick one.

4. **`provider_account` row creation timing.** D-11 sets `account_id = creds.me.id` JID, available only *after* link completes (`connection:'open'`). Before that the AccountRow has no row to show "needs-auth/QR-pending". **Recommendation:** the `qr-pending` state is in-memory on the manager (per ARCHITECTURE.md state machine — NOT persisted); the renderer shows the QR modal during linking, and the `provider_account` row is inserted on first `connection:'open'` with the JID. Confirm the renderer's "linking" affordance is the QR modal itself, not an AccountRow chip, until the row exists.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@whiskeysockets/baileys` | Socket | ✗ (not installed) | target 6.7.23 | None — Wave 1 `pnpm add` is the first task |
| `qrcode` | QR render | ✗ (not installed) | target 1.5.4 | None — Wave 1 |
| Electron 41 / Node 22 | Runtime | ✓ | 41.x (pinned) | — (Baileys engines: Node ≥20 ✓) |
| SQLCipher (`better-sqlite3-multiple-ciphers`) | Auth state, all tables | ✓ | 11.x | — |
| `p-queue` | Batch flush | ✓ | 8.x | — (do NOT upgrade to 9; v7 baileys would force it) |
| `pino` | Logging | ✓ | 9.x | — |
| A WhatsApp account on a phone | Live smoke test (WA-01) | n/a (user) | — | Unit/integration cover logic; live link is UAT, recommend a secondary number |

**Missing with no fallback:** the two npm packages — installing them IS the first Wave-1 task; no blocker, just sequencing.

## Sources

### Primary (HIGH confidence)
- Locked milestone research: `.planning/research/SUMMARY.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md`, `FEATURES.md` (2026-06-09)
- `20-CONTEXT.md` (D-01..D-14), `REQUIREMENTS.md`, `ROADMAP.md` Phase 20 section
- Live source verified at HEAD 2026-06-09: `src/main/ipc/index.ts` (123-130 onDbReady; 488-533 knowledge stubs; 666-679 pushOnlyChannels), `src/main/index.ts` (501-557 bootPoll + KNOWLEDGE_FOLDER_CHANNELS removeHandler), `src/main/integrations/sync-orchestrator.ts` (57-61 isMailCalendarAccount), `src/main/ipc/provider-accounts.ts` (42,61 providerKey type; 64-80 cascade), `src/main/db/migrations/{125,135,137}*.sql`, `electron.vite.config.ts` (46-60 main has no plugins; 67 preload zod exclude), `src/renderer/components/AccountRow.tsx` (14-20 status, 123-127 providerDisplayName), `src/renderer/components/editorial/Checkbox.tsx`, `src/main/folder-ingestion/sweep-cron.ts` (03:00 knowledge sweep), `tests/unit/main/ipc/index.spec.ts` (71-81 handler-count), `.planning/config.json` (nyquist on)
- MEMORY: reference_electron_ipc_double_register, reference_sqlite_rename_fk_rewrite, reference_esbuild_skips_typecheck, reference_vitest_parallel_projects_quirk, reference_pnpm_lockfile_ci_drift

### Secondary (MEDIUM)
- Baileys GitHub issues #2090 (memory leak), #1869 (ban waves), #2452 (history backfill), v7 migration guide — via locked PITFALLS/STACK sources.

## Metadata
**Confidence breakdown:**
- Standard stack: HIGH — npm-verified in locked STACK.md; re-confirmed neither package installed yet.
- Architecture: HIGH — every integration point re-verified against HEAD; three pointer corrections applied.
- Pitfalls / validation: HIGH — 12 pitfalls map 1:1 to concrete assertions; ratchet precedents exist in-repo.
- Conflicts: surfaced (auth-state schema, D-14 timing, backoff curve), not silently resolved.

**Research date:** 2026-06-09
**Valid until:** 2026-07-09 for Aria integration points (stable); ~2 weeks for the Baileys 6.7.23 pin (WhatsApp protocol churn — re-check the npm `legacy` tag before a long-delayed execution).

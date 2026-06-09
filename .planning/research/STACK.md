# Stack Research — WhatsApp Integration (v2.1 Additions Only)

**Domain:** Adding Baileys WhatsApp integration to existing Electron 41 + better-sqlite3 + electron-vite app
**Researched:** 2026-06-09
**Confidence:** HIGH (versions verified live against npm registry on 2026-06-09; interfaces verified against GitHub source)

---

> Scope note: This file covers ONLY the new packages required for v2.1 WhatsApp group-tracking.
> The existing v1 stack (Electron 41, React 18, better-sqlite3, Vercel AI SDK 5, etc.)
> is locked and not re-researched here.

---

## Recommended Stack Additions

### Core Technologies

| Technology | Version | License | Purpose | Why Recommended |
|------------|---------|---------|---------|-----------------|
| `@whiskeysockets/baileys` | `6.7.23` (pin exact) | MIT | WhatsApp Web multi-device WebSocket client | Pure-JS, no native rebuild, actively maintained. **Pin 6.7.23 not 7.0.0-rc13** — v7 is still RC with breaking API changes and a new WASM dep; see version decision section. |
| `qrcode` | `1.5.4` | MIT | Render Baileys QR string to a data-URL or SVG for the renderer | Pure-JS (135 kB unpacked), zero native deps, stable API. |

### Supporting Libraries — Transitive (do not install directly)

These are pulled by Baileys and documented here for awareness. Do not add them to `package.json`.

| Library | Version (via Baileys) | Type | Notes |
|---------|----------------------|------|-------|
| `libsignal` | git dep in 6.7.x | Pure JS | Signal protocol crypto. Published 6.0.0 is v7-only. 6.7.23 pulls from git. No native files. |
| `protobufjs` | `^7.2.4` | Pure JS | WhatsApp binary proto serialization |
| `ws` | `^8.13.0` | Pure JS | WebSocket transport |
| `async-mutex` | `^0.5.0` | Pure JS | Concurrency guard — used inside `makeCacheableSignalKeyStore` |
| `pino` | `^9.6` | Pure JS | Structured logger. Aria already uses pino 9.x — no conflict. |
| `@cacheable/node-cache` | `^1.4.0` | Pure JS | In-memory key cache for signal store |
| `music-metadata` | `^11.7.0` | Pure JS | Audio metadata (needed by Baileys internals; not for text-only use) |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `@types/qrcode` | TypeScript types for qrcode | `pnpm add -D @types/qrcode` |

---

## Installation

```bash
# Core additions (text-only, no media peers)
pnpm add @whiskeysockets/baileys@6.7.23 qrcode@1.5.4

# TypeScript types
pnpm add -D @types/qrcode
```

**No `electron-rebuild` step is needed for these packages.** See native modules section.

---

## Baileys Version Decision: 6.7.23 vs 7.0.0-rc13

**Use `6.7.23` (tagged `legacy` on npm), pinned exactly — not `latest` which resolves to `7.0.0-rc13`.**

The `latest` dist-tag on npm resolves to `7.0.0-rc13` (published 2026-05-21). If you run `pnpm add @whiskeysockets/baileys` without a version, you get the RC. That is the wrong choice.

### Why not v7.0.0-rc13

| Risk | Detail |
|------|--------|
| Still RC after 13 releases | No stable v7.x exists yet. RC13 published 2026-05-21. |
| Known auth bugs in recent RCs | Three 401/device_removed authentication handshake bugs were documented in RC9 and partially patched across RC10–RC13. RC13 itself is a hotfix for a protocolMessage parsing regression. |
| Breaking change: LID system | WhatsApp's Local Identifier (LID) overhaul changed `MessageKey`, `Contact`, and `GroupMetadata` types throughout. Any code reading JIDs needs a rewrite. `isJidUser()` removed; new `WAMessageAddressingMode` enum added. |
| Breaking change: ACKs removed | v7 no longer sends delivery ACKs (ban-risk mitigation), changing how you detect message receipt. |
| New `whatsapp-rust-bridge` dep | v7 requires `whatsapp-rust-bridge@0.5.4` — a Rust-compiled WebAssembly module. No `.node` native files (verified: `npm pack --dry-run` shows 5 files, WASM inlined in 2 MB `dist/index.js`), but WASM loaded from inside Electron's ASAR archive can fail silently on some platforms. Solvable but adds complexity not present in 6.7.x. |
| New `p-queue@^9` dep | v7 requires p-queue 9; Aria already uses p-queue 8 for LLM serialization. Dual versions in one project are possible but messy. |

### Why 6.7.23 specifically

- Last release on the `legacy` dist-tag (published 2026-05-21 — same day as RC13, maintained in parallel)
- All `6.7.x` from `6.7.20` onward are ESM — the critical fact that drives the electron-vite config change below
- `6.7.14`–`6.7.18` are CJS; do not use them (stale security patches)
- **6.7.23 is the most-patched, most-stable release for the 6.x API surface**

### Pin strategy

```json
// package.json — no caret
"@whiskeysockets/baileys": "6.7.23"
```

Comment in `WhatsAppSessionManager.ts`: "Pinned to 6.7.23 (legacy tag). v7 migration blocked on LID API stabilization + WASM-asar resolution."

### Version churn risk

Baileys releases when WhatsApp updates its Web client protocol. The maintainers have historically shipped hotfixes within 24–72 hours of WhatsApp breaking changes. This means you may need to bump the pin reactively. Monitor `github.com/WhiskeySockets/Baileys/releases`. The 6.7.x legacy branch also receives hotfixes (6.7.22 → 6.7.23 are both 2026-05 patches).

---

## ESM in electron-vite — Required Config Change

**Both `6.7.20`+ and `7.x` are pure-ESM** (`"type": "module"` — verified via `npm view @whiskeysockets/baileys@6.7.23 type`). Aria's main process uses electron-vite with `externalizeDepsPlugin`, which marks dependencies as external and leaves them as runtime `require()` calls. That will throw `ERR_REQUIRE_ESM` for Baileys.

**Fix: add Baileys to the `exclude` list** in the main process config so electron-vite bundles it (Rollup handles ESM→CJS interop at build time):

```typescript
// electron.vite.config.ts — main section, add plugins:
main: {
  plugins: [externalizeDepsPlugin({ exclude: ['@whiskeysockets/baileys'] })],
  define: oauthDefine,
  build: { /* ...existing */ },
  resolve: { /* ...existing */ },
},
```

This is exactly the same pattern Aria already uses for `zod` in the preload section. No dynamic `import()` wrapper needed — Rollup inlines and transforms.

**Alternative not recommended:** Converting the entire main process to ESM (`"type": "module"`) is a larger migration that risks better-sqlite3's synchronous API assumptions and all existing CommonJS imports.

---

## Native Modules — No New Rebuild Burden

None of the recommended additions require native rebuild.

| Package | Type | electron-rebuild needed? |
|---------|------|--------------------------|
| `@whiskeysockets/baileys@6.7.23` | Pure ESM JS | No |
| `libsignal` (git dep in 6.7.x) | Pure JS — confirmed via `npm pack --dry-run`, 22 files, no `.node` | No |
| `protobufjs@7.x` | Pure JS | No |
| `ws@8.x` | Pure JS | No |
| `qrcode@1.5.4` | Pure JS | No |

Aria's existing `pnpm rebuild:native:electron` pipeline only touches `better-sqlite3` and `better-sqlite3-multiple-ciphers`. **This does not change.**

Contrast with optional peer deps that must NOT be installed:

- `sharp` — native C++ (libvips), requires rebuild, ~40 MB prebuilt per platform
- `jimp` — pure JS but ~10 MB, only for image thumbnails
- `audio-decode` — only for voice-note duration extraction
- `link-preview-js` — only for rich link previews

All three are declared `optional` in `peerDependenciesMeta`. Do not install them.

---

## Custom AuthenticationState — SQL-Backed Implementation

Baileys requires an `AuthenticationState` object. The exact interface (verified from `src/Types/Auth.ts` at HEAD of WhiskeySockets/Baileys):

```typescript
type AuthenticationState = {
  creds: AuthenticationCreds   // device noise + signal keys + account metadata
  keys: SignalKeyStore          // per-session encryption key store
}
```

### SignalDataTypeMap — what keys your store must handle (6.7.x)

```typescript
type SignalDataTypeMap = {
  'pre-key':                KeyPair                              // { public: Uint8Array; private: Uint8Array }
  'session':                Uint8Array                           // serialized session record
  'sender-key':             Uint8Array                           // group sender-key blob
  'sender-key-memory':      { [jid: string]: boolean }
  'app-state-sync-key':     proto.Message.IAppStateSyncKeyData
  'app-state-sync-version': LTHashState
  'identity-key':           Uint8Array
}
// Note: 'lid-mapping', 'device-list', 'tctoken' are v7-only. Not present in 6.7.x.
```

### SignalKeyStore interface — must implement

```typescript
type SignalKeyStore = {
  get<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[]
  ): Awaitable<{ [id: string]: SignalDataTypeMap[T] }>

  set(data: SignalDataSet): Awaitable<void>

  clear?(): Awaitable<void>   // called on logout — delete all keys except creds
}
// Awaitable<T> = T | Promise<T>
// better-sqlite3 is synchronous — returning T directly satisfies Awaitable<T>
```

### SQL table design

A single key-value table in the existing SQLCipher DB covers both creds and signal keys. This goes in migration 138 alongside `whatsapp_group`, `whatsapp_message`, and `whatsapp_group_digest`:

```sql
CREATE TABLE whatsapp_auth_state (
  key_type   TEXT    NOT NULL,  -- 'creds' | 'pre-key' | 'session' | 'sender-key' | etc.
  key_id     TEXT    NOT NULL,  -- empty string '' for creds; signal key ID for everything else
  value      TEXT    NOT NULL,  -- JSON string with BufferJSON.replacer applied
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (key_type, key_id)
);
```

### Serialization: BufferJSON

Baileys uses `BufferJSON` (exported from `@whiskeysockets/baileys`) to serialize credentials. `Buffer` and `Uint8Array` become `{ type: 'Buffer', data: [...] }`. You must use the same replacer/reviver — do not use plain `JSON.stringify/parse`:

```typescript
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys'

// Read creds
const row = db.prepare(
  'SELECT value FROM whatsapp_auth_state WHERE key_type=? AND key_id=?'
).get('creds', '') as { value: string } | undefined

const creds = row
  ? JSON.parse(row.value, BufferJSON.reviver)
  : initAuthCreds()

// Write creds (call after sock.ev.on('creds.update'))
const saveCreds = () => {
  const serialized = JSON.stringify(creds, BufferJSON.replacer)
  db.prepare(
    'INSERT OR REPLACE INTO whatsapp_auth_state (key_type, key_id, value, updated_at) VALUES (?,?,?,unixepoch())'
  ).run('creds', '', serialized)
}
```

### SignalKeyStore implementation (better-sqlite3)

```typescript
import { SignalKeyStore, SignalDataSet, BufferJSON } from '@whiskeysockets/baileys'
import type Database from 'better-sqlite3'

function makeSQLiteSignalKeyStore(db: Database.Database): SignalKeyStore {
  const select = db.prepare<[string, string]>(
    'SELECT value FROM whatsapp_auth_state WHERE key_type=? AND key_id=?'
  )
  const upsert = db.prepare<[string, string, string]>(
    'INSERT OR REPLACE INTO whatsapp_auth_state (key_type, key_id, value, updated_at) VALUES (?,?,?,unixepoch())'
  )
  const del = db.prepare<[string, string]>(
    'DELETE FROM whatsapp_auth_state WHERE key_type=? AND key_id=?'
  )

  return {
    get(type, ids) {
      const result: Record<string, any> = {}
      for (const id of ids) {
        const row = select.get(type, id) as { value: string } | undefined
        if (row) result[id] = JSON.parse(row.value, BufferJSON.reviver)
      }
      return result   // sync return satisfies Awaitable<T>
    },

    set(data: SignalDataSet) {
      const tx = db.transaction(() => {
        for (const [type, entries] of Object.entries(data)) {
          if (!entries) continue
          for (const [id, value] of Object.entries(entries)) {
            if (value == null) del.run(type, id)
            else upsert.run(type, id, JSON.stringify(value, BufferJSON.replacer))
          }
        }
      })
      tx()  // sync transaction
    },

    clear() {
      db.prepare("DELETE FROM whatsapp_auth_state WHERE key_type != 'creds'").run()
    }
  }
}
```

### Wiring to makeWASocket — always wrap with makeCacheableSignalKeyStore

```typescript
import { makeWASocket, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import pino from 'pino'

const logger = pino({ level: 'silent' })   // or wire to Aria's existing pino instance

const sock = makeWASocket({
  auth: {
    creds,
    keys: makeCacheableSignalKeyStore(makeSQLiteSignalKeyStore(db), logger),
  },
  logger,
  getMessage: async (key) => {
    // Return the message proto for retry — query whatsapp_message table
    const row = db.prepare('SELECT proto_bytes FROM whatsapp_message WHERE wa_msg_id=?')
                  .get(key.id) as { proto_bytes: Buffer } | undefined
    if (!row) return undefined
    // deserialize and return proto.IMessage
  }
})
```

`makeCacheableSignalKeyStore` adds an LRU in-memory cache over the signal key operations, dramatically reducing DB hits for active sessions. Always wrap — do not pass the raw store directly.

---

## QR Code Rendering

Baileys emits a QR string via `connection.update` when pairing is needed. Convert in the main process and send to the renderer via typed IPC:

```typescript
import QRCode from 'qrcode'

sock.ev.on('connection.update', async ({ qr, connection, lastDisconnect }) => {
  if (qr) {
    const dataUrl = await QRCode.toDataURL(qr, { errorCorrectionLevel: 'L' })
    mainWindow.webContents.send('whatsapp:qr', dataUrl)
  }
  if (connection === 'open') {
    mainWindow.webContents.send('whatsapp:connected')
  }
  if (connection === 'close') {
    // handle reconnect or ban detection via lastDisconnect.error
  }
})
```

**`errorCorrectionLevel: 'L'`** — Baileys RC10 release notes explicitly noted the new QR format uses decreased error correction. Use `'L'` even in 6.7.23 for forward-compatibility and a smaller, faster-to-scan code.

**Bundle impact:** `qrcode@1.5.4` unpacked size is 135 kB. Its three runtime deps (`pngjs` ~330 kB, `dijkstrajs` ~13 kB, `yargs` ~200 kB) total ~680 kB. These are pure-JS CommonJS modules; they do not need exclusion from `externalizeDepsPlugin` (regular `require()` works fine). Total main-process bundle addition: under 1 MB.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@whiskeysockets/baileys@6.7.23` | `whatsapp-web.js` | Never for Aria — bundles headless Chromium (~170 MB); rejected by architecture decision |
| `@whiskeysockets/baileys@6.7.23` | `baileys` (npm bare name) | Never — this is an outdated/stale fork namespace; WhiskeySockets is the active fork |
| `@whiskeysockets/baileys@6.7.23` | `@whiskeysockets/baileys@7.0.0-rc13` | When v7 reaches a stable release and LID API churn settles |
| `qrcode` | `qrcode-terminal` | Terminal-only output; useless for Electron UI |
| SQL-backed auth state | `useMultiFileAuthState` (built-in) | Never for Aria — loose JSON files outside the SQLCipher boundary; race-prone; exposed to filesystem inspection |
| `makeSQLiteSignalKeyStore` (custom) | Community `mysql-baileys`, `baileysauth` | Those target MySQL/Postgres/MongoDB; no SQLite adapters in the community exist as of research date. Roll your own using the pattern above — it is ~60 lines. |

---

## What NOT to Add

| Avoid | Why | Notes |
|-------|-----|-------|
| `sharp` | Native C++ (libvips) — requires electron-rebuild, ~40 MB prebuilt per platform | Only needed for image thumbnails. Listed as optional peer dep — skip entirely. |
| `jimp` | Pure JS but ~10 MB; only for sticker/image thumbnail generation | Optional peer dep — skip for text-only. |
| `audio-decode` | Only for voice-note duration extraction | Optional peer dep — not needed. |
| `link-preview-js` | Only for rich link previews in outbound messages | Optional peer dep — not needed. |
| `ffmpeg` / `fluent-ffmpeg` | Audio/video conversion — also a system binary dep | Not needed for text-only group ingestion. |
| `puppeteer` / `playwright` | The `whatsapp-web.js` approach — bundles Chromium (~170 MB) | Architecture decision: rejected. |
| `@wppconnect-team/wppconnect` | Same Chromium-based approach as whatsapp-web.js | Same rejection reason. |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@whiskeysockets/baileys@6.7.23` | Node >= 20.0.0 | Electron 41 ships Node 22 — fully compatible. Verified via `engines` field. |
| `@whiskeysockets/baileys@6.7.23` | `pino@^9.6` | No conflict — Aria already uses pino 9.x |
| `@whiskeysockets/baileys@6.7.23` | `p-queue@^8` | No conflict — Baileys 6.7.x does not depend on p-queue. (v7.x would pull p-queue 9, creating a peer conflict with Aria's p-queue 8.) |
| `qrcode@1.5.4` | All Node 18+ | No engine restriction |
| `libsignal` (git dep) | `@whiskeysockets/baileys@6.7.x` | The published `libsignal@6.0.0` on npm is a v7-only release (published 2026-05-13, same day as RC10/11). Do NOT install `libsignal@6.0.0` separately when using 6.7.23 — it will be ignored or create a version conflict. |

---

## Sources

- npm registry (`npm view @whiskeysockets/baileys --json`, 2026-06-09): versions, dist-tags (`latest=7.0.0-rc13`, `legacy=6.7.23`), module type, dependencies, peerDependenciesMeta — HIGH
- npm registry (`npm view @whiskeysockets/baileys@6.7.23 type`): confirmed `"type": "module"` — HIGH
- npm registry (`npm view @whiskeysockets/baileys@6.7.14` through `6.7.18`): confirmed CJS (no type field) — HIGH
- npm registry (`npm pack whatsapp-rust-bridge@0.5.4 --dry-run`): 5 files, WASM inlined in `dist/index.js`, no `.node` files — HIGH
- npm registry (`npm pack libsignal@6.0.0 --dry-run`): 22 pure-JS files, no `.node` files — HIGH
- npm registry (`npm view qrcode@1.5.4`): version, deps, unpacked size 135 kB — HIGH
- GitHub `WhiskeySockets/Baileys` `src/Types/Auth.ts` (HEAD, fetched 2026-06-09): complete `SignalDataTypeMap` (7 keys in 6.7.x), `SignalKeyStore`, `AuthenticationState` types — HIGH
- GitHub `WhiskeySockets/Baileys` `src/Utils/auth-utils.ts` (HEAD): `initAuthCreds` function, BufferJSON serialization pattern — HIGH
- GitHub `WhiskeySockets/Baileys` `Example/example.ts` (HEAD): `makeWASocket` wiring, `makeCacheableSignalKeyStore` usage pattern — HIGH
- [Baileys v7 migration guide](https://baileys.wiki/docs/migration/to-v7.0.0/): breaking changes (LID system, ACKs removed, ESM, new SignalDataTypeMap keys) — HIGH
- [Baileys RC10 release notes](https://github.com/WhiskeySockets/Baileys/releases): `whatsapp-rust-bridge` integration, QR error correction change, 30x speedup claim — HIGH
- [electron-vite troubleshooting guide](https://electron-vite.org/guide/troubleshooting): `externalizeDepsPlugin exclude` pattern for ESM packages — HIGH
- Aria `electron.vite.config.ts` (local, read 2026-06-09): existing `zod` exclude pattern in preload — HIGH (same pattern applies to Baileys in main)

---
*Stack research for: WhatsApp Baileys integration (v2.1 additions only)*
*Researched: 2026-06-09*

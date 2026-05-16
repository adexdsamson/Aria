# Phase 1: Foundation - Research

**Researched:** 2026-05-16
**Domain:** Electron 33+ desktop app foundation: scaffold, encrypted SQLite, OS-keychain secrets, LLM router skeleton, hello-briefing stub
**Confidence:** HIGH on scaffold + safeStorage + AI SDK shape; MEDIUM-HIGH on encryption layer; MEDIUM on sqlite-vec×SQLCipher Windows interop (a known compatibility gotcha must be designed around)

## Summary

Phase 1 is a Walking Skeleton: scaffold electron-vite, encrypt the SQLite DB with SQLCipher, store the frontier API key in OS keychain via `safeStorage`, detect Ollama on `localhost:11434`, and prove the whole stack with a hello-briefing round-trip that writes one row, routes through a hard-rules sensitivity classifier, calls either Anthropic or Ollama via Vercel AI SDK, and surfaces the answer + routing decision in Settings → Diagnostics.

The stack is locked by CLAUDE.md and CONTEXT.md. Research focused on **how** to integrate it, not whether. Key live-fire findings:

1. **Versions have moved.** Electron is at **42.x** (npm registry, 2026-05-16) [VERIFIED]; AI SDK is at **6.0.184** [VERIFIED]; `@ai-sdk/anthropic` is **3.0.78** [VERIFIED]. CLAUDE.md's "Electron 33 / AI SDK 5" targets are stale by about a year. Recommend tracking Electron 42 + AI SDK 6 + zod 4 — the original `ollama-ai-provider` (sgomez) is abandoned at 1.2.0 (Jan 2025) and requires zod 3 only; the working replacement is **`ollama-ai-provider-v2`** (nordwestt) at **3.5.1** [VERIFIED] with peer `ai: ^5.0.0 || ^6.0.0` and `zod: ^4.0.16`.
2. **sqlite-vec on Windows has a known load-extension breakage** with newer `better-sqlite3-*` builds (the Windows DLL was compiled against pre-3.45 SQLite; `loadExtension()` succeeds silently but `SELECT vec_version()` returns "no such function") [CITED: github.com/openclaw/openclaw#65704 via WebSearch]. Phase 1 does **not** need vector search (RAG is Phase 7). Recommendation: scaffold the DB layer cleanly but **defer wiring sqlite-vec into the DB to Phase 7**, and do a compatibility spike before then. This research treats sqlite-vec as out-of-scope for Phase 1 plans.
3. **safeStorage is the right secrets primitive on Windows** (uses DPAPI, key-per-app, only the same Windows user can decrypt). `isEncryptionAvailable()` only returns true after `app.whenReady()` [CITED: electronjs.org/docs/latest/api/safe-storage]. The standard pattern is to encrypt then base64-encode and persist into `userData/secrets.json`.
4. **The DB encryption key must NOT come from `safeStorage`.** Per CONTEXT D-04, a backup file is portable across machines, and `safeStorage` cipher is bound to the current user/machine. The DB key is derived deterministically from the **BIP39 mnemonic** (D-01) and held in main-process memory only.

**Primary recommendation:** Four plans, single-window app, Windows-first, dogfood loop in Settings → Diagnostics. Build the router and DB layer as the two long-lived contracts every later phase plugs into; everything else in Phase 1 is the minimum wiring to prove they work end-to-end.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Recovery Passphrase & Onboarding**
- **D-01:** Hybrid passphrase model. A system-generated 12-word BIP39 mnemonic is the canonical recovery key (used to derive the SQLCipher master key). The user also sets a shorter daily-unlock password that decrypts a local vault containing the mnemonic / derived key material.
- **D-02:** Daily-unlock password is prompted **at launch only**. Aria stays unlocked for the duration of the session; no re-prompt after OS lock/sleep. The OS lock screen is treated as the security boundary while running.
- **D-03:** Mnemonic confirmation during onboarding: re-enter 3 words from random positions (e.g., #4, #7, #11). Not full re-entry, not a simple checkbox.
- **D-04:** Backup/restore scope: encrypted `.ariabackup` file portable across machines. Mnemonic alone is sufficient to decrypt on a new machine. **OAuth tokens and frontier API keys are NOT included in the backup** — they live in OS keychain and the user re-authenticates on restore.

**LLM Router & Sensitivity Classifier (v1, hard-rules)**
- **D-05:** Routing rule = **source-based default + pattern overrides**. Default route is determined by the prompt's `source` tag (user-data-derived content → LOCAL; generic prompts → FRONTIER). A pattern/regex layer can force LOCAL on a generic prompt that still looks PII-shaped (emails, phone numbers, $$ amounts, SSN-like, contact names).
- **D-06:** Every LLM call must pass through the router and be tagged with a `source` (e.g., `user-email`, `user-calendar`, `user-transcript`, `generic`). The router writes a routing-decision row for every call to a SQLCipher table: timestamp, route (LOCAL/FRONTIER), reason, source tag, prompt hash.
- **D-07:** Routing-log UI in Phase 1 is **minimal**: a read-only "last N entries" list inside Settings → Diagnostics. Full filtering/search panel deferred to Phase 3 with the sensitivity-router upgrade.
- **D-08:** Fail-closed semantics (LLM-04) are non-negotiable: if `source` is unset or classifier is uncertain → route LOCAL.
- **D-09:** Frontier providers wired in Phase 1: **Anthropic + OpenAI + Google**, one active at a time. Settings UI lets the user pick the active provider and enter that provider's key. All three use AI SDK adapters.
- **D-10:** No-key behavior: onboarding asks once for a frontier API key. If skipped, app enters **LOCAL-only mode** — all routing forces LOCAL, and a non-blocking banner reads "Frontier disabled — add an API key in Settings." Hello-briefing stub must work LOCAL-only against Ollama.

**App Shell & Hello-Briefing Stub**
- **D-11:** App shape = **single main window with left side nav**. Sections present in Phase 1: Briefing, Approvals (placeholder), Routing Log (under Settings > Diagnostics in Phase 1), Settings. No tray app, no global hotkey in v1.
- **D-12:** Briefing surface in Phase 1 is intentionally bare — a plain "Aria is alive" / status screen. The end-to-end LLM round-trip lives in **Settings → Diagnostics** as an input box + "Ask Aria" that returns the model's reply and the routing decision (route + reason). This is the dogfood loop until Phase 2 fills the briefing.
- **D-13:** Visual direction = **shadcn/ui + Tailwind + a thin custom theme**. Define a small token set up front: neutral palette, one accent color, defined type scale, radii, spacing. System light/dark. No full design-system work; just enough so later phases don't drift.
- **D-14:** Platform priority = **Windows-first** (the dev's machine). macOS path verified at Phase 8 release prep. Linux not in v1. Dev build must run cleanly on Windows 11; native deps (better-sqlite3-multiple-ciphers, sqlite-vec) must build there.

**Cross-Cutting**
- **D-15:** Google CASA security review must be kicked off during Phase 1 (multi-week lead time for `gmail.send` used in Phase 3). Treat as a parallel non-engineering task tracked in this phase's plan.
- **D-16:** Data directory lives under Electron `app.getPath('userData')`. Document the exact path used. PII redaction is applied at the log sink (pino) from day 1.

### Claude's Discretion
- Migration framework choice (e.g., umzug-style vs hand-rolled SQL files) — pick what fits better-sqlite3 best.
- Specific shadcn components scaffolded vs added lazily.
- p-queue concurrency defaults for the router; node-cron schedule for the (eventually-Phase-2) daily-briefing job — scaffold the hooks, leave the cadence open.
- PII redaction allowlist/regex shape at the pino sink — sensible default, revisit when real logs exist.
- Whether the routing log "last N" is 50 or 100 entries.

### Deferred Ideas (OUT OF SCOPE)
- Tray app + global hotkey
- Re-prompt for unlock after OS lock/sleep
- Full routing-log UI (filtering, search, export) — folded into Phase 3
- Mock briefing with placeholder rows — Phase 2 will populate for real
- macOS / Linux dev builds in CI — Phase 8
- OAuth tokens / API keys included in encrypted backup — posture change, defer
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Install/launch as a (eventually-signed) desktop app | Electron 42 + electron-builder 26 packaging plan (Plan 1; full signing in Phase 8) |
| FOUND-02 | First-launch onboarding: identity + recovery passphrase + confirmation | BIP39 mnemonic via `@scure/bip39`, 3-word confirmation per D-03 (Plan 2) |
| FOUND-03 | All user data encrypted in SQLite (SQLCipher whole-DB) | `better-sqlite3-multiple-ciphers` + `PRAGMA key`; key derived from BIP39 (Plan 2) |
| FOUND-04 | Encrypted backup export + restore on same machine | `VACUUM INTO 'file.db' KEY 'newKey'` or file-copy approach (Plan 2) |
| FOUND-05 | Frontier API key stored in OS keychain | Electron `safeStorage` → `userData/secrets.json` (Plan 3) |
| FOUND-06 | Ollama detect + route accordingly | `GET http://127.0.0.1:11434/api/tags` probe; UI status surface (Plan 3) |
| FOUND-07 | Operational status at a glance | Settings → Diagnostics panel: API-key present, Ollama up, last route (Plan 3 + Plan 4) |
| LLM-01 | Route PII / sensitive content LOCAL only | Hard-rules regex layer + source-based default (Plan 4) |
| LLM-03 | Log every routing decision with reason; user-inspectable | `routing_decisions` SQLCipher table + minimal "last N" UI (Plan 4) |
| LLM-04 | Fail closed — uncertain → LOCAL | Default-deny in router code path (Plan 4) |
| LLM-05 | Degrade gracefully when frontier unreachable / missing key | LOCAL-only mode + banner (Plan 3 + Plan 4) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App lifecycle, window, IPC routing | Electron Main | — | Single trust authority |
| SQLCipher DB read/write (incl. routing log) | Electron Main | — | better-sqlite3 is sync; single-writer; must hold DB key in memory |
| safeStorage encrypt/decrypt of API keys | Electron Main | — | API only available in main; never expose `safeStorage` to renderer |
| Ollama HTTP probe + LLM calls | Electron Main | — | Localhost outbound; keep secrets-bearing code paths out of renderer |
| Sensitivity classifier (hard rules) | Electron Main | — | Decision must be unforgeable from renderer |
| Vercel AI SDK provider config (Anthropic/OpenAI/Google/Ollama) | Electron Main | — | API keys only readable in main |
| BIP39 generation + mnemonic confirmation | Electron Main (gen) | Renderer (display/UX) | Generate in main; render in renderer; never send raw key over IPC after unlock |
| Onboarding UI, Settings UI, Diagnostics UI, side nav | Renderer (React) | — | Pure presentation; talks to main via narrow IPC |
| Logging (pino, PII redaction at sink) | Electron Main | — | Single sink avoids drift; renderer logs forward via IPC if needed |
| Background scheduling (node-cron, powerMonitor) | Electron Main | — | Scaffold only in Phase 1 |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron | 42.1.0 [VERIFIED: npm 2026-05-16] | Desktop shell | Per CLAUDE.md; current LTS-cadence release; v33 is one year stale |
| electron-vite | 5.0.0 [VERIFIED: npm 2026-04-12] | Build orchestrator (main + preload + renderer) | Per CLAUDE.md; v5 supports Vite 5/6 and Electron 30+ [CITED: electron-vite.org] |
| @electron-toolkit/preload | latest [ASSUMED current] | Safe preload helpers (electronAPI exposure) | Pattern recommended by electron-vite [CITED: electron-vite.org/guide/dev] |
| @electron/rebuild | 4.0.4 [VERIFIED: npm 2026-04-21] | Rebuild native modules against Electron ABI | Required for `better-sqlite3-multiple-ciphers` on Windows |
| react / react-dom | 18.3.x [ASSUMED — confirm at install] | UI | Per CLAUDE.md |
| vite | 5.x [ASSUMED — confirm at install] | Renderer bundler | Per CLAUDE.md |
| typescript | 5.6.x [ASSUMED — confirm at install] | Type system | Per CLAUDE.md |
| tailwindcss | 3.4.x [ASSUMED — confirm at install] | Styling | Per CLAUDE.md (do NOT jump to Tailwind 4 mid-phase) |
| shadcn/ui | latest CLI [ASSUMED] | Component primitives | Per CLAUDE.md |
| better-sqlite3-multiple-ciphers | 12.9.0 [VERIFIED: npm 2026-04-14] | SQLCipher-capable SQLite for Node | Per CLAUDE.md; m4heshd fork has Electron prebuilds |
| ai | 6.0.184 [VERIFIED: npm 2026-05-16] | Vercel AI SDK (generateText / generateObject) | Per CLAUDE.md (note: CLAUDE.md says v5; v6 is current; v6 requires zod ^3.25 ‖ ^4) |
| @ai-sdk/anthropic | 3.0.78 [VERIFIED: npm 2026-05-15] | Anthropic provider | Per CONTEXT D-09 |
| @ai-sdk/openai | 3.0.64 [VERIFIED: npm 2026-05-15] | OpenAI provider | Per CONTEXT D-09 |
| @ai-sdk/google | 3.0.75 [VERIFIED: npm 2026-05-16] | Google provider | Per CONTEXT D-09 |
| ollama-ai-provider-v2 | 3.5.1 [VERIFIED: npm 2026-05-13] | Ollama provider for AI SDK 5/6 | Original `ollama-ai-provider` is abandoned at 1.2.0 (zod 3 only) [CITED: github.com/vercel/ai#6924 via WebSearch] |
| zod | 4.4.3 [VERIFIED: npm 2026-05-04] | Schema validation; required by AI SDK 6 and ollama-ai-provider-v2 | Locked by upstream peer-dep ranges |
| @scure/bip39 | 2.2.0 [VERIFIED: npm 2026-04-21] | BIP39 mnemonic generation/validation | Audited, dep-light, modern alternative to bitcoinjs-lib/bip39 |
| pino | 10.3.1 [VERIFIED: npm 2026-02-09] | Structured logging | Per CLAUDE.md |
| pino-roll | 4.0.0 [VERIFIED: npm 2025-10-06] | Rotating file transport | Standard pino partner |
| node-cron | 4.2.1 [VERIFIED: npm 2026-04-24] | Cron scheduling (scaffold-only in Phase 1) | Per CLAUDE.md (note: v4, not v3) |
| p-queue | 9.2.0 [VERIFIED: npm 2026-04-27] | Concurrency queue for LLM calls (scaffold) | Per CLAUDE.md (note: v9, not v8) |
| electron-builder | 26.8.1 [VERIFIED: npm 2026-05-11] | Packaging (full signing config deferred to Phase 8) | Per CLAUDE.md |

### Deferred to later phases
| Library | Phase | Reason |
|---------|-------|--------|
| sqlite-vec | Phase 7 (RAG) | Known Windows × better-sqlite3 12.x load-extension bug; not needed in Phase 1; spike before Phase 7 |
| @sentry/electron | Phase 8 | Opt-in crash telemetry; release-prep concern |
| googleapis / msal-node / etc. | Phase 2+ | Integration adapters |
| vitest / playwright | Phase 1 (smoke only) | Vitest 4.1.6 + Playwright 1.60.0 verified; cover routing classifier + hello-loop only |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ollama-ai-provider-v2` | `ai-sdk-ollama` (jagreehal) v3.x | Built on official `ollama` package; also AI SDK 6 compatible. v2-provider has more streaming/tool/reasoning support today; ai-sdk-ollama is cleaner abstraction. Pick v2 for Phase 1 speed; revisit if reasoning support matters in Phase 3+. |
| `better-sqlite3-multiple-ciphers` | SQLCipher community + node-sqlite3 | Single-writer sync API of better-sqlite3 fits Electron main; node-sqlite3 async + worker overhead unnecessary |
| Hand-rolled migrations | umzug, knex migrate | Hand-rolled numbered `.sql` files driven by `PRAGMA user_version` is the smallest viable thing for solo dev; D-cretion allows either |
| `@scure/bip39` | `bip39` (bitcoinjs) | Both work. `@scure/*` is more modern, audited, fewer deps; pick it. |

**Installation (Phase 1 root deps):**
```bash
npm install electron@^42 electron-vite@^5 react@^18 react-dom@^18 \
  better-sqlite3-multiple-ciphers@^12 \
  ai@^6 @ai-sdk/anthropic@^3 @ai-sdk/openai@^3 @ai-sdk/google@^3 \
  ollama-ai-provider-v2@^3 zod@^4 \
  @scure/bip39@^2 \
  pino@^10 pino-roll@^4 \
  node-cron@^4 p-queue@^9 \
  @electron-toolkit/preload
npm install -D typescript@^5 vite@^5 tailwindcss@^3 \
  @electron/rebuild@^4 electron-builder@^26 \
  vitest@^4 playwright@^1.60
```

**Version verification note:** Every `[VERIFIED: npm <date>]` came from `npm view <pkg> version` + `time.modified` on 2026-05-16. Planner should re-run that probe at plan-time if more than 7 days have passed.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── Aria Desktop App (Electron) ───────────────────────────┐
│                                                                                    │
│  ┌───────────────────────┐    contextBridge / IPC     ┌──────────────────────┐    │
│  │     Renderer (React)  │ ──ipcRenderer.invoke──▶    │   Preload (sandbox)   │    │
│  │  • Onboarding wizard  │                            │  exposes electronAPI  │    │
│  │  • Side nav           │                            │  (one method per IPC) │    │
│  │  • Briefing screen    │ ◀──invoke result───────    └──────────┬───────────┘    │
│  │  • Settings →         │                                       │ ipcMain.handle │
│  │    Diagnostics        │                                       ▼                │
│  │     ("Ask Aria" box)  │                            ┌─────────────────────┐     │
│  └───────────────────────┘                            │   Main Process      │     │
│                                                       │                     │     │
│                                          ┌─ vault ◀───┤ • App lifecycle     │     │
│                                          ▼            │ • IPC handlers      │     │
│                              ┌──────────────────┐     │ • Vault (BIP39 →    │     │
│                              │ DB Layer         │◀────┤   SQLCipher key)    │     │
│                              │ better-sqlite3-  │     │ • Secrets layer     │     │
│                              │ multiple-ciphers │     │   (safeStorage)     │     │
│                              │ + PRAGMA key     │     │ • LLM Router        │─┐   │
│                              │                  │     │ • Hard-rules        │ │   │
│                              │ Tables:          │     │   classifier        │ │   │
│                              │ • app_meta       │     │ • Pino logger       │ │   │
│                              │ • routing_log    │◀────┤ • Ollama probe      │ │   │
│                              │ • settings       │     │ • node-cron (idle)  │ │   │
│                              └──────────────────┘     │ • powerMonitor      │ │   │
│                                       ▲               └─────────┬───────────┘ │   │
│                                       │                         │             │   │
│                                       │ writes routing_log row  │             │   │
│                                       └─────────────────────────┘             │   │
│                                                                                │   │
│   userData/                                                                    │   │
│     aria.db          ◀── SQLCipher-encrypted; key in main RAM only             │   │
│     secrets.json     ◀── safeStorage-encrypted blob (frontier API key)         │   │
│     vault.json       ◀── argon2id/scrypt-protected BIP39 (unlock password)     │   │
│     logs/*.json      ◀── pino-roll, PII-redacted at sink                       │   │
└────────────────────────────────────────────────────────────────────────────────│───┘
                                                                                 │
                          ┌──────────────────────────────────────────────────────┘
                          ▼
              ┌────────────────────┐         ┌──────────────────────────┐
              │  Ollama localhost  │         │  Anthropic / OpenAI /    │
              │  http://127.0.0.1: │         │  Google API (frontier;   │
              │  11434             │         │  only if API key set     │
              │  (LOCAL route)     │         │  AND not PII-sensitive)  │
              └────────────────────┘         └──────────────────────────┘
```

**Hello-briefing round-trip (Settings → Diagnostics):**
1. User types into "Ask Aria" → renderer calls `electronAPI.askAria({ prompt, source: 'generic' })`.
2. Preload → `ipcMain.handle('aria:ask', …)` in main.
3. Main passes through `LLMRouter.classify({ prompt, source })` → returns `{ route, reason }`.
4. Main calls `generateText({ model, prompt })` with Ollama or Anthropic model object.
5. Main INSERTs into `routing_log` (timestamp, route, reason, source, prompt_hash, model, latency_ms, ok).
6. Main returns `{ answer, route, reason }` to renderer; UI shows both.

### Recommended Project Structure
```
aria/
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── src/
│   ├── main/
│   │   ├── index.ts                 # app.whenReady, createWindow, IPC wiring
│   │   ├── ipc/
│   │   │   ├── index.ts             # registerHandlers(); one file per surface
│   │   │   ├── ask.ts               # aria:ask handler
│   │   │   ├── onboarding.ts        # mnemonic gen/confirm/seal
│   │   │   ├── secrets.ts           # set/get/clear frontier key
│   │   │   ├── ollama.ts            # detect, list models
│   │   │   └── diagnostics.ts       # last-N routing rows, status snapshot
│   │   ├── db/
│   │   │   ├── connect.ts           # open + PRAGMA key + PRAGMA cipher
│   │   │   ├── migrations/
│   │   │   │   ├── 001_init.sql     # app_meta, routing_log, settings tables
│   │   │   │   └── runner.ts        # PRAGMA user_version-driven
│   │   │   ├── backup.ts            # VACUUM INTO with rekey; .ariabackup
│   │   │   └── restore.ts
│   │   ├── vault/
│   │   │   ├── mnemonic.ts          # @scure/bip39 helpers
│   │   │   ├── derive.ts            # mnemonic → SQLCipher key (scrypt or PBKDF2)
│   │   │   └── unlock.ts            # daily password → unwrap mnemonic
│   │   ├── secrets/
│   │   │   └── safeStorage.ts       # encryptString → b64 → secrets.json
│   │   ├── llm/
│   │   │   ├── router.ts            # classify({prompt, source}) → {route, reason}
│   │   │   ├── classifier.ts        # hard regex rules (PII patterns)
│   │   │   ├── providers.ts         # build AI SDK provider clients lazily
│   │   │   └── ollamaProbe.ts       # GET /api/tags, list models, version
│   │   ├── log/
│   │   │   ├── pino.ts              # pino + pino-roll + redaction
│   │   │   └── redact.ts            # default PII allowlist/regex
│   │   └── lifecycle/
│   │       ├── powerMonitor.ts      # suspend/resume hooks (scaffold)
│   │       └── scheduler.ts         # node-cron registration (scaffold)
│   ├── preload/
│   │   └── index.ts                 # contextBridge.exposeInMainWorld('aria', {…})
│   └── renderer/
│       ├── index.html
│       ├── main.tsx
│       ├── app/
│       │   ├── App.tsx
│       │   ├── routes.tsx           # side-nav routing
│       │   └── theme/tokens.ts      # D-13 token set
│       ├── pages/
│       │   ├── Onboarding/          # mnemonic display + 3-word confirm
│       │   ├── Briefing/            # "Aria is alive" status (D-12)
│       │   ├── Approvals/           # placeholder
│       │   └── Settings/
│       │       ├── ApiKey.tsx       # set/clear frontier key + provider picker
│       │       ├── OllamaStatus.tsx # detection panel + install instructions
│       │       └── Diagnostics.tsx  # "Ask Aria" box + last-N routing log
│       ├── components/ui/           # shadcn primitives
│       └── lib/electronAPI.ts       # typed wrapper around window.aria.*
├── resources/                       # icons, etc.
├── tests/
│   ├── unit/classifier.spec.ts      # hard-rules regex coverage
│   ├── unit/router.spec.ts          # fail-closed + source defaults
│   ├── unit/vault.spec.ts           # bip39 round-trip, derive determinism
│   └── e2e/hello.spec.ts            # Playwright _electron: ask → answer + route
└── build/                           # electron-builder config (dev only in P1)
```

### Pattern 1: Secure Preload + Typed IPC
**What:** Expose one method per IPC channel via `contextBridge`; never expose `ipcRenderer` directly.
**When:** Always — this is the Electron security baseline.
**Example:**
```ts
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  ask: (input: { prompt: string; source: string }) =>
    ipcRenderer.invoke('aria:ask', input) as Promise<{
      answer: string; route: 'LOCAL' | 'FRONTIER'; reason: string;
    }>,
  ollamaStatus: () => ipcRenderer.invoke('aria:ollama:status'),
  setApiKey: (provider: 'anthropic'|'openai'|'google', key: string) =>
    ipcRenderer.invoke('aria:secrets:setApiKey', provider, key),
  // … one method per IPC channel; NO direct ipcRenderer pass-through
};
contextBridge.exposeInMainWorld('aria', api);
// (Source: electronjs.org/docs/latest/tutorial/context-isolation)
```
BrowserWindow webPreferences MUST include: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (preload only loads from disk; no Node in renderer).

### Pattern 2: SQLCipher Open + Migration Runner
**What:** Open the DB, set the key BEFORE any read, then run forward-only migrations driven by `PRAGMA user_version`.
**When:** On every main-process startup after unlock.
**Example:**
```ts
// src/main/db/connect.ts
import Database from 'better-sqlite3-multiple-ciphers';
import path from 'node:path';
import { app } from 'electron';

export function openDb(masterKeyHex: string) {
  const file = path.join(app.getPath('userData'), 'aria.db');
  const db = new Database(file);
  // SQLCipher-compatible cipher selection (one of: sqlcipher | chacha20 | aes256cbc)
  db.pragma(`cipher='sqlcipher'`);
  db.pragma(`key="x'${masterKeyHex}'"`); // raw 32-byte hex; do NOT use passphrase form
  // sanity-touch — must succeed under correct key
  db.prepare('SELECT count(*) FROM sqlite_master').get();
  return db;
}
// (Source: utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_sql_pragmas/)
```

Migration runner:
```ts
const v = db.pragma('user_version', { simple: true }) as number;
for (const m of migrationsAfter(v)) {
  db.exec(m.sql);
  db.pragma(`user_version = ${m.version}`);
}
```

### Pattern 3: BIP39 Mnemonic → SQLCipher Key
**What:** Generate 12-word mnemonic; derive 32-byte DB key deterministically; never persist the raw mnemonic in plaintext.
```ts
// src/main/vault/mnemonic.ts
import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { scrypt } from 'node:crypto';

export function generate(): string {
  return bip39.generateMnemonic(wordlist, 128); // 12 words
}

export function deriveDbKey(mnemonic: string, appSalt: Buffer): Promise<Buffer> {
  // scrypt(N=2^15, r=8, p=1) → 32 bytes, ~100ms. Salt is app-constant + stored in app_meta.
  return new Promise((res, rej) =>
    scrypt(mnemonic.normalize('NFKD'), appSalt, 32, { N: 1<<15, r: 8, p: 1 }, (e, k) =>
      e ? rej(e) : res(k)));
}
```
**Why scrypt over PBKDF2-SHA256:** PBKDF2 is SQLCipher's legacy default and is GPU-cheap; scrypt is memory-hard. SQLCipher's built-in KDF iterations only apply if we pass a *passphrase* with `PRAGMA key='passphrase'`. We pass the **raw 32-byte hex key** (`PRAGMA key="x'…'"`) so the cipher does not re-KDF — our scrypt step IS the KDF. [CITED: zetetic.net/sqlcipher/sqlcipher-api/]

### Pattern 4: safeStorage for Frontier API Keys
```ts
// src/main/secrets/safeStorage.ts
import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const file = () => path.join(app.getPath('userData'), 'secrets.json');

export async function setApiKey(provider: string, raw: string) {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('OS-keychain encryption unavailable');
  const blob = safeStorage.encryptString(raw).toString('base64');
  const cur = await readAll();
  cur[provider] = blob;
  await fs.writeFile(file(), JSON.stringify(cur, null, 2), { mode: 0o600 });
}

export async function getApiKey(provider: string): Promise<string | null> {
  const cur = await readAll();
  const blob = cur[provider]; if (!blob) return null;
  return safeStorage.decryptString(Buffer.from(blob, 'base64'));
}
// (Source: electronjs.org/docs/latest/api/safe-storage)
```
Notes (Windows): `isEncryptionAvailable()` only returns `true` after `app.whenReady()` — call setters after ready [CITED: github.com/electron/electron#33640]. On a corrupted DPAPI state (rare; Windows-profile reset), `decryptString` throws — treat as "key lost, re-prompt user."

### Pattern 5: LLM Router with Hard-Rules Classifier
```ts
// src/main/llm/classifier.ts
const PII_PATTERNS: Array<[RegExp, string]> = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, 'email-address'],
  [/(?:\+?\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/, 'phone-number'],
  [/\b\d{3}-\d{2}-\d{4}\b/, 'ssn-like'],
  [/\$[\s]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/, 'currency'],
  // contact-name heuristic deferred to Phase 3 classifier upgrade
];

export function detectPII(text: string): string | null {
  for (const [re, label] of PII_PATTERNS) if (re.test(text)) return label;
  return null;
}
```
```ts
// src/main/llm/router.ts
import { detectPII } from './classifier';

type Source = 'user-email'|'user-calendar'|'user-transcript'|'generic'|undefined;
type Decision = { route: 'LOCAL'|'FRONTIER'; reason: string };

export function classify(prompt: string, source: Source): Decision {
  if (!source) return { route: 'LOCAL', reason: 'fail-closed: source unset' };  // D-08
  if (source !== 'generic')
    return { route: 'LOCAL', reason: `source=${source} is user-data-derived` }; // D-05
  const hit = detectPII(prompt);
  if (hit) return { route: 'LOCAL', reason: `pattern: ${hit}` };                // D-05
  // generic + clean → frontier if configured
  return { route: 'FRONTIER', reason: 'generic + no PII pattern' };
}
```
```ts
// src/main/llm/providers.ts
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOllama } from 'ollama-ai-provider-v2';

export async function callModel(route: 'LOCAL'|'FRONTIER', prompt: string) {
  if (route === 'LOCAL') {
    const ollama = createOllama({ baseURL: 'http://127.0.0.1:11434/api' });
    return generateText({ model: ollama('llama3.1:8b-instruct-q4_K_M'), prompt });
  }
  const provider = await loadActiveProvider();  // reads settings + safeStorage
  switch (provider.name) {
    case 'anthropic': {
      const c = createAnthropic({ apiKey: provider.key });
      return generateText({ model: c('claude-3-5-sonnet-latest'), prompt });
    }
    case 'openai':    return generateText({ model: createOpenAI({ apiKey: provider.key })('gpt-4o-mini'), prompt });
    case 'google':    return generateText({ model: createGoogleGenerativeAI({ apiKey: provider.key })('gemini-1.5-flash'), prompt });
  }
}
```
**Frontier degradation (LLM-05):** If `route === 'FRONTIER'` but no provider/key configured → downgrade to LOCAL and append `+ frontier-disabled` to reason. If LOCAL fails (Ollama down) → return structured `{ok:false, error:'ollama_unreachable'}` to renderer; the diagnostics UI shows guidance, never a silent failure.

### Pattern 6: Routing Log Schema
```sql
-- src/main/db/migrations/001_init.sql
CREATE TABLE app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE routing_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,           -- epoch ms
  route TEXT NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
  reason TEXT NOT NULL,
  source TEXT,                   -- user-email | user-calendar | user-transcript | generic | null
  prompt_hash TEXT NOT NULL,     -- sha256 hex of prompt; never store prompt body in P1
  model TEXT,                    -- e.g. 'llama3.1:8b-instruct-q4_K_M' / 'claude-3-5-sonnet-latest'
  latency_ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1, -- 1 if call succeeded, 0 if errored
  error TEXT
);
CREATE INDEX idx_routing_log_ts ON routing_log(ts DESC);
```
Per D-06: never store the raw prompt; store its sha256 — keeps the routing log auditable without re-introducing PII into a "log" surface.

### Pattern 7: Encrypted Backup/Restore (D-04, FOUND-04)
```ts
// src/main/db/backup.ts
export function backup(db, destPath: string) {
  // Same key on backup file (deterministic from mnemonic on restore).
  db.exec(`VACUUM INTO '${destPath.replace(/'/g, "''")}'`);
}
// On restore: copy .ariabackup → userData/aria.db.new, open with mnemonic-derived key,
// verify schema, then atomically rename over aria.db.
```
Single backup verb (VACUUM INTO) preserves SQLCipher encryption with the same key — and a fresh machine can reopen the file by re-deriving the same key from the mnemonic [CITED: utelle.github.io SQLite3MC docs]. **API keys and OAuth tokens are NOT in the file (D-04).**

### Anti-Patterns to Avoid
- **Storing the BIP39 mnemonic in `safeStorage`.** It would tie recovery to the local machine and break D-04 backup portability. Mnemonic lives in the user's head + sealed `vault.json` (unwrappable by the daily password).
- **Putting `safeStorage` calls in the renderer.** API only exists in main; renderer must IPC for it.
- **Exposing `ipcRenderer.send/invoke` directly via contextBridge.** Renderer compromise → arbitrary IPC. One method per channel.
- **Calling `safeStorage` before `app.whenReady()`.** Windows DPAPI returns false; behavior is undefined [CITED: github.com/electron/electron#33640].
- **Persisting the raw prompt in the routing log.** D-06 specifies prompt hash only.
- **Storing the SQLCipher key on disk.** Key lives in main-process RAM only; on lock/restart, re-derive from mnemonic via unlock password.
- **Wiring `sqlite-vec` into the DB in Phase 1.** Known Windows breakage; not required by any Phase 1 requirement; defer to Phase 7.
- **Bumping Electron mid-phase.** Pin Electron to a single 42.x patch before any native rebuild; major bumps require a rebuild matrix.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BIP39 word generation/validation | Custom mnemonic | `@scure/bip39` + `wordlists/english` | Audited; checksums; constant-time wordlist lookup |
| AES + DPAPI/Keychain wrapping for API keys | Custom crypto | Electron `safeStorage` | Native OS keychain; one API for Windows/macOS/Linux |
| SQLCipher cipher selection / key application | Custom PRAGMA fiddling | The 2-line pattern in `connect.ts` | Get cipher PRAGMA order wrong → DB unreadable on next launch |
| Vendor LLM HTTP clients (Anthropic/OpenAI/Google) | Custom fetch wrappers | `@ai-sdk/{anthropic,openai,google}` + `ai` | Free tool-calling, retries, streaming, structured output |
| Ollama HTTP client | Custom fetch | `ollama-ai-provider-v2` (or `ollama` for raw `/api/tags` probe) | One AI SDK call shape for LOCAL and FRONTIER |
| Migration runner state | Stuffing JSON in a sidecar file | `PRAGMA user_version` | Atomic with the DB; rolls back with the DB on failure |
| Log rotation | Custom file-size monitoring | `pino-roll` | Battle-tested; integrates with pino |
| PII regex from scratch | Rolling email/phone regex | Use community-known patterns; doc source | Reduces false positives; we still own the allowlist |

**Key insight:** The only thing in Phase 1 we genuinely hand-roll is the **router decision function** (`classify(prompt, source)`) and the **vault unlock flow**. Everything else is glue between vetted libraries. Resist the temptation to write a "small" crypto wrapper.

## Runtime State Inventory

*Phase 1 is greenfield (no prior phases, no migrations, no rename). This section does not apply.*

## Common Pitfalls

### Pitfall 1: sqlite-vec extension silently fails to load on Windows
**What goes wrong:** `db.loadExtension('vec0.dll')` returns success, but `SELECT vec_version()` throws `no such function: vec_version`. The shipped Windows DLL was built against pre-3.45 SQLite; `better-sqlite3-multiple-ciphers` 12.x bundles a newer SQLite [CITED: github.com/openclaw/openclaw#65704].
**Why it happens:** SQLite's extension ABI evolved across 3.45/3.48 (FTS5-style extensions retrieve API pointers via SELECT and break under newer hosts).
**How to avoid (Phase 1):** Do not load sqlite-vec in Phase 1. Phase 7 (RAG) does a focused spike against the then-current versions, and may need to either (a) rebuild sqlite-vec from source against the host SQLite version, or (b) wait for upstream fixes, or (c) switch to a Node-side vector store. Document this as a Phase 7 risk in the routing-log architecture so we don't surprise ourselves.
**Warning sign:** Any plan task that says "wire sqlite-vec into the DB" before Phase 7 — flag and remove.

### Pitfall 2: better-sqlite3-multiple-ciphers native rebuild against Electron's Node ABI on Windows
**What goes wrong:** `npm install` builds the module against system Node (v25 on this machine [VERIFIED locally]), then Electron loads it and aborts with `Module did not self-register` or NODE_MODULE_VERSION mismatch.
**Why it happens:** Electron 42 ships its own Node ABI version. Native modules must be rebuilt against that ABI.
**How to avoid:** Add an `electron-rebuild` step (`@electron/rebuild`) to the postinstall script: `electron-rebuild -f -w better-sqlite3-multiple-ciphers`. The package ships Electron prebuilds — verify the prebuild for the chosen Electron 42 minor exists before relying on it; if not, full source rebuild requires Visual Studio Build Tools on Windows. [CITED: github.com/m4heshd/better-sqlite3-multiple-ciphers troubleshooting]
**Warning sign:** First `npm run dev` on a clean clone errors at DB-open.

### Pitfall 3: safeStorage called before app ready returns false on Windows
**What goes wrong:** Onboarding flow tries to stash the API key during module-init code; `safeStorage.isEncryptionAvailable()` returns false; key is silently dropped or thrown.
**How to avoid:** Gate all secrets calls behind `await app.whenReady()`. The IPC handler pattern already enforces this in practice. [CITED: github.com/electron/electron#33640]
**Warning sign:** "encryption unavailable" only on first launch.

### Pitfall 4: AI SDK 6 vs the abandoned `ollama-ai-provider`
**What goes wrong:** A planner notices CLAUDE.md says "ollama-ai-provider" and `npm install ollama-ai-provider` — version 1.2.0 from Jan 2025 — pulls zod 3 and breaks the `ai@6` peer-dep resolution (`ai` 6 requires zod ^3.25.76 ‖ ^4) [VERIFIED via `npm view`].
**How to avoid:** Use `ollama-ai-provider-v2@^3.5` (peer-deps `ai: ^5||^6`, `zod: ^4`) [VERIFIED]. Treat CLAUDE.md's "ollama-ai-provider" string as the *concept*, not the package name.
**Warning sign:** zod major-version conflict at install.

### Pitfall 5: Storing the mnemonic in safeStorage (breaks backup portability)
**What goes wrong:** Convenient at first; backup file is now unrecoverable on a different machine because the mnemonic was sealed with DPAPI tied to the original Windows account.
**How to avoid:** The mnemonic is sealed only by the daily-unlock password (scrypt/argon2id of password → AES-GCM-wrap mnemonic → `vault.json`). The mnemonic is what the user must own; safeStorage is for API keys (which D-04 says are NOT backed up).
**Warning sign:** Restoring on a fresh machine asks for a password instead of the mnemonic.

### Pitfall 6: Renderer can call `ipcRenderer` directly if contextBridge surface is too wide
**What goes wrong:** Exposing `{ invoke: ipcRenderer.invoke }` to renderer means any compromised renderer code can talk to any IPC channel.
**How to avoid:** Expose one method per channel; validate argument shapes inside `ipcMain.handle` with zod. [CITED: electronjs.org/docs/latest/tutorial/context-isolation]
**Warning sign:** A `aria:invoke` generic channel appears in a plan.

### Pitfall 7: PII redaction at log call sites instead of at the sink
**What goes wrong:** Some log call uses raw values; PII reaches disk because redaction is opt-in per call.
**How to avoid:** Pino has built-in redaction paths (`redact: { paths: [...], remove: true }`). Apply at logger construction so EVERY child logger inherits it. D-16 specifies sink-side redaction.
**Warning sign:** A `logger.info('user: ' + user.email)` line — concatenated, not field-keyed.

### Pitfall 8: Sleep/wake cron storm (XCUT-01 carries to later phases; scaffold in P1)
**What goes wrong:** Machine wakes; all missed cron firings dispatch at once. Causes rate-limit thunder against Gmail/Anthropic in later phases.
**How to avoid:** `powerMonitor.on('suspend', pauseCron); on('resume', coalesceAndResume)`. Phase 1 only needs the **hooks** registered; cadence is Phase 2.

### Pitfall 9: Windows long-path + electron-builder
**What goes wrong:** Native modules unpack into deep node_modules paths; Windows MAX_PATH bites. NSIS unpack errors.
**How to avoid:** Enable `gpedit` LongPathsEnabled at dev machine; in builder config use `asarUnpack: ["**/*.node"]` so native binaries live outside asar.

### Pitfall 10: Provider key validation race in Settings UI
**What goes wrong:** User pastes key → renderer immediately re-renders status; main hasn't persisted yet; "API key present" toggles back to "missing" once.
**How to avoid:** Make `aria:secrets:setApiKey` return the new status snapshot; renderer renders from response, not from a separate `getStatus` it raced.

## Code Examples

### Settings → Diagnostics "Ask Aria" handler (the Walking Skeleton in 30 lines)
```ts
// src/main/ipc/ask.ts
import { ipcMain } from 'electron';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { classify } from '../llm/router';
import { callModel } from '../llm/providers';
import { db } from '../db';        // singleton opened after unlock
import { logger } from '../log/pino';

const Input = z.object({ prompt: z.string().min(1).max(8_000), source: z.string().optional() });

ipcMain.handle('aria:ask', async (_evt, raw) => {
  const { prompt, source } = Input.parse(raw);
  const decision = classify(prompt, source as any);
  const started = Date.now();
  let answer = '', ok = 1, err: string | null = null, model = '';
  try {
    const r = await callModel(decision.route, prompt);
    answer = r.text; model = r.response?.modelId ?? '';
  } catch (e: any) { ok = 0; err = String(e?.message ?? e); }
  db.prepare(
    `INSERT INTO routing_log(ts,route,reason,source,prompt_hash,model,latency_ms,ok,error)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(
    Date.now(), decision.route, decision.reason, source ?? null,
    createHash('sha256').update(prompt).digest('hex'),
    model, Date.now() - started, ok, err
  );
  logger.info({ route: decision.route, reason: decision.reason, ok, latency_ms: Date.now() - started }, 'aria.ask');
  if (!ok) throw new Error(err ?? 'llm-call-failed');
  return { answer, route: decision.route, reason: decision.reason };
});
```

### Ollama probe (no SDK required)
```ts
// src/main/llm/ollamaProbe.ts
export async function probeOllama() {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { running: false, models: [] as string[] };
    const j = await res.json() as { models: Array<{ name: string }> };
    return { running: true, models: j.models.map(m => m.name) };
  } catch { return { running: false, models: [] as string[] }; }
}
```
*[VERIFIED locally: probing `127.0.0.1:11434` on this machine returns OLLAMA_NOT_REACHABLE — Phase 1 must handle that path well.]*

### Pino with PII redaction at sink
```ts
// src/main/log/pino.ts
import pino from 'pino';
import path from 'node:path';
import { app } from 'electron';

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  redact: {
    paths: ['*.email', '*.phone', '*.body', '*.subject', 'req.headers.authorization', 'apiKey', 'prompt'],
    censor: '[REDACTED]',
  },
  transport: {
    target: 'pino-roll',
    options: {
      file: path.join(app.getPath('userData'), 'logs', 'aria.log'),
      frequency: 'daily', size: '10m', mkdir: true,
    },
  },
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Electron 33 (CLAUDE.md target) | Electron 42.1.0 | Through 2025–2026 quarterly | Re-pin to 42; existing rebuild + signing guidance is unchanged |
| Vercel AI SDK 5 (CLAUDE.md target) | AI SDK 6.0.184 | 2026-Q1 | Update peer-dep pins (`zod ^3.25 ‖ ^4`); call sites largely unchanged |
| `ollama-ai-provider` (sgomez, 1.2.0) | `ollama-ai-provider-v2` (nordwestt, 3.5.1) | Original abandoned Jan 2025; v2 took over | Drop-in conceptually but different import name and constructor |
| keytar for secrets | Electron `safeStorage` | keytar archived ~2024 | Already locked in CLAUDE.md |
| `bip39` (bitcoinjs) | `@scure/bip39` | 2023–2024 | Smaller, audited, modern |
| Tauri Stronghold | Deprecating | Tauri v3 plans | Not Aria's path; reinforces Electron+safeStorage choice |

**Deprecated/outdated:**
- `keytar`: archived. Do not introduce.
- `ollama-ai-provider` (original): 5+ months stale, missing AI SDK 5/6 support.
- Spectron: dead; use Playwright `_electron`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.6 (unit/integration); Playwright 1.60.0 with `_electron` (smoke E2E) |
| Config file | `vitest.config.ts`, `playwright.config.ts` — both to be created in Wave 0 |
| Quick run command | `npx vitest run --changed` |
| Full suite command | `npx vitest run && npx playwright test --config=playwright.config.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FOUND-01 | App boots; main window visible | smoke (Playwright _electron) | `npx playwright test tests/e2e/boot.spec.ts` | ❌ Wave 0 |
| FOUND-02 | Mnemonic gen + 3-word confirm succeeds; wrong words rejected | unit | `npx vitest run tests/unit/vault.spec.ts -t "mnemonic"` | ❌ Wave 0 |
| FOUND-03 | DB created with PRAGMA key; re-open with wrong key fails; correct key succeeds | unit | `npx vitest run tests/unit/db.spec.ts -t "encryption"` | ❌ Wave 0 |
| FOUND-04 | Backup → wipe userData → restore → row count matches | integration | `npx vitest run tests/unit/backup.spec.ts` | ❌ Wave 0 |
| FOUND-05 | safeStorage round-trip; presence reflected in IPC status | integration (Electron harness in vitest) | `npx vitest run tests/unit/secrets.spec.ts` | ❌ Wave 0 |
| FOUND-06 | Ollama probe handles up/down/timeout | unit (mock fetch) | `npx vitest run tests/unit/ollama.spec.ts` | ❌ Wave 0 |
| FOUND-07 | Diagnostics shows api-key, ollama, last-route summary correctly | E2E | `npx playwright test tests/e2e/diagnostics.spec.ts` | ❌ Wave 0 |
| LLM-01 | PII patterns force LOCAL even when source=generic | unit | `npx vitest run tests/unit/classifier.spec.ts` | ❌ Wave 0 |
| LLM-03 | Every call writes a routing_log row with required columns | unit | `npx vitest run tests/unit/router.spec.ts -t "log"` | ❌ Wave 0 |
| LLM-04 | Unset/undefined `source` → LOCAL with "fail-closed" reason | unit | `npx vitest run tests/unit/router.spec.ts -t "fail-closed"` | ❌ Wave 0 |
| LLM-05 | Frontier path with no key → downgrades to LOCAL; Ollama down → structured error | integration | `npx vitest run tests/unit/router.spec.ts -t "degrade"` | ❌ Wave 0 |
| D-15 (cross-cut) | CASA intake submitted | manual-only (calendar task) | n/a — tracked as a non-engineering plan item | n/a |

### Sampling Rate
- **Per task commit:** `npx vitest run --changed`
- **Per wave merge:** `npx vitest run && npx playwright test`
- **Phase gate:** Full suite green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `vitest.config.ts` — node env for main-process tests, jsdom for renderer-side helpers
- [ ] `playwright.config.ts` — `_electron` launcher pointing at the dev build
- [ ] `tests/conftest.ts` (or `tests/setup.ts`) — temp `userData` fixture, in-memory DB helper, mock-Ollama fetch
- [ ] `tests/unit/{classifier,router,vault,db,backup,secrets,ollama}.spec.ts`
- [ ] `tests/e2e/{boot,diagnostics}.spec.ts`
- [ ] Framework install: `npm i -D vitest@^4 playwright@^1.60 @playwright/test`

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes (local) | BIP39 mnemonic + daily unlock password; scrypt KDF for vault |
| V3 Session Management | yes (local, in-memory) | DB key + unwrapped mnemonic held in main-process memory only; no renderer access; lost on quit |
| V4 Access Control | yes | Tight IPC surface: one method per channel; renderer cannot read keys or call providers directly |
| V5 Input Validation | yes | zod schemas on every IPC handler input; reject oversize prompts |
| V6 Cryptography | yes | Reuse only: `safeStorage` (OS-supplied), SQLCipher (utelle/SQLite3MC), `@scure/bip39`, Node `crypto.scrypt`. **No hand-rolled crypto.** |
| V7 Error Handling | yes | Structured errors over IPC; never echo raw provider errors to renderer (may contain keys in messages) |
| V8 Data Protection | yes | All on-disk app data SQLCipher-encrypted; secrets via safeStorage; logs PII-redacted at sink |
| V14 Configuration | yes | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; CSP on the renderer HTML |

### Known Threat Patterns for Electron + LLM + Local Vault

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer-process compromise (XSS via untrusted text from a future Phase 2 inbound email) | Elevation of Privilege | Context isolation, narrow contextBridge surface, CSP, no `nodeIntegration` |
| Prompt-text leaking into the routing log | Information Disclosure | Hash-only (`prompt_hash` column); never persist body in P1 |
| PII reaching a frontier API by mistake | Information Disclosure | Hard-rules classifier + fail-closed default; routing log makes every decision auditable |
| API key extracted from process memory | Information Disclosure | Out of scope for v1 (acknowledged in PROJECT.md); minimize key lifetime in memory; never log |
| Backup file stolen | Information Disclosure | File is SQLCipher-encrypted with mnemonic-derived key; without mnemonic file is opaque |
| Path traversal in backup destination IPC | Tampering | Validate destination with `path.resolve` + allowlist (user-chosen via Electron `dialog.showSaveDialog`, never raw renderer string) |
| Provider error messages leaking key fragments | Information Disclosure | Strip provider error bodies before re-throwing across IPC |
| Process-priority abuse / DoS via giant prompts | Denial of Service | zod `.max(8_000)`; p-queue cap of 1 concurrent in P1 |
| Sleep/wake cron storm (later phases) | Denial of Service (self) | powerMonitor pause/coalesce — hooks in P1 |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build / tooling | ✓ [VERIFIED locally] | v25.1.0 | Pin to 20 LTS in `engines` for parity with Electron's bundled Node |
| npm | Install | ✓ [VERIFIED locally] | 11.6.3 | — |
| Ollama daemon | LOCAL LLM path (FOUND-06) | ✗ [VERIFIED locally — `127.0.0.1:11434` unreachable] | — | App must handle gracefully (D-10, LLM-05): show install instructions; LOCAL-only mode disabled until Ollama present |
| Visual Studio Build Tools (Windows) | Native rebuild of `better-sqlite3-multiple-ciphers` if no prebuild | ✗ unknown — verify at scaffold | — | Prefer prebuild from the package; install Build Tools if rebuild required |
| `git` | Repo | ✓ | unknown — git operations succeeded | — |
| Apple Developer ID / Windows OV cert | Signing | ✗ | — | Phase 8; not blocking Phase 1 dev builds |

**Missing dependencies with no fallback:** *None blocking Phase 1.* (Ollama-not-installed is **expected** and is itself a Phase 1 requirement to handle gracefully.)

**Missing dependencies with fallback:**
- Ollama → app shows "Ollama not detected" UI panel with install link (D-10, FOUND-06); routing forces LOCAL is impossible without Ollama, so when no frontier key AND no Ollama, the diagnostics "Ask Aria" call returns a structured "no model available" error and surfaces it to the user (this is the LLM-05 degraded path).

## Project Constraints (from CLAUDE.md)

Directives extracted from `CLAUDE.md`. All plans MUST comply:

1. **TypeScript / Node throughout.** No language sprawl.
2. **Local-first.** User data never leaves the machine except as scoped LLM prompts to frontier APIs, and only after the router permits.
3. **Frontier APIs only for reasoning; local Llama/Qwen-class via Ollama for sensitivity routing.** Phase 1 wires both shapes; doesn't yet use the classifier for sensitivity (that's the Phase 3 upgrade).
4. **Phases small enough for one person in a session.** Inform plan sizing in Phase 1.
5. **All outbound communication / material calendar changes / sensitive content require explicit user confirmation.** Phase 1 has no outbound; the Approvals page is a placeholder per D-11.
6. **No HIPAA / no PCI in v1.** Health and direct financial actions are out of scope.
7. **Stack pins from "Technology Stack" section** (Electron, electron-vite, React 18, Vite 5, TS 5, Tailwind 3.4, shadcn, better-sqlite3-multiple-ciphers, sqlite-vec (Phase 7), SQLCipher, safeStorage, Vercel AI SDK, Ollama, node-cron, p-queue, electron-builder, electron-updater, Vitest, Playwright, MSW, pino, @sentry/electron, docx, @react-pdf/renderer). Phase 1 uses the Phase-1-relevant subset; defers sqlite-vec, googleapis, msal, docx, etc.
8. **All file edits go through a GSD workflow.** No ad-hoc commits outside GSD.
9. **Conventions/Architecture: "not yet established — populated as patterns emerge."** Phase 1 establishes them; later phases inherit.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | React 18.3.x is current and CLAUDE.md target [ASSUMED — not re-verified at version probe] | Standard Stack | Low: install will succeed at 18 or 19; pin to whatever resolves cleanly with Vite 5 |
| A2 | shadcn CLI is stable as of 2026-05 [ASSUMED] | Standard Stack | Low: components are copy-in; even if CLI changes we keep the output |
| A3 | `@electron-toolkit/preload` is still the canonical preload helper [ASSUMED — pattern is in electron-vite docs as of 2025] | Pattern 1 | Low: we can drop to raw contextBridge if needed |
| A4 | scrypt N=2^15 is appropriate for desktop unlock (≈100ms) [ASSUMED based on common practice] | Pattern 3 | Medium: if too slow on low-end laptops, lower N; if too fast, raise N. Tune at QA. |
| A5 | Backup via `VACUUM INTO` preserves the SQLCipher key on the destination file [ASSUMED — needs explicit verification from utelle docs at implementation time; CITED docs confirm rekey on the destination via `KEY` clause exists, but the simple `VACUUM INTO` path with same key should "just work"] | Pattern 7 | Medium: if not, fall back to file copy under a transaction or explicit `KEY` clause |
| A6 | Visual Studio Build Tools availability on this Windows dev machine [ASSUMED unknown] | Environment Availability | Medium: if rebuild needed and tools missing, scaffold blocks until install |
| A7 | `ollama-ai-provider-v2` is mature enough for production-shape LOCAL calls [ASSUMED — verified peer-dep, but not battle-tested in Aria] | Standard Stack | Medium: fallback is `ai-sdk-ollama` (jagreehal); both speak AI SDK 6 |
| A8 | Electron 42 will remain the stable target across Phase 1 [ASSUMED] | Standard Stack / Pitfall 2 | Low: pin to a specific 42.x.x before scaffold |
| A9 | The user accepts that "session-only unlock" (D-02) is the v1 posture; no idle re-lock | Locked Decision (D-02) | None — this is a locked user decision; flagged here only because A4 KDF tuning may indirectly affect unlock UX |

**If this table is empty:** Not empty — items A1–A9 are surfaced for plan-checker / discuss-phase visibility.

## Open Questions

1. **SQLCipher key delivery: raw 32-byte hex vs SQLCipher passphrase mode**
   - What we know: SQLCipher accepts either a passphrase (then internal PBKDF2) or a raw key. better-sqlite3-multiple-ciphers supports both.
   - What's unclear: Whether bypassing SQLCipher's internal PBKDF2 by passing a raw key (and doing scrypt ourselves) is preferred for memory-hardness, or whether the team would rather use SQLCipher's tuned PBKDF2 iterations (≥256k).
   - Recommendation: Pass the raw key (do KDF ourselves with scrypt); document the salt and parameters in `app_meta`. Revisit if onboarding QA finds it sluggish.

2. **Should the active LLM provider be per-call configurable or app-global?**
   - What we know: D-09 says one frontier provider active at a time.
   - What's unclear: Whether Diagnostics offers a "force provider" switch.
   - Recommendation: Phase 1 = global only; deferred toggle.

3. **`vault.json` cipher: AES-256-GCM via Node `crypto` vs `safeStorage` (rejected for mnemonic per Pitfall 5)**
   - Recommendation: `crypto.scrypt` (KDF from unlock password) + `crypto.createCipheriv('aes-256-gcm', …)`. Store salt + nonce + ciphertext + tag in JSON.

4. **node-cron 4 vs 3:** CLAUDE.md says 3.x; current is 4.x with breaking changes.
   - Recommendation: Use 4.x; document the migration if anyone references 3.x docs.

5. **Tailwind 3.4 vs Tailwind 4:** Tailwind 4 (zero-config Lightning CSS) is out; CLAUDE.md pins 3.4.
   - Recommendation: Stay on 3.4 in Phase 1 to honor the lock; revisit at a phase boundary.

6. **Whether to enable Electron Fuses in Phase 1** (e.g., disable `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`).
   - Recommendation: YES — flip the standard hardening fuses now; trivial cost and a meaningful posture win.

## Sources

### Primary (HIGH confidence)
- npm registry (live `npm view` probes, 2026-05-16) — verified versions for every "[VERIFIED: npm …]" claim above
- electronjs.org/docs/latest/api/safe-storage — safeStorage API and Windows DPAPI semantics
- electronjs.org/docs/latest/tutorial/context-isolation — contextBridge + IPC pattern
- electronjs.org/docs/latest/tutorial/security — secure defaults checklist
- electron-vite.org/guide/dev — preload + electron-toolkit pattern
- utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_sql_pragmas/ — PRAGMA key/rekey/cipher
- github.com/m4heshd/better-sqlite3-multiple-ciphers (troubleshooting) — Electron rebuild and Windows native build guidance
- zetetic.net/sqlcipher/sqlcipher-api/ — KDF iteration semantics (PRAGMA kdf_iter)

### Secondary (MEDIUM confidence)
- github.com/vercel/ai/issues/6924 — AI SDK community discussion on Ollama provider replacement
- npmjs.com/package/ollama-ai-provider-v2 — provider peer-deps verified via npm
- github.com/electron/electron/issues/33640 — Windows safeStorage availability timing
- ai-sdk.dev/providers/community-providers/ollama — current state of Ollama providers

### Tertiary (LOW confidence — flagged for validation at implementation)
- github.com/openclaw/openclaw/issues/65704 — sqlite-vec × better-sqlite3 12.x Windows breakage report (single source; Phase 7 should re-verify against then-current versions)

## Metadata

**Confidence breakdown:**
- Scaffold (electron-vite, preload, contextBridge): HIGH — multiple corroborating official sources
- SQLCipher integration (key application, migrations, backup): MEDIUM-HIGH — official docs cover it; backup via `VACUUM INTO` while preserving same key is a documented pattern but needs a smoke test at implementation
- safeStorage on Windows: HIGH — well-documented; the `app.whenReady()` gotcha is the only quirk
- BIP39 derivation chain: HIGH — `@scure/bip39` is the standard
- AI SDK 6 + ollama-ai-provider-v2 wiring: MEDIUM-HIGH — peer deps verified, but Aria has no prior production usage
- sqlite-vec compatibility: LOW (and **out of Phase 1 scope** as a result)
- Hard-rules classifier coverage: MEDIUM — regex set is conservative; full coverage is a Phase 3 concern
- Routing log schema: HIGH — straightforward
- Hello-briefing wiring: HIGH

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 for the stable parts (Electron/safeStorage/SQLCipher); 2026-05-23 for the AI SDK + provider versions (the JS AI ecosystem moves fast — re-verify versions before scaffold lands).

## RESEARCH COMPLETE

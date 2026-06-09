# Research Summary - Aria v2.1 WhatsApp Group Intelligence

**Project:** Aria v2.1 - Messaging / Group Intelligence
**Domain:** Unofficial WhatsApp Web integration (Baileys WebSocket) layered onto a shipped local-first Electron executive assistant
**Researched:** 2026-06-09
**Confidence:** HIGH (stack versions live-verified; architecture integration points read against live source files; pitfalls corroborated across multiple primary GitHub sources)

---

## Executive Summary

Aria v2.1 adds WhatsApp personal-account group-tracking to the shipped v1.0 desktop app. The integration is built on `@whiskeysockets/baileys@6.7.23` -- the unofficial WhatsApp Web WebSocket library -- linked via QR scan, with a `WhatsAppSessionManager` singleton that owns the Baileys socket entirely outside the existing `SyncOrchestrator`. This is a subsequent-milestone addition to a shipped product: the existing Aria codebase (Electron 41, better-sqlite3 SQLCipher, Vercel AI SDK 5, node-cron, p-queue, pino) is unchanged. The net-new additions are exactly two production packages plus one electron-vite config change to bundle Baileys as ESM.

The MVP boundary is deliberately narrow: link flow to group selection to local text ingestion to per-group daily digest run by Ollama locally. Three high-value extraction consumers (action items to Todoist, meeting proposals to calendar, project-feedback RAG) are explicitly deferred because they layer onto already-stored `whatsapp_message` rows with zero schema additions. This sequencing lets the foundation phase ship clean and the deferred outputs be added in a subsequent phase without any migration work.

The hardest design tensions in this milestone are security and safety, not engineering complexity. WhatsApp integration is an unofficial protocol implementation (ToS violation), third-party group content is PII that must never leave the machine, and the main failure mode that destroys user trust is a permanent ban on their personal number. Every load-bearing guard -- passive-posture socket config, reconnect backoff with hard non-reconnect codes, auth state atomicity, frontier LLM prohibition static ratchet, supply-chain exact-pin -- must land in the foundation phase, not be retrofitted. The roadmapper should treat these as hard gates on the foundation phase and encode them as static ratchets from the first commit.

---

## Key Findings

### Recommended Stack

The v1.0 stack is unchanged. Two packages are added. `@whiskeysockets/baileys@6.7.23` must be pinned exactly (no caret, no `latest`) because the npm `latest` dist-tag resolves to `7.0.0-rc13` -- a release-candidate with three auth-handshake bugs, a breaking LID-system API overhaul, a new Rust/WASM dependency (`whatsapp-rust-bridge`) that can fail silently inside Electron ASAR archives, and a `p-queue@^9` peer conflict with Aria's existing `p-queue@8`. The `6.7.23` legacy tag is the most-patched stable release on the 6.x API surface, maintained in parallel with the v7 RC. `qrcode@1.5.4` renders Baileys QR strings to data-URLs for the renderer (pure-JS, 135 kB, no native deps).

One non-trivial config change is required: Baileys 6.7.20+ is pure-ESM. Aria's `externalizeDepsPlugin` leaves external packages as runtime `require()` calls, which throws `ERR_REQUIRE_ESM`. Fix: add `@whiskeysockets/baileys` to the `exclude` list in the main-process section of `electron.vite.config.ts` -- the same pattern already used for `zod` in the preload. No main-process ESM migration needed; no `electron-rebuild` step; no new native modules.

**Core additions:**
- `@whiskeysockets/baileys@6.7.23` (exact pin): WhatsApp Web WebSocket client -- pure-JS, no native rebuild, MIT license
- `qrcode@1.5.4`: QR data-URL generation for renderer -- pure-JS, zero native deps
- `@types/qrcode` (dev): TypeScript types for qrcode
- `electron.vite.config.ts` `exclude: ['@whiskeysockets/baileys']`: ESM bundling fix -- same pattern as `zod` preload exclude

**Must NOT add:** `sharp`, `jimp`, `audio-decode`, `link-preview-js` (optional Baileys peer deps -- text-only ingestion does not need them). Do not use `whatsapp-web.js` (bundles ~170 MB headless Chromium). Never install any npm package not named `@whiskeysockets/baileys` (confirmed supply-chain attack vector).

### Expected Features

**Must have (table stakes -- P1, all MVP):**
- QR link flow with ban-risk consent gate -- fires before any QR is rendered; must include secondary-number recommendation; non-negotiable
- QR countdown/expiry indicator -- QR expires ~20-30 s; stale QR with no indicator makes the feature appear broken
- Linked status in AccountRow -- phone number + connected/reconnecting/disconnected badge + 401 re-link prompt
- Group discovery list with per-group track/untrack toggle -- all untracked by default; toggle is the privacy boundary
- `@g.us` DM-exclusion -- drops all 1:1 messages at line-2 of `messages.upsert` handler, before any write
- Message ingestion -- text+captions only; `type==='notify'` guard; edits/deletes handled; system messages skipped; pushName sender display name resolution
- Per-group daily digest via local Ollama only -- never frontier model; exec framing (decisions / open questions / @mentions / waiting-on); unread-since-last-briefing window
- WhatsApp digest section in briefing assembler -- optional fourth section; graceful Ollama-unavailable degradation
- Noise suppression -- reactions/stickers/system messages filtered before LLM input
- 30-day rolling retention sweep via existing `sweep-cron`
- Disconnect/unlink with full data purge -- confirmation modal; ON DELETE CASCADE covers `whatsapp_message` and `whatsapp_group_digest`
- "No history before link" copy -- one sentence at link-success time; prevents support tickets

**Should have (differentiators -- also P1, bundled into MVP):**
- Exec-framed digest structure (decisions / waiting-on / open questions / @mentions) -- flat summaries serve no exec need
- Unread-since-last-briefing window (`window_start` = prior digest timestamp, not sliding 24h overlap)
- Reply/quote threading stored (`quoted_message_id` + `quoted_text`) -- gives LLM coherent thread context
- Sender display name resolution (pushName > contact name > phone JID) -- execs need names in digests
- New-group join notification via `groups.upsert` -- prompts track/ignore decision instead of silently missing new groups

**Defer (v2.1.x extraction consumers -- P2, zero schema additions):**
- Action-item extraction to `task_batch` approval (second `generateObject` pass in digest job)
- Meeting-proposal detection to `calendar_change` approval (third pass or separate handler path)
- Project-feedback RAG capture (`source_kind='whatsapp'` into existing chunker; no new tables)

**Permanently deferred or rejected:**
- Outbound message send via Baileys -- highest ban-risk action; not v2.1 scope at all
- 1:1 DM ingestion -- third-party consent problem; requires separate per-conversation opt-in design
- Media blob storage -- GB-scale for active groups; not needed for text digest value
- Historical backfill -- Baileys `fetchMessageHistory` confirmed flaky (GitHub issue #2452); do not promise
- Auto-track all groups by default -- privacy violation; default is all-untracked

### Architecture Approach

The WhatsApp integration is a peer service alongside `SyncOrchestrator`, not a capability of it. A `WhatsAppSessionManager` singleton owns the single Baileys socket lifecycle (WhatsApp allows one connection per linked-device slot). It is constructed inside the `onDbReady` callback in `ipc/index.ts` -- the same post-unlock pattern as `SyncOrchestrator`, `createFolderRegistry`, and the entitlement service. A `provider_account` row (`provider_key='whatsapp'`) reuses the existing account-management UI, status tracking, and disconnect cascade, but does NOT participate in `scheduleAccount`, `tickAccount`, or `provider_sync_state` -- `isMailCalendarAccount()` in the sync orchestrator already excludes it with no change needed.

Migration 138 adds four tables (`whatsapp_auth_state`, `whatsapp_group`, `whatsapp_message`, `whatsapp_group_digest`) and rebuilds `provider_account` to extend its CHECK constraint. This rebuild MUST use `PRAGMA legacy_alter_table=ON` to prevent SQLite from silently rewriting `provider_sync_state`'s FK to point at `provider_account_old` -- the exact pitfall fixed in migration 135. Auth state (Signal Protocol creds + signal keys) lives inside the SQLCipher envelope in `whatsapp_auth_state`, never as flat JSON files. Digest cron runs at 05:00 (before briefing at 07:00) via the shared `SchedulerHandle`.

**Major components:**
1. `whatsapp/session-manager.ts` -- singleton Baileys socket; state machine (idle/linking/qr-pending/connected/disconnected); exponential backoff 1s/2s/4s/8s/30s cap; hard non-reconnect on 401/403/440/500; `markOnlineOnConnect:false` passive posture; nightly socket recycle at 03:00 for memory leak mitigation
2. `whatsapp/auth-state.ts` -- `useSQLiteAuthState(db)`: SQLCipher-backed `AuthenticationState`; every `keys.set()` wrapped in `db.transaction()` for atomicity; `makeCacheableSignalKeyStore` adds LRU over raw store; `BufferJSON.replacer/reviver` for serialization
3. `whatsapp/ingest.ts` -- `messages.upsert` handler; `type!=='notify'` guard (line 1); `@g.us` DM-exclusion (line 2); `is_tracked` DB check (line 3, before any write or log); text-only extraction; messages buffered and batch-flushed via `p-queue` transaction (NOT synchronous `db.run()` per event)
4. `whatsapp/group-sync.ts` -- `groups.upsert` + `group-participants.update` handlers; upsert `whatsapp_group`; new-group join notification
5. `whatsapp/digest-cron.ts` -- `runWhatsAppDigest`; cron `'0 5 * * *'`; `getLocalModel()` called unconditionally (no routing, no classifier); Zod `DigestSchema`; idempotent `INSERT OR REPLACE (jid, date)`
6. `ipc/whatsapp.ts` -- IPC registrar; exports `WHATSAPP_CHANNELS` const array for `removeHandler` loop; DB-null guard returns `{ error: 'DB_NOT_OPEN' }`
7. `migrations/138_whatsapp.sql` -- 4 new tables + `provider_account` CHECK constraint rebuild with `PRAGMA legacy_alter_table=ON`

### Critical Pitfalls

All 12 researched pitfalls map to the foundation phase -- none can be deferred. The five most load-bearing:

1. **Outbound sends in passive posture [HARD GATE + STATIC RATCHET]** -- Baileys emits ACKs and presence updates by default. Set `markOnlineOnConnect:false`, call `sock.sendPresenceUpdate('unavailable')` on connect, `emitOwnEvents:false`. Write the grep ratchet before the first socket connect: no `sendMessage`/`sendReceipt` in `WhatsAppSessionManager` beyond suppression calls. This is the fastest path to a ban.

2. **Auth state corruption on unclean shutdown** -- partial `keys.set()` writes on crash corrupt Signal sessions, producing Bad MAC decryption errors and forced logout. Every `authState.keys.set()` must be wrapped in a single `db.transaction()`. Never use `useMultiFileAuthState` in production (Baileys docs: "do not use in prod, purely for demo purposes").

3. **Reconnect loop becomes a ban signal** -- naively reconnecting on any `connection.close` produces a credential-stuffing pattern visible to WhatsApp detection. Classify: 401/403/440/500 = non-recoverable, no reconnect. All other codes = exponential backoff (5s/15s/60s/300s/600s cap +/- 20% jitter), hard cap at 5 failures to `status='degraded'`. Wire `powerMonitor` suspend/resume.

4. **Frontier LLM prohibition [STATIC RATCHET]** -- group chat content is third-party PII; group members did not consent to cloud processing. `runWhatsAppDigest` calls `getLocalModel()` unconditionally -- no `router.classify()`, no routing step. The static ratchet (grep test that WhatsApp source files never import `getFrontierModel`) must be written alongside the first `generateObject` call.

5. **Supply-chain exact-pin + committed lockfile** -- confirmed December 2025 incident: malicious fork `lotusbail` (56K downloads) exfiltrated WhatsApp session tokens. Only `@whiskeysockets/baileys` at exact version (no caret/tilde). `pnpm-lock.yaml` committed. CI runs `--frozen-lockfile`. Never install any other package named `baileys` or similar.

**Additional load-bearing pitfalls (all foundation phase):**
- Single-instance socket guard: `if (this.socket) await this.disconnect()` before every `makeWASocket()`; status 440 = no reconnect
- Memory leak ~0.1 MB/msg (GitHub issue #2090, open/unresolved): extract fields, discard Baileys event object immediately; schedule nightly socket recycle at 03:00
- Batch SQLite writes: buffer messages in-memory, flush every ~2s via `p-queue` in a single transaction -- never synchronous `db.run()` inside a Baileys event handler
- WhatsApp as degradable capability: briefing must generate without WhatsApp; `gatherWhatsAppDigests` wraps in try/catch returning `[]`; socket startup failure must not block app boot

---

## Implications for Roadmap

This milestone maps onto a three-wave build. Phase numbering continues from v2.0 (parked at Phase 17); Phase 20 is the first v2.1 phase.

### Phase 20: Foundation -- Socket, Auth, Ingest, IPC, UI

**Rationale:** Every subsequent phase depends on an operational socket with encrypted auth state, working privacy filter, and live IPC channels. All 12 security/safety pitfalls must be addressed here. Nothing in this phase is deferrable without creating a security or reliability hole.

**Delivers:** `makeWASocket` connected; QR link flow (ban-risk consent modal with secondary-number recommendation, countdown indicator, no-history-before-link copy); group discovery populated; tracked-group messages stored in `whatsapp_message`; `provider_account` row created and disconnect cascade working; AccountRow connection status display; 30-day retention sweep in `sweep-cron`

**Hard gates that must land in this phase (written before first socket connect):**
- `markOnlineOnConnect:false` + `sendPresenceUpdate('unavailable')` in socket config
- Static grep ratchet: no `sendMessage`/`sendReceipt` in `WhatsAppSessionManager` (except suppression calls)
- Static grep ratchet: no frontier LLM import in `src/main/whatsapp/`
- `db.transaction()` wrapper on every `authState.keys.set()`
- Reconnect reason classification (401/403/440/500 = non-recoverable, no reconnect attempt)
- Nightly socket recycle at 03:00 scheduled from day one
- Message ingestion batch-flushed via `p-queue` (NOT synchronous per-event `db.run()`)
- `type!=='notify'` as line-1 of `messages.upsert` handler
- `@g.us` filter + `is_tracked` DB check as lines 2-3 (before any write or log)
- `pnpm-lock.yaml` committed with `@whiskeysockets/baileys@6.7.23` exact version
- `externalizeDepsPlugin exclude: ['@whiskeysockets/baileys']` in `electron.vite.config.ts`
- Migration 138 uses `PRAGMA legacy_alter_table=ON` around `provider_account` rename

**Build order within phase:** migration 138 -> auth-state.ts -> session-manager.ts -> group-sync.ts -> ingest.ts -> ipc/whatsapp.ts (canonical channel array) -> ipc/index.ts pre-unlock stubs + onDbReady wiring -> ipc/provider-accounts.ts disconnect cascade -> renderer (QR modal, AccountRow, group picker, disconnect modal)

**Research flag:** No additional phase research needed. All integration points verified against live source files. Follow ARCHITECTURE.md build order exactly.

---

### Phase 21: Digest + Briefing Integration

**Rationale:** After Phase 20, `whatsapp_message` rows exist for tracked groups. The digest cron and briefing integration are independent of the socket lifecycle -- they are a read-only query + Ollama call + briefing section render. Keeping them separate from Phase 20 maintains session-sized scope and ensures the privacy filter is verified before any LLM call touches stored content.

**Delivers:** `runWhatsAppDigest` cron at 05:00; per-tracked-group exec-framed summaries in `whatsapp_group_digest`; WhatsApp section visible in the daily briefing (one named sub-section per group); graceful Ollama-unavailable degradation

**Key invariants:**
- `getLocalModel()` called unconditionally in `runWhatsAppDigest` -- no routing, no classifier
- Digest cron at `'0 5 * * *'` (before briefing at `'0 7 * * *'`)
- `UNIQUE(jid, date)` on `whatsapp_group_digest` -- idempotent re-runs safe
- Empty `payload.whatsapp[]` hides section in renderer (no empty-state clutter)
- Ollama unavailable -> `gatherWhatsAppDigests` returns `[]` -> briefing proceeds without error

**Research flag:** Digest prompt tuning is empirical. Exec-framing structure is locked; actual system/user prompt text should be drafted during plan phase and iterated in UAT.

---

### Phase 22: Extraction Consumers (Deferred -- post-Phase 21 validation)

**Rationale:** Zero schema additions needed. All three consumers read `whatsapp_message` rows that already exist after Phase 20. Each is an additional `generateObject` pass layered onto the digest job, routing output through existing `assertApproved` and RAG pipelines. Must wait for Phase 21 digest quality to be validated.

**Delivers:** Action-item extraction to `task_batch` approval queue; meeting-proposal detection to `calendar_change` approval queue; project-feedback RAG capture (`source_kind='whatsapp'` into existing chunker, no new tables)

**Research flag:** Needs brief research on `assertApproved` integration shape for action-item schema and whether RAG corpus filter needs changes. Expected low-effort -- all pipelines exist.

---

### Phase Ordering Rationale

- Migration 138 is the first file written. The `PRAGMA legacy_alter_table=ON` guard is known from migration 135 and must be applied from the start.
- Foundation (Phase 20) must smoke-test before Phase 21. The privacy filter must be verified in isolation before any LLM call processes stored content.
- The IPC `removeHandler` loop pattern (from MEMORY: reference_electron_ipc_double_register) must cover all 5 WHATSAPP invoke channels in Phase 20 -- not discovered later when the handler-count test fails.
- `syncFullHistory:false` must be set explicitly in `makeWASocket` config (not left as default undefined) to prevent a write storm on first link.
- Phase 22 extraction consumers must follow Phase 21 UAT confirming digest quality is high enough that extracted items would be trusted.

### Research Flags

- **Phase 20:** No additional research needed. Standard patterns verified against live source files.
- **Phase 21:** Digest prompt text is an open question. Structure is locked; content needs drafting and UAT iteration.
- **Phase 22:** Brief research needed on `assertApproved` integration schema and RAG corpus filter. Expected low-effort.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions live-verified against npm registry 2026-06-09; ESM type field, peer deps, transitive deps confirmed; electron-vite ESM externalize pattern verified against live config |
| Features | HIGH / MEDIUM | Baileys event API, QR mechanics, history backfill limits HIGH via Context7 + official WhatsApp engineering blog; ban probability MEDIUM -- behavior-based enforcement assessed from community patterns, not controlled data |
| Architecture | HIGH | All integration points verified against live Aria source files at HEAD; migration 135 FK-rewrite pattern confirmed; IPC patterns verified |
| Pitfalls | HIGH / MEDIUM | Technical pitfalls corroborated across multiple primary GitHub issues; passive-use ban rate MEDIUM -- community-assessed, no controlled study exists |

**Overall confidence:** HIGH for all technical decisions. The genuine uncertainty is passive-use ban probability, which is inherently unquantifiable and is mitigated (not eliminated) by the consent modal + passive-posture socket config.

### Gaps to Address During Planning

- **`account_id` sentinel value** -- use phone JID (from `creds.me.id` after link) as `account_id` so AccountRow can display it without a separate lookup. Confirm during plan phase.
- **QR vs pairing-code modal** -- ship QR in Phase 20 (universal UX expectation); pairing code is a future enhancement. Lock this in plan phase.
- **`syncFullHistory:false` explicit vs omit** -- set it explicitly to document intent and prevent accidental override. Confirm in plan phase.
- **30-day sweep placement** -- extend existing `sweep-cron` (recommended by ARCHITECTURE.md) vs bundle with nightly socket recycle. Confirm timing to avoid overlap with digest cron.
- **Digest prompt text** -- structural framing is locked; actual system/user prompt content needs drafting in plan phase and iteration in UAT. Highest-uncertainty deliverable in Phase 21.

---

## Sources

### Primary (HIGH confidence)
- npm registry (npm view @whiskeysockets/baileys --json, 2026-06-09) -- versions, dist-tags, module type, peer deps confirmed live
- GitHub WhiskeySockets/Baileys src/Types/ (HEAD, 2026-06-09) -- AuthenticationState, SignalDataTypeMap, DisconnectReason enum, BaileysEventMap
- GitHub WhiskeySockets/Baileys Example/example.ts (HEAD) -- makeWASocket wiring, makeCacheableSignalKeyStore pattern
- baileys.wiki/docs/socket/connecting -- useMultiFileAuthState production warning
- baileys.wiki/docs/socket/configuration -- markOnlineOnConnect, emitOwnEvents, getMessage
- baileys.wiki/docs/migration/to-v7.0.0 -- LID breaking changes, ACK removal, WASM dep
- Baileys GitHub issue #2452 -- fetchMessageHistory on-demand backfill confirmed unreliable
- Baileys GitHub issue #2090 -- 0.1 MB/msg memory leak (open/unresolved as of 2026-06)
- Baileys GitHub issues #1929, #1990 -- version auto-fetch failures
- Baileys GitHub issue #1869 -- ban waves affect passive users
- engineering.fb.com/2021/07/14/security/whatsapp-multi-device -- history bundle at link time
- faq.whatsapp.com/653480766448040 -- message history on linked devices
- BleepingComputer -- lotusbail malicious npm supply-chain attack confirmed incident
- electron-vite.org/guide/troubleshooting -- externalizeDepsPlugin exclude for ESM packages
- Aria live source files at HEAD: ipc/index.ts, ipc/gmail.ts, ipc/provider-accounts.ts, briefing/generate.ts, integrations/sync-orchestrator.ts, migrations/011_provider_accounts.sql, migrations/135_repair_approval_child_fks.sql, electron.vite.config.ts

### Secondary (MEDIUM confidence)
- kraya-ai.com -- WhatsApp automation ban risk; ML detection signals; passive vs active risk assessment
- wapisimo.dev -- unofficial API ban risk; behavior-based enforcement; passive-read rate
- n8n.io/workflows/8442 -- automated daily WhatsApp summaries; competitor pattern (GPT-4.1, cloud-based)
- gistgem.com/blog/manage-multiple-whatsapp-groups-ai -- exec-framing competitor patterns; per-group vs cross-group
- rosello-mallol.com -- GDPR and WhatsApp group messages; third-party consent; personal-use exemption scope

---

*Research completed: 2026-06-09*
*Ready for roadmap: yes*

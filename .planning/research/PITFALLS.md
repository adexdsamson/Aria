# Pitfalls Research

**Domain:** Adding an unofficial Baileys WhatsApp integration to a local-first Electron desktop AI assistant (Aria v2.1)
**Researched:** 2026-06-09
**Confidence:** HIGH for ban mechanics + Baileys operational issues (corroborated across multiple GitHub issues + official docs); HIGH for supply-chain risk (confirmed incident); MEDIUM for passive-use ban probability (realistic assessment from community reports, no controlled study exists); MEDIUM for privacy/legal defensibility (guidance extrapolated from GDPR sources, not legal advice)

> **Phase numbering:** v2.1 continues from Phase 20 (v2.0 parked after Phase 17). Phase labels below are suggested guidance for the roadmapper; the two non-negotiable gates are flagged **[HARD GATE]** and **[STATIC RATCHET]**.

---

## Critical Pitfalls

### Pitfall 1: Sending ANY message — not just automation, but any output — through the Baileys socket (THE HARDEST BAN TRIGGER)

**What goes wrong:**
Baileys sends various non-human outputs through the socket by default: delivery receipts (ACKs), presence updates (`online`/`composing`), read receipts, and app-state sync signals. Even if Aria never calls `sendMessage()`, some of these background signals deviate from legitimate WhatsApp Web behavior patterns that WhatsApp's ML detection scores. If any code path sends an outbound message frame — even a well-intentioned "typing stopped" presence update — for an account that WhatsApp has flagged as suspicious, the ban trigger fires faster and harder.

**Why it happens:**
Developers scope "read-only" narrowly to mean "I don't call `sendMessage()`," while Baileys still emits ACKs and presence on the socket by default. The distinction between passive ingestion and background protocol chatter is invisible at the application layer.

**How to avoid:**
- Set `markOnlineOnConnect: false` in the `makeWASocket` config to prevent the socket advertising `online` on connect (which suppresses phone push notifications and reduces the presence-advertisement footprint).
- Follow up with `await sock.sendPresenceUpdate('unavailable')` immediately after connect to explicitly go dark.
- Set `emitOwnEvents: false` to prevent the socket echoing your own events.
- **[HARD GATE]** Grep-ratchet: `WhatsAppSessionManager` MUST NOT import or call any send/message/presence function except the two suppression calls above. This must be a static test checked on every PR, not a code-review hope.
- As of Baileys v7.0.0, the library stopped sending ACKs on delivery because "WhatsApp seems to be banning users for this" — confirm the version in use has this fix.
- Never send read receipts (do not call `sendReadReceipts`). Read receipt automation has been explicitly linked to ban waves.

**Warning signs:**
- Any `sock.sendMessage()`, `sock.sendReceipt()`, `sock.updatePresence()` call-site in `WhatsAppSessionManager` outside the initial suppress sequence.
- A code review shows "helpful" status updates (e.g., "mark group messages as read so the phone stays clean").

**Phase to address:** Foundation phase (link + ingest). Wire the ratchet before the socket is connected for the first time.

---

### Pitfall 2: The ban is REAL even for passive ingestion — but manageable. Don't undersell it to the user.

**What goes wrong:**
Two failure modes: (a) the developer convinces themselves "read-only = safe" and ships without the explicit ban-risk consent UI, and the user's primary personal number is banned; (b) the developer over-reads the risk, adds friction so extreme nobody links, and the feature fails for the wrong reason. The nuanced truth: passive Baileys ingestion carries **lower but non-zero** ban risk, primarily from protocol fingerprinting (the socket's TLS fingerprint, user-agent string, and protocol behavior are identifiable as Baileys, not a real WhatsApp Web browser tab), not from message volume. Ban waves periodically sweep unofficial clients indiscriminately.

**Why it happens:**
Risk is genuinely ambiguous. The confirmed ban triggers are: (1) sending bulk/automated messages, (2) running ACKs/receipts at machine speed, (3) rapid reconnect loops (looks like credential stuffing), (4) stale WA Web version string, (5) indiscriminate ban sweeps. Passive listeners who present the correct version string, reconnect gently, and send nothing are materially lower risk — but "lower" is not "zero."

**How to avoid:**
- **Explicit consent modal at link time** (already locked in the milestone context). The modal must say, in plain language: "Aria connects as a WhatsApp Web companion device using an unofficial library. WhatsApp does not endorse this. Your account could be suspended. We recommend linking a secondary number if you use WhatsApp for critical business."
- Offer a "secondary number recommendation" path in the UI: a Google Voice or carrier secondary SIM used for group tracking is a common community pattern that limits blast radius.
- Passive-mode hardening (see Pitfall 1) reduces risk but does not eliminate it.
- Surface ban status detection: if the socket receives a `401 / logged_out` or a WhatsApp-side "account at risk" signal, surface it immediately as a non-dismissable banner so the user can react before a permanent ban.

**Warning signs:**
- Link modal has no explicit ban-risk language.
- No secondary-number suggestion in onboarding.
- Ban detection (`'connection.update'` with `lastDisconnect.error.output?.statusCode === 401`) is not wired to a user-visible alert.

**Phase to address:** Foundation phase. The consent modal ships with the first QR screen; ban-detection wiring ships with the socket lifecycle.

---

### Pitfall 3: Session / auth-state corruption on unclean shutdown

**What goes wrong:**
Baileys stores session keys (Signal Protocol encryption state) in the auth state. If the Electron app is force-quit, crashes, or the machine loses power while a key-update write is in flight, the persisted auth state diverges from WhatsApp's server-side view. The next connect attempt produces `Bad MAC` decryption errors for every incoming message, a reconnect loop, and eventually a forced logout requiring the user to re-scan the QR code. This is confirmed by multiple open GitHub issues.

**Why it happens:**
The built-in `useMultiFileAuthState` writes JSON files on every key change — it is explicitly documented as "DONT USE IN PROD, purely for demo purposes, consumes a lot of IO." Aria's SQLCipher DB is the right home for auth state but the migration must handle transaction atomicity: a partial write (app crash mid-save) must not leave the DB in a state where Signal sessions are inconsistent.

**How to avoid:**
- Implement a `useSQLiteAuthState` adapter backed by the existing `better-sqlite3` + SQLCipher DB (migration 138, `whatsapp_auth_state` table). Use a single `db.transaction(() => { ... })()` wrapper for every `authState.keys.set()` call so a crash mid-write rolls back atomically, not partially.
- Never use `useMultiFileAuthState` in production; treat it as test-only scaffolding.
- On `connection.update` with `lastDisconnect.error` caused by `DisconnectReason.badSession` or `DisconnectReason.loggedOut`, delete the auth-state rows and transition the `provider_account` row to `status='needs-auth'` to prompt re-link rather than reconnect-looping.
- Store a `session_generation` counter in `provider_account`; increment it on each re-link. Stale key rows from a previous generation are cleaned up on next successful connect.

**Warning signs:**
- Auth state persisted to flat JSON files or to the DB without a transaction wrapper.
- `Bad MAC` errors in logs after app restart.
- Reconnect loop that never settles (exponential-backoff counter not checked; loop not halted after N failures).

**Phase to address:** Foundation phase. The auth-state adapter is the first thing written before the socket opens.

---

### Pitfall 4: `stream:error (conflict)` from running two socket instances against the same credentials

**What goes wrong:**
WhatsApp permits only one active connection per "linked device" slot. If two Electron windows, two app instances, or a crashed-but-not-cleaned-up socket plus a fresh one both try to connect with the same credentials, WhatsApp terminates both with `stream:error type='conflict'` / status 440. On Aria's Windows single-instance enforcement (already in place via `app.requestSingleInstanceLock()`), this should not happen normally — but it can happen during development (two terminals), during hot-reloading if the old socket is not destroyed before the new one opens, or if the existing single-instance guard is bypassed in a test harness.

**Why it happens:**
The `makeWASocket()` call is not gated by a guard that checks whether a socket is already live before creating a new one. Hot-reload destroys the module but not the open WebSocket.

**How to avoid:**
- `WhatsAppSessionManager` is a singleton with a guard: `if (this.socket) { await this.disconnect(); }` before every `makeWASocket()` call.
- Wire into Aria's existing `app.requestSingleInstanceLock()` path; the WhatsApp socket must not start if lock is not held.
- On `stream:error conflict` in `connection.update`, log and halt reconnection (this is NOT a transient error; reconnecting immediately makes it worse by triggering a ban signal).
- In dev mode, add a `beforeExit` handler that calls `sock.end()` so hot-reloads leave the socket in a known closed state.

**Warning signs:**
- Multiple `makeWASocket()` instantiations without a prior `end()` guard.
- `stream:error (conflict)` in logs followed by an immediate reconnect attempt.
- Integration tests that call the session manager without the single-instance guard.

**Phase to address:** Foundation phase, socket lifecycle design.

---

### Pitfall 5: Reconnect loop — uncontrolled retry turns a transient disconnect into a ban signal

**What goes wrong:**
Baileys' `connection.update` fires `connection: 'close'` on any disconnect. Naively reconnecting immediately and unconditionally (the first `connection.update` example in every tutorial) means a flaky network condition produces dozens of reconnect attempts per minute. WhatsApp's detection treats rapid reconnect bursts as credential-stuffing and escalates to a ban.

**Why it happens:**
The tutorial "just reconnect if it closes" pattern has no backoff, no cap, and no distinction between recoverable disconnects (network blip) and non-recoverable ones (401 loggedOut, 440 conflict, 403 account_banned).

**How to avoid:**
- Classify disconnect reasons strictly:
  - **Non-recoverable (do NOT reconnect):** `DisconnectReason.loggedOut (401)`, `DisconnectReason.badSession`, status 403 (banned), status 440 (conflict). Transition to `status='needs-auth'` or `status='banned'` and surface in UI.
  - **Recoverable (reconnect with backoff):** network errors, timeout (428), restart required (515).
- Exponential backoff for recoverable disconnects: 5s → 15s → 60s → 300s → 600s (cap). Add ±20% jitter.
- Hard cap at 5 consecutive reconnect failures → transition to `status='degraded'`, stop retrying, notify user.
- Wire into `powerMonitor` (`suspend`/`resume` events): suspend the socket on sleep, reconnect once on wake (not immediately — 3–5s delay to let the network re-establish).

**Warning signs:**
- Any `connection.update` handler that reconnects unconditionally on `connection: 'close'`.
- No distinct handling for `statusCode === 401` vs `statusCode === 428`.
- No reconnect-attempt counter with a ceiling.

**Phase to address:** Foundation phase, socket lifecycle.

---

### Pitfall 6: WA Web version drift — stale version string causes protocol rejection or ban

**What goes wrong:**
Baileys presents a WhatsApp Web version string during the handshake. If this string is too old, WhatsApp's servers reject the connection with a 405 `Method Not Allowed`. If it is too new (set by blindly calling `fetchLatestWaWebVersion()` every connect), it may present a version WhatsApp's server hasn't seen from this device fingerprint before, which triggers fingerprinting alerts. There is also a documented bug where `fetchLatestBaileysVersion()` returns a recently-deprecated version that immediately fails.

**Why it happens:**
Developers see `fetchLatestWaWebVersion` in the docs and add it to every connect to "stay current," not realizing the recommendation is to NOT call it every time.

**How to avoid:**
- Do NOT call `fetchLatestWaWebVersion()` on every connect. Baileys' documentation explicitly states: "It is not recommended to set the latest version on your socket every time you connect — you may face incompatibility."
- Pin the version to a tested value in a config constant. Monitor Baileys releases and only update the pinned version after testing.
- Add a startup check: if the pinned version is more than N months behind the current Baileys release, log a warning in the diagnostic panel to prompt the developer to review.
- Track Baileys releases via GitHub releases RSS or a scheduled GitHub API check; treat a new Baileys version as a potential breaking change requiring validation before deploying.

**Warning signs:**
- `fetchLatestWaWebVersion()` called inside the `makeWASocket` options.
- Version string never reviewed after initial setup.
- Connection fails with HTTP 405 or immediately closes after handshake.

**Phase to address:** Foundation phase (initial socket config) + ongoing maintenance.

---

### Pitfall 7: Baileys library maintenance cadence — integration goes dark when WhatsApp ships a protocol update

**What goes wrong:**
Baileys is a reverse-engineered library that tracks WhatsApp's undocumented WebSocket protocol. When WhatsApp ships a protocol update (approximately every 2–4 months), Baileys may break entirely: the connection fails, messages are not delivered, or decryption fails. The v7.0.0-rc.9 release in early 2026 had a 100% connection failure bug in the auth handshake. Between a WhatsApp protocol change and a Baileys fix being merged, tested, and released, the integration can be completely dark for days to weeks.

**Why it happens:**
The library is maintained by community volunteers, not a funded team. WhatsApp actively obfuscates protocol changes. There is no SLA or compatibility guarantee.

**How to avoid:**
- The app must treat the WhatsApp integration as an **optional, degradable** capability with three explicit states: `'connected'` / `'degraded'` / `'needs-auth'`. Never block the app boot or the daily briefing on WhatsApp availability.
- On startup, if the Baileys socket cannot connect within a timeout (e.g. 30s) after N retries with backoff, set state to `'degraded'` and continue. The daily briefing runs without WhatsApp data.
- Surface the degraded state in the UI: "WhatsApp unavailable — may need an app update." Do not silently drop WhatsApp from the briefing with no explanation.
- Monitor the `WhiskeySockets/Baileys` GitHub releases feed. Subscribe to release notifications. A new major/minor version is a potential breaking change that needs re-testing before shipping in a Aria update.
- Pin Baileys to a minor version (`~7.x.x` not `^7.x.x` or `latest`) to avoid auto-pulling breaking RC releases.
- Write an integration smoke test (not mocked) that connects to a real WhatsApp account in a staging phone and verifies a group message is received within 60s. Run this in CI on Baileys dependency updates.

**Warning signs:**
- Baileys pinned to `latest` or without a lock.
- App boot waits for WhatsApp socket readiness.
- No degraded-state UI; briefing silently missing WhatsApp section.
- Last Baileys version review was more than 8 weeks ago.

**Phase to address:** Foundation phase (degraded-state architecture), digest phase (verify briefing gracefully omits WhatsApp when degraded).

---

### Pitfall 8: Supply-chain attack — malicious Baileys fork on npm

**What goes wrong:**
In December 2025, a malicious npm package named `lotusbail` (a Baileys fork with 56,000 downloads) stole WhatsApp session tokens, intercepted messages, and silently paired attacker-controlled devices to victims' accounts. A second malicious fork `@dappaoffc/baileys-mod` injected code starting at version 8.0.1. Because Baileys forks are plentiful and similar-sounding, package confusion is a real attack vector. The stolen credentials give the attacker persistent access even after the package is uninstalled.

**Why it happens:**
Many developers add a "Baileys fork with feature X" from a blog post without checking the npm package name against the canonical `@whiskeysockets/baileys`. npm's ecosystem has no code-signing requirement. Name-squatting and fork confusion are easy.

**How to avoid:**
- **Only ever install `@whiskeysockets/baileys`** — the canonical package. Lock the exact version in `package.json` (use `=` not `^` or `~`) and commit `pnpm-lock.yaml`. Never accept PRs or documentation suggestions to switch to any other Baileys package name without auditing the source.
- Run `npm audit` and Socket.dev package audits on every dependency update.
- After installing or updating Baileys, verify the installed package checksum against the npm registry. CI should fail on lockfile drift.
- If a "fork" is needed for a feature, fork the canonical repo directly, do not use a third-party npm fork.

**Warning signs:**
- `package.json` lists `baileys`, `baileys-extended`, `lotusbail`, or any name that is not `@whiskeysockets/baileys`.
- A blog tutorial or PR suggests switching to a different package.
- `pnpm-lock.yaml` not committed or CI not running `--frozen-lockfile`.

**Phase to address:** Foundation phase (dependency setup); enforced by lock file from day one.

---

### Pitfall 9: Third-party PII storage — group messages contain other people's content

**What goes wrong:**
Every tracked group message stored on disk includes the sender's phone number, display name, and message text — data the sender never consented to have collected by Aria. In EU/UK jurisdictions, this is third-party personal data under GDPR/UK GDPR. Even in less regulated jurisdictions, storing group content in a local SQLite DB that could be subpoenaed or exfiltrated creates exposure. The specific danger for Aria: if the user ever uses "export data" or "attach logs to a bug report" features, group-member contact data leaks.

**Why it happens:**
Developers store the full message object for completeness ("I might need it later"), not realizing that phone numbers and display names are personal data. Local-only storage feels safe, but it is not exempt from data-subject rights or legal discovery.

**How to avoid:**
- **[HARD GATE]** Group messages sent to the frontier LLM (Anthropic/OpenAI/Google) is a hard architectural prohibition — already locked in the milestone. Enforce this as a static ratchet: the WhatsApp summarization call site must use `ollama`/local-only, never the frontier provider.
- Minimize PII in storage: store sender JID (hashed or pseudonymized) for deduplication, not raw phone numbers or display names, unless display name is needed for the digest. Provide a clear in-app retention and deletion policy.
- The 30-day rolling retention window (already locked) limits accumulation.
- Bug-report / log-export features must explicitly exclude `whatsapp_message` and `whatsapp_group` tables. The export code must have a deny-list, not an allow-list.
- Document the privacy posture in the consent modal: "Group messages are stored on your device only, for 30 days, summarized locally. They are never sent to any cloud service."
- For EU users: this is a "personal use" processing activity (GDPR Art. 2(2)(c) household/personal activity exemption may apply), but only as long as the app is genuinely personal-use, never redistributed as a SaaS, and data never leaves the machine.

**Warning signs:**
- Any call to `generateText` / `streamText` from the AI SDK with WhatsApp message content AND a non-Ollama provider.
- Bug-report export includes `whatsapp_*` tables.
- No retention sweep running to enforce 30-day window.
- Sender phone numbers stored in plaintext in the DB (vs. hashed).

**Phase to address:** Foundation phase (schema design + ratchet); digest phase (retention sweep); deferred phases (extraction pipelines must not route to frontier).

---

### Pitfall 10: Memory growth from message buffers — 0.1MB per message leak in Baileys 7.x

**What goes wrong:**
A confirmed open bug in Baileys 7.0.0-rc.8 (GitHub issue #2090, status: open/unresolved as of June 2026): Node.js heap grows by approximately 0.1MB per message received, with no GC reclamation. For a heavy group chat (hundreds of messages/day across multiple groups), an Electron process running all day accumulates hundreds of MB of unreleased heap. On a 16GB exec laptop already running Ollama + the Electron app, this is a real crash vector over multi-day sessions.

**Why it happens:**
Baileys internally holds references to message events that prevent GC. The upstream bug is unpatched. Aria's `WhatsAppSessionManager` sits in the Electron main process and shares the V8 heap with the rest of the app.

**How to avoid:**
- Monitor the `WhatsAppSessionManager` memory footprint: log `process.memoryUsage().heapUsed` on a 30-minute interval and alert (log + user-visible indicator) if the process heap exceeds a configurable threshold (default: 400MB over baseline).
- Implement a **nightly socket recycle**: at 3am (or on the next `powerMonitor` wake after 3am), gracefully close and reopen the Baileys socket to release accumulated heap. This is already necessary for the daily briefing window anyway.
- Do NOT store the raw Baileys message event objects in memory beyond the immediate ingestion handler. Extract the fields needed for `whatsapp_message` (group_jid, sender_jid, text, timestamp), write to SQLite, and discard the event object immediately. Retain no references.
- Track the upstream issue; when it is resolved, remove the nightly recycle workaround (with a comment and a link to the issue).

**Warning signs:**
- Heap climbing monotonically in production logs.
- No periodic socket recycle or memory monitoring.
- Raw Baileys message event objects stored in any array/Map/cache beyond the ingestion handler.

**Phase to address:** Foundation phase (ingestion handler design); socket lifecycle includes nightly recycle from day one.

---

### Pitfall 11: Electron main-process socket blocking the single SQLite writer

**What goes wrong:**
Aria's `better-sqlite3` writer is synchronous and single-writer. The Baileys event handlers in `WhatsAppSessionManager` fire on the Node.js event loop in the Electron main process. If a group chat floods with messages (a large exec group with 50+ members having an active thread), the event loop is saturated handling Baileys events + writing each message synchronously to SQLite. This blocks IPC responses to the renderer, making the UI feel frozen, and potentially blocks the daily briefing generation.

**Why it happens:**
The briefing integration is the first time Aria's main process has a high-frequency push event source (WhatsApp) alongside the existing low-frequency poll sources (email, calendar). The single-writer assumption was designed for occasional polls; continuous message streams require explicit buffering.

**How to avoid:**
- Batch SQLite writes: accumulate incoming messages in an in-memory queue and flush to SQLite at a fixed interval (e.g., every 2 seconds) using a single transaction, rather than writing one row per message event. Use the existing `p-queue` pattern to serialize the flush against other SQLite writers.
- Implement a per-group message rate limiter at the ingestion layer: if a group emits more than N messages in a T-second window, drop duplicates or batch them. The briefing digest does not need millisecond precision.
- The Baileys socket event handlers must be non-blocking: parse the event, push to the in-memory queue, return immediately. No synchronous SQLite calls inside an event handler.
- Add a circuit breaker: if the in-memory queue grows beyond M items (e.g., 1000), log a warning and stop ingesting until the queue drains, rather than consuming unbounded memory.

**Warning signs:**
- `db.prepare(...).run(...)` inside a Baileys `messages.upsert` event handler (synchronous call on the event thread).
- UI freezes during active group chats.
- IPC response latency metrics spike when WhatsApp is active.

**Phase to address:** Foundation phase (ingestion handler design — buffer-and-batch from day one, not as a retrofit).

---

### Pitfall 12: QR timeout and the "needs re-link" UX trap

**What goes wrong:**
The QR code for initial linking has a 3-minute TTL. If the user does not scan within that window, the code expires and the socket disconnects. If the UI does not clearly expire the QR display and offer "generate new QR," users try to scan a stale code, see nothing happen, and conclude the feature is broken. Additionally, if the socket disconnects during the QR flow (before linking completes), the partial auth state may be corrupted, requiring the user to clear it before trying again.

**Why it happens:**
QR display is often treated as a one-shot flow: generate, show, wait. The TTL and the need for regeneration are not handled in the happy-path demo.

**How to avoid:**
- Track QR code age client-side; after 2:30 (30s before TTL), display a "QR code expired — tap to refresh" prompt. On tap, call `sock.end()` and recreate the socket (which triggers a new QR).
- Never show a stale QR without a visible expiry countdown or expired state.
- If `connection.update` fires `connection: 'close'` during the QR flow (before `connection: 'open'`), wipe any partial auth state from the DB before prompting to try again (partial Signal pre-keys stored but no account linked = corrupt state on reconnect).
- On successful link (`connection: 'open'` + credentials saved), immediately transition from the QR screen to the group-selection screen; do not leave the user on a blank or loading state.

**Warning signs:**
- QR code displayed without a visible timeout indicator.
- No "refresh QR" affordance.
- Connection close during QR flow leaves stale rows in `whatsapp_auth_state`.

**Phase to address:** Foundation phase (QR link flow UI).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `useMultiFileAuthState` (the bundled demo helper) | Zero setup, works out of the box | Corrupts on unclean shutdown; non-atomic writes; heavy IO; explicitly documented "do not use in prod" | **Never in production**; test scaffolding only |
| Store raw Baileys event objects in a Map/cache | Easy access to message history | 0.1MB/message leak; heap OOM after multi-day run | **Never**; extract fields and discard the event immediately |
| Reconnect unconditionally on `connection.close` | "Always reconnects" feel | Rapid reconnect bursts trigger WhatsApp ban detection | **Never**; always classify disconnect reason + backoff |
| Call `fetchLatestWaWebVersion()` on every connect | "Always current" | Fingerprinting alerts; version incompatibility; connection failures | **Never on every connect**; pin tested version, review on Baileys release |
| Pin Baileys to `latest` or `^version` | Automatic updates | RC/beta breaks ship to users; supply-chain fork confusion | **Never**; pin to exact version with lock file |
| Route WhatsApp group content to frontier LLM | Better summaries | Violates local-first PII guarantee; third-party data leaves machine | **Never**; local Ollama only |
| Send message/ACK "just to keep the connection alive" | Avoids idle disconnect | Adds to send-activity footprint; accelerates ban risk | **Never**; use keepalive built into Baileys socket, not application-layer pings |
| Write `db.run()` inside Baileys event handler | Simple code path | Synchronous write blocks event loop; UI freezes on active groups | **Never**; buffer + batch flush |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Baileys socket init | Create socket without checking if one is already live | Guard: `if (this.socket) await this.disconnect()` before every `makeWASocket()` |
| Baileys auth state | Use `useMultiFileAuthState` | Implement `useSQLiteAuthState` with `db.transaction()` wrapper for atomic key updates |
| WhatsApp version string | Call `fetchLatestWaWebVersion()` on every connect | Pin tested version constant; review on Baileys releases only |
| Reconnect logic | Reconnect on any `connection.close` | Classify status code; exponential backoff; hard cap; no reconnect on 401/403/440 |
| Electron single-instance | Add WhatsApp socket without checking `requestSingleInstanceLock` | WhatsApp socket start must be gated on single-instance lock ownership |
| SQLite writes on message ingest | Synchronous `db.run()` per message event | Buffer messages in-memory; batch flush with `p-queue` on interval |
| Ollama summarization | Pass full message objects to the LLM | Extract and truncate text fields only; never pass JIDs, phone numbers, or raw message objects |
| Bug report / log export | Include all DB tables in export | Explicit deny-list: `whatsapp_message`, `whatsapp_group`, `whatsapp_auth_state` excluded from exports |
| npm dependency | Install any `baileys` package from a blog | Only `@whiskeysockets/baileys` at pinned exact version with lockfile |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous SQLite writes per message event | UI freezes; IPC latency spikes during active group chats | Buffer + batch flush every 2s via p-queue | Any group with >5 messages/min sustained |
| Raw Baileys event object retention | Heap climbs 0.1MB/message, never GC'd | Extract fields, discard event object immediately; nightly socket recycle | ~1000 messages/day = ~100MB/day accumulation |
| Socket reconnect loop | CPU peg; WhatsApp sees credential-stuffing pattern | Exponential backoff + reconnect cap + reason classification | Any network instability without backoff |
| All groups tracked with full history sync | First sync pulls months of history for each group; huge write storm | Track only from join date; `syncFullHistory: false` in socket config | First link with many active groups |
| Ollama summarization blocking daily briefing | Briefing generation delayed by group summary step | Run group summaries as background pre-computation before briefing cron fires | Groups with >500 messages in 24h |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Install non-canonical Baileys package | Credentials exfiltrated; attacker permanently paired to user's WhatsApp | Lockfile pinned to `@whiskeysockets/baileys` exact version; CI `--frozen-lockfile` |
| WhatsApp group content sent to frontier LLM | Third-party PII off-machine; local-first guarantee violated | **[STATIC RATCHET]** — static grep test: WhatsApp message data cannot reach non-Ollama AI SDK provider |
| Auth state stored without encryption | Session keys in plaintext on disk = anyone with disk access owns the WhatsApp session | All auth state in SQLCipher-encrypted DB (migration 138); never flat JSON files |
| Bug-report export includes WhatsApp tables | Group member PII (names, numbers, message content) leaked | Explicit deny-list in export code; test that export excludes these tables |
| No ban detection / account-at-risk surfacing | User discovers ban from their phone, not from Aria | Wire `connection.update` 401/403 to non-dismissable UI banner and `provider_account.status = 'banned'` |

---

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No explicit ban-risk consent at link time | User's primary number banned; trust destroyed | Explicit modal with secondary-number recommendation before QR is shown |
| QR code shown without expiry countdown | User tries stale QR, feature "doesn't work" | 2:30 countdown + "QR expired — refresh" prompt with auto-refresh |
| Degraded state silent (WhatsApp section just missing from briefing) | User confused; files bug thinking feature broken | Non-dismissable "WhatsApp unavailable" banner with last-successful-connection timestamp |
| Group selection absent (all groups ingested) | Third-party PII from unintended groups stored; privacy posture violated | Mandatory group selection step before any ingestion; untracked groups are never read or stored |
| No retention-expiry confirmation | Messages accumulated beyond 30 days; storage bloat | Show retention settings in account row; confirm deletion when user disconnects WhatsApp |
| "Reconnecting…" spinner with no timeout | User waits indefinitely; perceived hang | After 3 failed reconnects, show actionable "WhatsApp needs re-linking" prompt |

---

## "Looks Done But Isn't" Checklist

- [ ] **Ban-risk consent:** Verify the link modal contains explicit ban-risk language AND a secondary-number suggestion; not just a generic "connect WhatsApp" button.
- [ ] **Passive posture:** Verify `markOnlineOnConnect: false` + `sendPresenceUpdate('unavailable')` are set; grep for any `sendMessage` / `sendReceipt` call in `WhatsAppSessionManager` (should be zero except the suppress sequence).
- [ ] **Static ratchet — no frontier LLM for WhatsApp:** Verify a test asserts that WhatsApp message content cannot reach an Anthropic/OpenAI/Google provider call site.
- [ ] **Auth state atomicity:** Verify `authState.keys.set()` is wrapped in `db.transaction()`; verify no `useMultiFileAuthState` in production code paths.
- [ ] **Disconnect reason classification:** Verify `connection.update` handler has explicit branches for 401 (no reconnect), 440 (no reconnect), 403 (banned), vs recoverable codes with backoff.
- [ ] **Memory leak guard:** Verify no raw Baileys event objects stored beyond the ingestion handler; verify nightly socket recycle is scheduled.
- [ ] **SQLite write buffering:** Verify `db.run()` is NOT called inside a Baileys event handler; verify messages are batched before write.
- [ ] **Single instance guard:** Verify `makeWASocket()` cannot be called while another socket is live; verify integration with `app.requestSingleInstanceLock()`.
- [ ] **Bug-report exclusion:** Verify `whatsapp_message` / `whatsapp_group` / `whatsapp_auth_state` tables are excluded from any diagnostic export.
- [ ] **Degraded-state briefing:** Verify the daily briefing generates successfully and gracefully when `provider_account.status !== 'connected'` for WhatsApp.
- [ ] **npm lockfile:** Verify `@whiskeysockets/baileys` is at an exact pinned version with no semver range; `pnpm-lock.yaml` committed and CI uses `--frozen-lockfile`.
- [ ] **Retention sweep:** Verify a scheduled job runs to delete `whatsapp_message` rows older than 30 days.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Auth state corruption / Bad MAC after crash | LOW | Delete `whatsapp_auth_state` rows for the affected `provider_account`; set `status='needs-auth'`; prompt re-link via QR |
| Stream:error conflict (two instances) | LOW | Kill the duplicate process; the surviving instance reconnects normally on next app open |
| WhatsApp account temporarily banned | MEDIUM | Surface "account temporarily suspended" in UI; instruct user to open official WhatsApp app and follow appeal prompts; disconnect Aria integration until appeal resolved |
| WhatsApp account permanently banned | HIGH | No recovery path for the number. Aria must gracefully disable the WhatsApp integration; offer to archive local data or delete it. This is why secondary-number recommendation matters. |
| Baileys protocol break (library dark) | MEDIUM | Set all WhatsApp `provider_account` rows to `status='degraded'`; briefing omits WhatsApp section; surface "WhatsApp unavailable — check for Aria update" banner; monitor Baileys releases for fix. |
| Supply-chain attack (malicious package installed) | HIGH | Revoke WhatsApp session immediately from official WhatsApp app (Settings → Linked Devices → remove all); rotate any credentials stored near the session; audit what the malicious package could have accessed. |
| Heap OOM from message leak | LOW–MEDIUM | Force-restart the Electron app; nightly recycle mitigates; if severe, temporarily disable WhatsApp ingestion until memory is under control |

---

## Pitfall-to-Phase Mapping

> Phase numbering continues from v2.0 (which ended at Phase 17 parked). Suggested labels for roadmapper.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Outbound send in "passive" posture **[HARD GATE + STATIC RATCHET]** | Foundation (link + socket lifecycle) | Static grep: no `sendMessage`/`sendReceipt` except suppress calls; `markOnlineOnConnect: false` confirmed in config |
| 2. Ban risk — honest consent + secondary-number UX | Foundation (QR link flow) | Manual: consent modal reviewed; ban-detection `401` wired to UI banner |
| 3. Auth-state corruption on unclean shutdown | Foundation (auth-state adapter) | Test: kill app mid-write; verify next launch reconnects without Bad MAC; `useMultiFileAuthState` absent from prod code |
| 4. `stream:error conflict` from two instances | Foundation (socket lifecycle) | Integration test: two `makeWASocket()` calls against same creds = second call tears down first cleanly; single-instance lock gate asserted |
| 5. Reconnect loop / ban signal | Foundation (socket lifecycle) | Test: simulate 401 disconnect → no reconnect attempt; simulate network error → reconnect with backoff up to cap |
| 6. WA Web version drift | Foundation (socket config) + ongoing | Config constant present; `fetchLatestWaWebVersion()` absent from socket init; version pinned in lockfile |
| 7. Library maintenance / integration goes dark | Foundation (degraded-state architecture) + Digest | Briefing smoke test with WhatsApp `status='degraded'`: briefing generates; UI shows degraded banner |
| 8. Supply-chain (malicious fork) | Foundation (dependency setup) | Lockfile check: only `@whiskeysockets/baileys`; CI `--frozen-lockfile`; `npm audit` clean |
| 9. Third-party PII / frontier LLM **[STATIC RATCHET]** | Foundation (schema) + Digest (summarization) | Static ratchet: WhatsApp message data unreachable from non-Ollama AI call sites; export excludes WA tables |
| 10. Memory growth / heap leak | Foundation (ingestion handler) + Digest | Heap monitoring logs present; no raw event objects stored; nightly socket recycle scheduled |
| 11. Main-process socket blocking SQLite writer | Foundation (ingestion handler) | IPC latency test during simulated message flood; no synchronous `db.run()` in event handlers |
| 12. QR timeout / stale QR UX | Foundation (QR link flow UI) | Manual UAT: let QR expire; verify refresh prompt appears; verify stale auth rows cleaned on pre-link disconnect |

---

## Sources

- [High number of bans on WhatsApp! — WhiskeySockets/Baileys #1869](https://github.com/WhiskeySockets/Baileys/issues/1869) — ban wave affects passive users too; indiscriminate sweeps
- ["Your account may be at risk" warning — tulir/whatsmeow #810](https://github.com/tulir/whatsmeow/issues/810) — warning triggered on both passive and active clients using WhatsMeow and Baileys
- [Memory Leak 7.0.0-rc.8 — WhiskeySockets/Baileys #2090](https://github.com/WhiskeySockets/Baileys/issues/2090) — 0.1MB/message leak, open/unresolved
- [Baileys reconnect mobile rejects session — #2110](https://github.com/WhiskeySockets/Baileys/issues/2110) — reconnect after credential reuse triggers mobile-side rejection
- [Session is getting logged out / Bad MAC — #1976](https://github.com/WhiskeySockets/Baileys/issues/1976) — auth state corruption patterns
- [Bad MAC — #2234](https://github.com/WhiskeySockets/Baileys/issues/2234) — Signal session decryption errors from Baileys
- [Stream Errored (conflict) — openclaw #9094](https://github.com/openclaw/openclaw/issues/9094) — status 440 conflict from two simultaneous sessions
- [fetchLatestWaWebVersion getting bad request — #1929](https://github.com/WhiskeySockets/Baileys/issues/1929) — version fetch fails / returns deprecated version
- [fetchLatestBaileysVersion() breaks connection — #1990](https://github.com/WhiskeySockets/Baileys/issues/1990) — version auto-fetch causes connection failures
- [Baileys configuration docs — baileys.wiki](https://baileys.wiki/docs/socket/configuration/) — `markOnlineOnConnect`, `emitOwnEvents`, `getMessage`, `cachedGroupMetadata`
- [Baileys connecting docs — baileys.wiki](https://baileys.wiki/docs/socket/connecting/) — warning against `useMultiFileAuthState` in production
- [Baileys intro — baileys.wiki](https://baileys.wiki/docs/intro/) — ToS disclaimer, library scope, Node 17+ requirement
- [Migrate to v7.x.x — baileys.wiki](https://baileys.wiki/docs/migration/to-v7.0.0/) — LID mapping, breaking changes, ACK removal
- [Malicious npm package lotusbail steals WhatsApp accounts — BleepingComputer](https://www.bleepingcomputer.com/news/security/malicious-npm-package-steals-whatsapp-accounts-and-messages/) — supply-chain attack, 56K downloads, credential exfiltration
- [Malicious @dappaoffc/baileys-mod — Xygeni Security](https://xygeni.io/blog/malicious-npm-package-in-baileys-fork-skyzopedia-case/) — second malicious fork, injected newsletter subscription
- [WhatsApp reconnect loop lacks exponential backoff — openclaw #60626](https://github.com/openclaw/openclaw/issues/60626) — reconnect-loop ban risk
- [QR code 3-minute TTL / reconnection — Baileys connection lifecycle](https://whiskeysockets-baileys-94.mintlify.app/concepts/connection) — ACTIVE_LOGIN_TTL_MS, QR expiry, only `loggedOut` is non-recoverable
- [WhatsApp Automation Ban Risk — kraya-ai.com](https://blog.kraya-ai.com/whatsapp-automation-ban-risk) — ML detection signals: reply-ratio, contact-graph, temporal patterns
- [OpenClaw WhatsApp Risks — zenvanriel.com](https://zenvanriel.com/ai-engineer-blog/openclaw-whatsapp-risks-engineers-guide/) — passive vs active risk assessment
- [WhatsApp ToS — whatsapp.com/legal/terms-of-service](https://www.whatsapp.com/legal/terms-of-service) — prohibition on unauthorized applications and scraping
- [GDPR and WhatsApp group messages — rosello-mallol.com](https://www.rosello-mallol.com/en/work-whatsapp-groups-gdpr/) — third-party consent requirements for group member data
- Aria codebase: `CLAUDE.md` (stack decisions — `better-sqlite3` synchronous single-writer, `p-queue` LLM serialization, Ollama sidecar, safeStorage, `app.requestSingleInstanceLock`), `PROJECT.md` (v2.1 locked decisions — hybrid provider_account + WhatsAppSessionManager, local-only Ollama summarization, 30-day retention, migration 138 schema)

---
*Pitfalls research for: Baileys WhatsApp integration in Aria v2.1 (Electron main process, local-first, SQLCipher, approval-gated)*
*Researched: 2026-06-09*

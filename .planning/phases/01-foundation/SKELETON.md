# Walking Skeleton — Aria

**Phase:** 1
**Generated:** 2026-05-16

## Capability Proven End-to-End

A user launches Aria on Windows 11, completes BIP39 mnemonic onboarding with a daily-unlock password, optionally adds a frontier API key in Settings, types a prompt into Settings → Diagnostics → "Ask Aria", and sees the model's reply alongside the routing decision (LOCAL vs FRONTIER + reason) — with the routing-decision row persisted in the SQLCipher-encrypted DB and visible in the "last N entries" routing log.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Desktop shell | Electron 42 + electron-vite 5 (TypeScript 5) | CLAUDE.md locked stack; electron-vite gives main/preload/renderer separation out-of-box (RESEARCH §Core). v33 in CLAUDE.md was stale; v42 is current per RESEARCH version probe 2026-05-16. |
| UI | React 18 + Vite 5 + Tailwind 3.4 + shadcn/ui | CLAUDE.md; D-13 token set under `src/renderer/app/theme/tokens.ts` |
| Local DB | better-sqlite3-multiple-ciphers 12.9.0 + SQLCipher (chacha20 cipher) | Single-writer sync API fits Electron main; only SQLCipher path on Node that ships Electron prebuilds (m4heshd) |
| DB key derivation | BIP39 mnemonic (`@scure/bip39` 2.2.0) → `crypto.scrypt(N=2^15, r=8, p=1)` → 32-byte raw key passed via `PRAGMA key="x'…'"` (not passphrase mode) | D-01; memory-hard KDF; bypasses SQLCipher's GPU-cheap PBKDF2 default (RESEARCH Pattern 3) |
| Daily-unlock vault | `vault.json` = AES-256-GCM over BIP39 mnemonic; key = `crypto.scrypt` of daily-unlock password | D-01/D-02; mnemonic NOT in safeStorage (Pitfall 5); keeps backup portable per D-04 |
| Secrets (frontier API keys) | Electron `safeStorage` → base64 → `userData/secrets.json`, **after `app.whenReady()`** | D-04, RESEARCH Pattern 4 + Pitfall 3; OS keychain via DPAPI on Windows |
| Backup format | `.ariabackup` = SQLCipher file produced by `VACUUM INTO` with same key | D-04; secrets/OAuth NOT included |
| LLM SDK | Vercel AI SDK 6 (`ai@^6`) with `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, and `ollama-ai-provider-v2@^3.5` | D-09; original `ollama-ai-provider` is abandoned at 1.2.0 (Pitfall 4). CLAUDE.md says SDK 5; RESEARCH verified SDK 6 is the current line — using SDK 6. |
| Routing | Hard-rules classifier: `source` tag default + regex overrides (emails, phones, $$, SSN, names list) → forces LOCAL when matched; uncertain → LOCAL (D-08 fail-closed) | D-05, D-06, D-08 |
| Routing-log persistence | SQLCipher table `routing_log` (timestamp, route, reason, source, prompt_hash, model, latency_ms, ok); minimal "last 100" read-only view in Settings → Diagnostics | D-06, D-07 |
| Logging | pino 10 + pino-roll 4 with PII redaction allowlist at sink | D-16, RESEARCH §Logging |
| Schedulers | node-cron 4 + p-queue 9 + Electron `powerMonitor` (scaffold only in Phase 1) | RESEARCH Architecture |
| Directory layout | `src/main/{ipc,db,vault,secrets,llm,log,lifecycle}`, `src/preload/`, `src/renderer/{app,features,components}` | RESEARCH §Project Structure |
| Platform priority | Windows 11 first; macOS verified at Phase 8; Linux not in v1 | D-14 |
| Data directory | `app.getPath('userData')` (Windows: `%APPDATA%/Aria/`) — exact path logged at first launch | D-16 |
| Test runners | Vitest 4 (unit/integration) + Playwright 1.60 `_electron` (E2E smoke) | Wave 0 of VALIDATION.md |
| Package manager | npm (per RESEARCH install command); Aria is a single-package repo (no pnpm workspace) | RESEARCH §Installation |

## Stack Touched in Phase 1

- [x] Project scaffold — electron-vite + React + TS + Tailwind + shadcn (Plan 01)
- [x] Routing — Electron IPC `aria:ask`, `aria:onboarding:*`, `aria:secrets:*`, `aria:ollama:status`, `aria:diagnostics:*` (Plans 01 + 03 + 04)
- [x] Database — SQLCipher `aria.db`; tables `app_meta`, `routing_log`, `settings`; migration runner driven by `PRAGMA user_version`; `VACUUM INTO` backup; first real write = onboarding seal + first routing-log INSERT (Plan 02)
- [x] UI — Onboarding wizard (mnemonic show + 3-word confirm), Settings → Frontier API key form, Settings → Ollama status, Settings → Diagnostics → "Ask Aria" + routing log (Plans 02 + 03 + 04)
- [x] Deployment — Dev run via `npm run dev` on Windows 11; no signing/notarization (deferred to Phase 8)

## Out of Scope (Deferred to Later Slices)

- Gmail / Calendar / Outlook OAuth and ingest → Phases 2 & 5
- Approval Queue and email send → Phase 3
- Sensitivity classifier via LLM (`generateObject` + Zod) → Phase 3
- Briefing surface with real content → Phase 2
- RAG / embeddings / `sqlite-vec` → Phase 7 (Pitfall 1: known Windows × better-sqlite3 12.x load-extension bug — do NOT load in Phase 1)
- Tray app + global hotkey (Deferred Idea in CONTEXT.md)
- Re-prompt for unlock after OS lock/sleep (Deferred Idea)
- Full routing-log filtering/search UI → Phase 3
- macOS / Linux dev builds; code signing / notarization / auto-updater → Phase 8
- Sentry crash telemetry → Phase 8
- OAuth tokens and API keys included in backup (Deferred Idea — D-04 explicitly excludes them)
- @sentry/electron, docx, @react-pdf/renderer → Phase 8

## Cross-Phase-1 Obligations (tracked outside the code plans)

- **D-15 — Google CASA security review intake** (multi-week lead time; required before Phase 3 `gmail.send`). Tracked as a manual `autonomous: false` checkpoint task in Plan 03.
- **D-16 — `userData` data dir path documented**; pino redaction live from day 1 (Plan 01 wires the sink, Plan 04 confirms routing-log respects redaction).

## Subsequent Slice Plan

- **Phase 2:** Gmail OAuth + read-only ingest + Google Calendar read + briefing v1 (plugs into existing Settings UI + LLM router; first real "source"-tagged content flows through router).
- **Phase 3:** Approval Queue + sensitivity classifier upgrade (LLM-driven via `generateObject`) + redaction layer + email triage/draft/send (consumes router contract from Phase 1).
- **Phase 4:** Calendar write scope + scheduling rules engine + NL scheduling agent → Approval Queue.
- **Phase 5:** MSAL-node + Microsoft Graph adapter (Outlook parity).
- **Phase 6:** Meeting transcript ingest + action-item extraction + Todoist push.
- **Phase 7:** Embeddings + `sqlite-vec` spike (re-verify Windows × better-sqlite3 12.x interop) + RAG Q&A.
- **Phase 8:** Insights, weekly recap (docx + @react-pdf/renderer), preference-learning loop, signing/notarization, auto-updater.

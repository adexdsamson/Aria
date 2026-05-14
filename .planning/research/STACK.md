# Stack Research

**Domain:** Local-first desktop AI exec assistant (Aria)
**Researched:** 2026-05-14
**Confidence:** HIGH on core shell/UI/storage; MEDIUM on local LLM runtime.

## Executive Summary

Recommended stack: Electron 33 + React/Vite + TypeScript 5 + Vercel AI SDK 5 + Ollama + better-sqlite3/sqlite-vec/SQLCipher + Electron safeStorage. Packaged with electron-builder, tested with Vitest + Playwright. Electron is preferred over Tauri because Aria value lives in Node-native libraries (googleapis, msal-node, better-sqlite3, node-cron, docx) and Tauri forces Rust for backend depth. Tauri Stronghold plugin deprecating in v3; Electron safeStorage is stable.

## Recommended Stack

### Desktop Shell: Electron 33+
- Node 20 LTS + Chromium 130. Mature signing/notarization. Works with all Node-native libs Aria needs.
- Tauri v2 viable IF willing to maintain a Rust core; rejected for solo-dev velocity.
- Confidence: HIGH

### UI: React 18 + Vite 5 + TypeScript 5 + Tailwind 3.4 + shadcn/ui
- Largest LLM training corpus = fastest Claude Code pairing.
- electron-vite as build orchestrator. TanStack Query for async. Zustand for client state.
- Reject Solid/Svelte: smaller corpus, slower pairing.
- Confidence: HIGH

### Local LLM: Ollama + ollama-js (NOT node-llama-cpp in v1)
- Ollama runs as localhost sidecar (port 11434), OpenAI-compatible API.
- Default models: Llama 3.1 8B Instruct (Q4_K_M) or Qwen 2.5 7B for sensitivity routing; nomic-embed-text v1.5 (274MB, 8192 ctx) for embeddings.
- node-llama-cpp is faster but native build + GPU detection burden + bundling bloat = too much for solo dev.
- Confidence: MEDIUM-HIGH

### LLM Framework: Vercel AI SDK 5 (released 2025-07-31)
- Unified generateText / streamText / generateObject across Anthropic, OpenAI, Google, AND Ollama (via ollama-ai-provider).
- Tool calling aligned with MCP. generateObject + Zod = right tool for sensitivity classifier and action-item extractor.
- Reject raw provider SDKs: rolling routing layer wastes weeks.
- Confidence: HIGH

### Local Storage: better-sqlite3 11 + sqlite-vec + SQLCipher
- better-sqlite3 synchronous API is CORRECT for Electron main-process single-writer workload.
- sqlite-vec (asg017): vector index in same DB; SQL joins between embeddings and metadata.
- Encryption: SQLCipher (better-sqlite3-multiple-ciphers) whole-DB AES-256, key in OS keychain.
- Reject LanceDB/Chroma (dual datastore sync hell), DuckDB (analytical), LibSQL (distributed).
- Confidence: HIGH

### Secrets: Electron safeStorage (NOT keytar)
- safeStorage uses Keychain (macOS) / DPAPI (Windows) / libsecret (Linux). Built into Electron.
- keytar archived. Do not start a new project on it.
- Linux fallback: warn user if safeStorage backend is basic_text (no libsecret).
- Confidence: HIGH

### OAuth + Provider SDKs
- Google (Gmail + Calendar): googleapis 144+ with google-auth-library 9, OAuth 2.0 loopback IP flow.
- Microsoft (Outlook + Calendar via Graph): @azure/msal-node 3 + microsoft-graph-client 3, auth-code + PKCE.
- Asana: official asana SDK. Jira: jira.js. Todoist: @doist/todoist-api-typescript.
- OAuth UX: BrowserWindow for auth, intercept loopback redirect in main process. Avoid OAuth in renderer.
- Confidence: HIGH

### Background Scheduling: node-cron + p-queue + Electron powerMonitor
- node-cron 3 for daily briefing + integration polling.
- p-queue 8 for serializing LLM calls (rate-limit + cost predictability).
- powerMonitor suspends polling on sleep, resumes on wake (avoids cron storm).
- Reject BullMQ/Bee/Agenda (needs Redis/Mongo). Reject OS schedulers in v1.
- Confidence: HIGH

### Document Export: docx + @react-pdf/renderer
- docx (dolanmiu) for weekly recap Word docs.
- @react-pdf/renderer (JSX-declarative) for PDF.
- Reject pdfkit (imperative), Pandoc/headless-Chrome (extra binaries).
- Confidence: HIGH

### Packaging: electron-builder 25 + electron-updater 6
- macOS DMG + notarization, Windows NSIS + signing, Linux AppImage/deb.
- Update feed: GitHub Releases or S3/R2. Differential updates.
- Signing: Apple Developer ID ($99/yr); Windows OV cert (~$200/yr) over expensive EV.
- Reject electron-forge: builder has more battle-tested signing pipeline.
- Confidence: HIGH

### Testing: Vitest 2 + Playwright 1.48+ (_electron) + MSW 2
- Vitest for unit/integration. Playwright _electron for E2E against packaged app.
- MSW for mocking Google/MS/LLM HTTP in CI.
- Confidence: HIGH

### Telemetry / Observability (privacy-constrained)
- Local pino JSON logs (rotating file, user-attachable to bug reports).
- @sentry/electron 5 with beforeSend allowlist; opt-in only, crash stacks only.
- OpenTelemetry traces locally for LLM routing decisions (debug-only, local SQLite table).
- Reject PostHog/Mixpanel/Amplitude in v1.
- Confidence: MEDIUM

## Versions Snapshot

| Package | Target |
|---|---|
| electron | 33.x |
| electron-builder / -updater | 25.x / 6.x |
| react / react-dom | 18.3.x |
| vite | 5.x |
| electron-vite | 2.x |
| typescript | 5.6.x |
| ai (Vercel AI SDK) | 5.0.x |
| @ai-sdk/{anthropic,openai,google} | 5.x |
| ollama-ai-provider / ollama-js | latest |
| better-sqlite3 / better-sqlite3-multiple-ciphers | 11.x / latest |
| sqlite-vec | latest |
| googleapis / google-auth-library | 144+ / 9.x |
| @azure/msal-node / microsoft-graph-client | 3.x / 3.x |
| @doist/todoist-api-typescript / jira.js / asana | latest |
| node-cron / p-queue | 3.x / 8.x |
| docx / @react-pdf/renderer | 9.x / 4.x |
| pino / @sentry/electron | 9.x / 5.x |
| vitest / playwright / msw | 2.x / 1.48.x / 2.x |
| tailwindcss | 3.4.x |

## Rejected Alternatives

- Tauri v2 (forces Rust depth; Stronghold deprecating; loses Node ecosystem)
- Solid / Svelte (smaller training corpus)
- node-llama-cpp as default (native build + GPU detection burden)
- LanceDB / Chroma (dual datastore sync)
- DuckDB / LibSQL (wrong workload)
- keytar (deprecated)
- BullMQ / Agenda (needs Redis/Mongo)
- pdfkit direct (imperative)
- Jest (slower; ESM friction)
- Spectron (dead)
- PostHog / Mixpanel / Amplitude (privacy posture)
- Raw OAuth (MSAL exists)

## Roadmap Implications

- Phase 1 foundation: Electron+Vite+React scaffold, SQLite+sqlite-vec+SQLCipher, safeStorage, AI SDK 5 with Anthropic + Ollama providers, hello-briefing stub.
- Phase 2 Google before Microsoft: googleapis simpler; build OAuth abstraction here, generalize later.
- Phase 3 RAG: nomic-embed-text via Ollama; email/transcript chunker; Q&A.
- Phase 4 LLM router + approval gates: sensitivity classifier with local 8B + generateObject + Zod.
- Phase 5 calendar smart-scheduling: timezone math, conflict resolution, rule DSL.
- Phase 6 task systems: Todoist first, then Asana / Jira.
- Phase 7 weekly recap export: docx + react-pdf.
- Phase 8 packaging + autoupdate + signing: notarization, OV cert, SmartScreen warm-up.

## Open Questions

1. Notarization / code-signing specifics (Apple notarytool + Windows OV) - Phase 8.
2. Meeting transcript format diversity (Otter / Fireflies / Granola / Zoom) - Phase 4/5.
3. Calendar conflict resolution algorithms - Phase 5.
4. Sentry self-host vs SaaS scrubbing - Phase 8.

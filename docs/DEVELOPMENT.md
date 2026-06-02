# Development Guide

Aria is an Electron desktop application. This guide takes you from a clean machine to a running dev build.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20 LTS | Use [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) — the project is pinned to `@types/node ^20` |
| pnpm | latest | This project uses **pnpm**, not npm. Install via `npm install -g pnpm` or `corepack enable` |
| Electron | 41.6.1 | Pinned — do NOT upgrade; see [ABI section](#electron-abi-pin) below |
| Ollama | latest | Required for local LLM routing and RAG embeddings. [https://ollama.ai](https://ollama.ai) |

---

## Ollama Setup

After installing Ollama, pull the required models:

```bash
ollama pull llama3.1:8b        # sensitivity routing and local LLM fallback (Q4_K_M recommended)
ollama pull nomic-embed-text   # RAG embeddings (274 MB, 8192-token context)
```

Ollama must be running at `http://localhost:11434` before launching Aria. Aria degrades gracefully if Ollama is absent (frontier-only mode), but RAG and sensitivity routing will not function.

---

## Clone and Install

```bash
git clone https://github.com/mainlandtech/aria.git
cd aria
pnpm install
```

The `postinstall` hook (`scripts/postinstall.mjs`) runs automatically after install.

---

## Native Binary Rebuild (important)

Aria uses **better-sqlite3-multiple-ciphers** — a native Node addon. It must be compiled for the correct ABI before use. There are two ABI targets:

- **Electron ABI** (for running the desktop app)
- **Node ABI** (for running tests with vitest)

### Commands

| Command | Use when |
|---------|----------|
| `pnpm run rebuild:native` | Running the desktop app (`pnpm dev`) — builds for **both** Electron 41 and Node 20 (dual build) |
| `pnpm run rebuild:native:node` | Running tests — builds for Node only |
| `pnpm run rebuild:native:electron` | Explicit Electron-only rebuild (rarely needed) |

### Why this matters

Electron and Node use different V8 ABIs. If you run `pnpm run rebuild:native:electron` and then run vitest, it will fail with a version mismatch. The dual build (`rebuild:native`) handles both in one step and is the safe default.

**`pnpm install` does NOT automatically rebuild native binaries.** You must run `rebuild:native` manually after install or after switching between app and test contexts.

---

## OAuth Credentials (bring your own)

Aria ships without a shared OAuth client. You must supply your own OAuth app credentials. The app cannot connect to Google or Microsoft without them.

### Google (Gmail + Calendar)

1. Go to [https://console.cloud.google.com](https://console.cloud.google.com) and create a new project (e.g. "Aria dev").
2. Navigate to **APIs & Services → Library** and enable:
   - Gmail API
   - Google Calendar API
3. Go to **APIs & Services → OAuth consent screen**
   - User type: External
   - Add your own Google account as a test user
   - Add scopes: `gmail.readonly`, `calendar.readonly` (Aria requests additional scopes at connect time)
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**
   - Application type: **Desktop app**
   - Add `http://localhost` as an authorized redirect URI
5. Copy the Client ID and Client secret into `.env.local`:
   ```
   GOOGLE_OAUTH_CLIENT_ID=<your-client-id>
   GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret>
   ```

### Microsoft (Outlook + Calendar via Graph)

1. Go to [https://portal.azure.com](https://portal.azure.com) → Azure Active Directory → App registrations → **New registration**.
2. Add a redirect URI: `http://localhost` under the **Mobile and desktop applications** platform.
3. Under **API permissions → Add a permission → Microsoft Graph → Delegated**, add:
   - `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite`, `offline_access`
4. Copy the Application (client) ID into `.env.local`:
   ```
   MICROSOFT_OAUTH_CLIENT_ID=<your-application-id>
   MICROSOFT_OAUTH_TENANT=common
   ```
   `MICROSOFT_OAUTH_TENANT` defaults to `common` and works for personal and work accounts.

### .env.local

Copy `.env.example` to `.env.local` and fill in your values:

```bash
cp .env.example .env.local
```

`.env.local` is gitignored via `.env.*` (with `!.env.example` so the template stays tracked). In development, Aria reads this file at startup. In production builds, the electron-vite `define` plugin inlines these values into the compiled bundle at build time — they are never read from the filesystem in a packaged app.

The full set of available variables is documented in `.env.example`:
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`
- `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_TENANT`
- `GH_TOKEN` — for publishing releases
- `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` — macOS notarization
- `ARIA_UPDATE_CHANNEL` — `tester` (default) or `latest`

---

## Running the App

```bash
pnpm dev
```

This starts the electron-vite dev server and launches Electron in development mode. The renderer supports hot reload. On first launch, the onboarding wizard will prompt for a vault passphrase and walk through account setup.

---

## Running Tests

**Before running tests, close the Aria desktop app** — see [ABI lock troubleshooting](#better-sqlite3-abi-lock) below.

```bash
# 1. Rebuild native binaries for Node
pnpm run rebuild:native:node

# 2. Run unit + integration tests (includes lint:guard ratchets)
pnpm run test:unit

# 3. Run E2E tests (requires a built app)
pnpm build
pnpm run test:e2e

# 4. Run both suites
pnpm test
```

### Type checking

```bash
pnpm run typecheck
```

electron-vite uses esbuild for compilation, which **does not run TypeScript type checking**. Type errors in `src/main/` or `src/preload/` will silently compile and crash at runtime. Always run `typecheck` after editing those directories.

---

## Lint Guard Ratchets

The project enforces architectural constraints via custom grep-based static analysis in `scripts/grep-*.mjs`. These run as part of `pnpm run test:unit` via `pnpm run lint:guard`.

| Script | What it checks |
|--------|---------------|
| `grep-insight-prose-no-raw.mjs` | Prevents raw data from leaking into insight prose without LLM routing |
| `grep-migration-callsite.mjs` | Ensures `runMigrations` is called only from the single boot-time path |
| `grep-no-fixture-leak.mjs` | Ensures the force-fail migration fixture never appears in production code |
| `grep-no-network-from-signals.mjs` | Prevents learning signals from making outbound network calls |
| `verify-audit-view.mjs` | Verifies the `action_audit_log` SQL VIEW column set matches the expected base tables |

Run manually:

```bash
pnpm run lint:guard
```

---

## Building for Production

```bash
# Build app bundle into out/
pnpm build

# Build + publish to GitHub Releases (requires GH_TOKEN in .env.local)
pnpm run release

# Platform-specific
pnpm run release:mac
pnpm run release:win
```

See [docs/RELEASE-RUNBOOK.md](./RELEASE-RUNBOOK.md) for the full release procedure, including macOS notarization and Windows signing steps.

---

## Troubleshooting

### better-sqlite3 ABI lock

**Symptom:** vitest fails with `NODE_MODULE_VERSION 141 vs 145` or an `EBUSY` error on the native binary.

**Cause:** The Aria desktop app is running and holds a lock on the better-sqlite3 native binary compiled for Electron's ABI. Vitest cannot replace it.

**Fix:**
1. Close the Aria desktop app.
2. Run `pnpm run rebuild:native:node`.
3. Re-run your tests.

### Electron ABI pin

Electron is pinned at exactly `41.6.1` in `devDependencies` (no caret). Do not upgrade without:
1. Running `pnpm run rebuild:native` to recompile the native binaries.
2. Verifying the full test suite passes.
3. Updating this document.

The pin exists because better-sqlite3-multiple-ciphers and sqlite-vec are native addons sensitive to ABI changes.

### esbuild skips TypeScript errors

electron-vite uses esbuild, which transpiles TypeScript but **does not type-check**. Errors like undefined variables, wrong function signatures, or incorrect types will not be caught at build time — they manifest as runtime crashes. Always run `pnpm run typecheck` after editing `src/main/` or `src/preload/`.

### Vitest parallel project race

Running four or more spec files across main/renderer projects simultaneously can produce `config undefined` or `failed to find suite` errors. Workaround: run one spec file at a time when investigating isolated failures.

### First-launch vault

On first launch Aria creates an encrypted SQLite database (`aria.db`) in the user data directory and prompts for a vault passphrase. The passphrase is used to derive the SQLCipher key stored in the OS keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux). If you skip the onboarding wizard or close it early, the app will show the unlock screen on next launch with no valid password — use the "Forgot password / restore from mnemonic" flow shown during onboarding.

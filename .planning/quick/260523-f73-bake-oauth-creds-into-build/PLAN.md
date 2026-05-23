---
id: 260523-f73
slug: bake-oauth-creds-into-build
date: 2026-05-23
status: in-progress
---

# Quick task — Bake OAuth credentials into the production build

## Problem

Production-build Integrations page shows `Aria can't find Google OAuth credentials. See .env.local.example and your local .env.local file.` Root cause: `electron.vite.config.ts` had no `define` block, so `process.env.GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` were never injected into the packaged bundle. The dev-only `.env.local` reader in [src/main/index.ts](../../../src/main/index.ts) is gated on `ELECTRON_RENDERER_URL` (dev-only) — packaged builds bailed out immediately. The earlier comment claiming "electron-vite `define` injects in production" was aspirational; the wiring was never done.

## Tasks

1. **Wire `loadEnv` + `define` in `electron.vite.config.ts`.** Read `.env.local` at build time via Vite's `loadEnv`, inline `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MS_OAUTH_CLIENT_ID`, `MS_OAUTH_TENANT_ID` as string literals into the main bundle's `process.env.*` references via `define`. Empty-string fallback so the existing `if (!clientId || !clientSecret)` check still trips `OAuthConfigMissingError` cleanly when nothing is set.
2. **Fix the misleading comment** in `src/main/index.ts:19-34` — the comment now accurately describes the wiring as it exists.
3. **Verify**: `npm run build` then grep `out/main/index.js` for the baked-in `readOAuthConfig` literal. Both `clientId` and `clientSecret` should be visible as string literals in `readOAuthConfig$1`.
4. **Commit, SUMMARY.md, STATE.md row.**

## Security note (documented, not blocking)

Desktop OAuth client secrets baked into the binary are recoverable via `asar extract`. Google explicitly treats desktop OAuth secrets as "not secrets in the cryptographic sense" per their published policy — they're public-by-design for desktop apps. Acceptable for v1 distribution; flagged here for future rotation if the binary ever reaches an untrusted audience.

## Non-goals (deferred)

- Runtime override (e.g. reading `<userData>/aria-oauth.json` if the baked value is empty) — heavier change, useful only if end users supply their own keys without rebuilding.
- Removing the OAuth client secret from logs/dumps — already redacted, not touched here.
- Microsoft OAuth wiring: `MS_OAUTH_CLIENT_ID` / `MS_OAUTH_TENANT_ID` are added to the `define` for symmetry, but no Microsoft account work has been live-tested as part of this task.

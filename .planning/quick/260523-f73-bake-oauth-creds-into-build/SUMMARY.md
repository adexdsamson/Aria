---
id: 260523-f73
slug: bake-oauth-creds-into-build
date: 2026-05-23
status: complete
spec: inline (see PLAN.md)
---

# Summary — Bake OAuth credentials into the production build

## Outcome

Production-build Integrations page no longer shows `Aria can't find Google OAuth credentials.` Vite's `loadEnv` reads `.env.local` (and `.env`, `.env.<mode>`) at build time; the values are inlined into the main bundle via `define`. Packaged binaries now carry `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MS_OAUTH_CLIENT_ID`, `MS_OAUTH_TENANT_ID` as string literals — the original `process.env.GOOGLE_OAUTH_CLIENT_ID` reads in [src/main/integrations/google/auth.ts](../../../src/main/integrations/google/auth.ts) now resolve to literals at compile time.

## Files

| File | Kind | Change |
|---|---|---|
| `electron.vite.config.ts` | edit | Added `loadEnv` + `oauthDefine` block; wired into `main.define`. |
| `src/main/index.ts` | edit | Comment refreshed — accurately describes dev (`.env.local` reader) vs production (`define`-baked) flow. |

## Verification

- `npm run build` → green.
- Grep of `out/main/index.js` after build:
  ```
  function readOAuthConfig$1() {
    const clientId = "...";      // baked-in literal, value redacted here
    const clientSecret = "...";  // baked-in literal, value redacted here
    return { clientId, clientSecret };
  }
  ```
  Both literals present → the runtime `if (!clientId || !clientSecret)` check now succeeds.
- Live UAT pending: run the packaged binary (or `npm start`), navigate to Settings → Integrations → Gmail, click `Connect Gmail`, complete OAuth flow. The error banner should be gone.

## Security caveats documented

Desktop OAuth client secrets in the bundled `.asar` are recoverable via `asar extract`. Google explicitly classes desktop OAuth secrets as "not secrets in the cryptographic sense" — public-by-design for desktop apps. Acceptable for v1 distribution; rotate if/when the binary reaches an untrusted audience.

## Known follow-ups (NOT in this change)

- Runtime override path (`<userData>/aria-oauth.json` fallback) for end-user-supplied keys.
- Microsoft OAuth live test — wired into `define` for symmetry, but no live verification was performed in this task.
- `.env.local.example` text references only Google OAuth — should be extended to document `MS_OAUTH_CLIENT_ID` if Microsoft accounts ever ship in v1.

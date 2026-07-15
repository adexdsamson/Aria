---
quick_id: 260715-4np
slug: fix-ci-oauth-secret-injection
date: 2026-07-15
status: complete
---

# Summary

Added an `env:` block to the `Build (vite)` step in both `build-win` and
`build-mac` jobs of `.github/workflows/build.yml`, wiring the four OAuth
credentials from GitHub repository secrets:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `MS_OAUTH_CLIENT_ID`
- `MS_OAUTH_TENANT_ID`

`electron.vite.config.ts` `loadEnv('production', cwd, '')` merges
`process.env`, so these step-level vars are inlined into `out/main` via Vite
`define` at build time — fixing the `OAuthConfigMissingError` /
"Aria can't find Google OAuth credentials" banner on CI-packaged builds.

## Verified

- Workflow parses cleanly (`js-yaml`).
- Both jobs' `Build (vite)` step carries all 4 env keys.

## Remaining (out of scope / user side)

- Repo secrets: registered by user (confirmed).
- Local prod builds: repopulate `.env.local` (currently empty) before
  `pnpm run build`, or rely on shell env.
- Live UAT: next published dev build → Settings → Integrations → Connect Gmail.

## Files touched

- `.github/workflows/build.yml`

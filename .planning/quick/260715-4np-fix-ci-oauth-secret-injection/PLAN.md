---
quick_id: 260715-4np
slug: fix-ci-oauth-secret-injection
date: 2026-07-15
---

# Inject OAuth credentials into CI build

## Problem

Packaged/distributed prod builds show "Aria can't find Google OAuth
credentials." The credential-baking mechanism is intact
(`electron.vite.config.ts` `loadEnv` + `define` inlines
`GOOGLE_OAUTH_CLIENT_ID` / `_SECRET` / `MS_OAUTH_CLIENT_ID` /
`MS_OAUTH_TENANT_ID` into `out/main` at build time), but `define` can only
bake in what `loadEnv` finds on the build machine.

The distributed build is produced by GitHub Actions, where:
- `.env.local` is gitignored + untracked → absent from the CI checkout.
- The `Build (vite)` step had no `env:` block.

So `loadEnv` found nothing → `define` baked `""` → `readOAuthConfig()`
(`src/main/integrations/google/auth.ts:87`) throws `OAuthConfigMissingError`.

## Change

Add an `env:` block to the `Build (vite)` step in both the `build-win` and
`build-mac` jobs of `.github/workflows/build.yml`, sourcing the four OAuth
vars from GitHub repository secrets. `loadEnv('production', cwd, '')` merges
`process.env`, so step-level env is picked up and baked in.

Secrets are already registered in the repo (confirmed by user).

## Verification

- `js-yaml` parse of the workflow succeeds.
- Both jobs' `Build (vite)` step carries all 4 env keys.
- Next CI run's installer no longer trips the OAuthConfigMissingError banner
  (live UAT on the published dev build).

# Pre-Publish Safety Pass — Findings Report

**Generated:** 2026-06-02
**Plan:** 13-01
**Scope:** Full git history (392 commits) + .planning/ content review (218 tracked files) + stray-file audit

---

## Git History Scan

**Tool used:** Structured regex sweep via `git log --all -p` (gitleaks not available on this machine)
**Date:** 2026-06-02
**Commits scanned:** 392

### Patterns checked

| Pattern | Checked via | Result |
|---------|-------------|--------|
| `-----BEGIN PRIVATE KEY` / `BEGIN.*PRIVATE` (Ed25519, RSA, EC) | `grep -E "BEGIN.*PRIVATE"` over full diff log | CLEAN — 0 matches |
| Stripe `sk_live_*` (live secret key) | `grep -E "sk_live_[A-Za-z0-9]{20}"` | CLEAN — 0 matches |
| Stripe `sk_test_*` (test secret key) | `grep -E "sk_test_[A-Za-z0-9]{20}"` | CLEAN — 0 matches |
| Stripe `whsec_*` (webhook signing secret) | `grep -E "whsec_[A-Za-z0-9]{20}"` | CLEAN — 0 matches |
| `GH_TOKEN=<value>` | `grep -E "GH_TOKEN\s*=\s*[A-Za-z0-9_-]{10}"` | CLEAN — 0 matches |
| `APPLE_ID=<email>` | `grep -E "APPLE_ID\s*=\s*.*@"` | CLEAN — 0 matches |
| `APPLE_APP_SPECIFIC_PASSWORD=<value>` | `grep -E "APPLE_APP_SPECIFIC_PASSWORD\s*=\s*[A-Za-z0-9]+"` | CLEAN — 0 matches |
| `APPLE_TEAM_ID=<10-char>` | `grep -E "APPLE_TEAM_ID\s*=\s*[A-Z0-9]{10}"` | CLEAN — 0 matches |
| `GOOGLE_OAUTH_CLIENT_SECRET=<value>` (15+ chars) | `grep -E "GOOGLE_OAUTH_CLIENT_SECRET\s*=\s*[A-Za-z0-9_-]{15,}"` | CLEAN — all matches are variable references or empty-string assignments |
| `ENT_SIGNING_SEED=<value>` (private signing seed) | `grep -E "ENT_SIGNING_SEED.*=['\"][0-9a-fA-F]{20}"` | CLEAN — seed lives only in Cloudflare wrangler secrets, never in code |
| Bearer tokens / JWTs with real values | `grep -E "Bearer\s+[A-Za-z0-9_-]{40,}"` | CLEAN — 0 matches |
| High-entropy hex strings (40+ chars) | Context-evaluated | CLEAN — only two hex strings found; both are expected/public |

### High-entropy strings reviewed

1. `67c9a785e775d3339daa99cecb0f47d7f7e861c31fc113be3e8dca371b6a37f6` — This is the **Ed25519 PUBLIC key hex** from Phase 08.1. It is intentionally embedded in `src/main/entitlement/jwt-verify.ts` and in `08.1-01-SUMMARY.md`. **This is safe to be public** — it is the public half of the keypair; the private signing seed (`ENT_SIGNING_SEED`) is stored only in Cloudflare wrangler secrets and was never committed.

2. `2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824` — This is the SHA-256 hash of the string `"hello"`, used in a unit test assertion (`router.spec.ts`). Not a secret.

### Overall git history verdict

**CLEAN.** No private keys, API keys, webhook signing secrets, or authentication credentials appear in any git commit across the full 392-commit history. The `.env.local` file was never committed.

---

## .gitignore Verification

| Check | Result |
|-------|--------|
| `.env.*` is gitignored | PASS — `.gitignore` line 12: `.env.*` |
| `!.env.example` is whitelisted | PASS — `.gitignore` line 13: `!.env.example` |
| `.env.local` was never committed | PASS — `git ls-files .env.local` returns "pathspec did not match any file" |
| `.env.example` contains only empty placeholders | PASS — all values are empty (`GH_TOKEN=`, `APPLE_ID=`, etc.) |

---

## .planning/ Sensitivity Review

**Total tracked files:** 218

### Flagged items

#### Flag 1 — Personal Gmail address (developer's own) in multiple files

**Files:**
- `.planning/phases/01-foundation/01-03-CASA-INTAKE.md` — lines 6, 25, 33: `adexdsamson@gmail.com` as project owner / technical contact
- `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-01-gmail-ingest-PLAN.md` — line 156: instruction to add `adexdsamson@gmail.com` as OAuth test user
- `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-UAT.md` — lines 65, 83, 461: developer's Gmail shown as the connected account during UAT
- `.planning/phases/04-calendar-smart-scheduling-google/04-UAT.md` — line 45: developer's Gmail as connected account
- `.planning/quick/260523-a5w-settings-integrations-cleanup-and-calend/260523-a5w-PLAN.md` — lines 218, 290: manual smoke instructions reference the account
- `.planning/phases/08.1-subscription-and-60-day-trial-stripe-billing-integration-wit/08.1-01-SUMMARY.md` — line 48: developer's Gmail in production D1 license table row

**Nature:** Developer's own personal Gmail used as test/connected account during development. This is the developer's own email, not a third-party user's data.

**Recommended disposition:** **keep-as-is** — this is the developer's own email in their own project's planning docs. It is ordinary for open-source projects to contain the maintainer's contact email in development notes. The landing page already links `mailto:adexdsamson@gmail.com` publicly. No risk of privacy violation to the developer by keeping it.

---

#### Flag 2 — Third-party email in production license table (`redacted-tester@example.invalid`)

**File:** `.planning/phases/08.1-subscription-and-60-day-trial-stripe-billing-integration-wit/08.1-01-SUMMARY.md` — line 47

**Context:** This email appears in a production smoke verification table documenting two license rows created during end-to-end testing. `redacted-tester@example.invalid` was used in a local miniflare D1 test (not production Cloudflare D1).

**Git history:** This row is committed in history and cannot be removed without a history rewrite.

**Nature:** A real email address belonging to another person (likely a tester or secondary account), captured in a production smoke test table.

**Recommended disposition:** **redact-before-publish** — Replace `redacted-tester@example.invalid` with `[tester@example.com]` in the file. Because this line is also in git history, you have two options:

- **Option A (recommended for most cases):** Accept the exposure and proceed. The email appears once in a planning doc. Git history rewrites are risky and disruptive.
- **Option B:** Run `git filter-repo --replace-text` to rewrite the one commit where this line was added. This permanently removes it from all history.

---

#### Flag 3 — Real Stripe production artifacts in 08.1-01-SUMMARY.md

**File:** `.planning/phases/08.1-subscription-and-60-day-trial-stripe-billing-integration-wit/08.1-01-SUMMARY.md`

The file documents live (test-mode) Stripe artifacts:
- **Stripe webhook endpoint ID:** `we_1TZ4ufFQQiweCHcuRFbXOMY5` — this is a Stripe webhook endpoint identifier (not the signing secret). The actual `STRIPE_WEBHOOK_SECRET` / `whsec_*` value was never committed (stored as wrangler secret). The endpoint ID alone cannot be used to forge webhooks.
- **Stripe Price ID:** `price_1TZ27LFQQiweCHcumgzTcZxV` — test-mode pricing object. Not sensitive.
- **Stripe customer ID:** `cus_UYBTnHWf8cgMBq` — a real Stripe customer record in the developer's test-mode Stripe account. Not sensitive (cannot be used to extract payment details).
- **License keys:** `ARIA-01KS23NMBD7SVCSB8QXD8CP3N6-92EB` and `ARIA-01KS26KA6M4GMGECCT9ZJW7QAQ-E84C` — real license keys from the test deployment. Under the open-source MIT posture, the license check code is public anyway; knowing a test-mode license key does not compromise anything.

**Recommended disposition:** **keep-as-is** — none of these values are secrets. The webhook signing secret (`whsec_*`) was correctly never committed. The plan is MIT-licensed, so the license enforcement logic is already public. These are test-mode artifacts documenting the end-to-end smoke run.

---

#### Flag 4 — Production Cloudflare Workers URL

**File:** `.planning/phases/08.1-subscription-and-60-day-trial-stripe-billing-integration-wit/08.1-01-SUMMARY.md` (and embedded in `src/main/entitlement/jwt-verify.ts`)

**URL:** `https://aria-license-server.adexdsamson.workers.dev`

**Nature:** This is the production license server URL, already embedded in the shipped app binary (in `jwt-verify.ts`). It is discoverable by anyone who downloads the app.

**Recommended disposition:** **keep-as-is** — it is already baked into the app and was always intended to be public. The URL is not sensitive.

---

#### Flag 5 — Developer's GitHub username revealed in landing page (tracked file)

**File:** `landing/index.html` (tracked)

References `github.com/adexdsamson/Aria` and `github.com/adexdsamson/aria-releases` and `mailto:adexdsamson@gmail.com`. These are deliberate public-facing links intended for the open-source release.

**Recommended disposition:** **keep-as-is** — intentional public links for an open-source repo.

---

### Summary of .planning/ review

| Item | File | Disposition |
|------|------|-------------|
| Developer's own Gmail (multiple planning files) | Various | Keep-as-is |
| Third-party tester email in smoke table | `08.1-01-SUMMARY.md` line 47 | Redact-before-publish (Option A = accept / Option B = filter-repo) |
| Stripe test-mode artifacts (IDs, not secrets) | `08.1-01-SUMMARY.md` | Keep-as-is |
| Production Cloudflare Workers URL | `08.1-01-SUMMARY.md` | Keep-as-is |
| Developer GitHub username in landing page | `landing/index.html` | Keep-as-is (intentional) |

No financial data, health data, customer lists, salary information, or genuinely internal business metrics were found.

---

## Stray Files at Root

| File | Tracked? | Nature | Recommended disposition |
|------|----------|--------|------------------------|
| `catalog_raw.json` | No (untracked) | RSS feed catalog — list of public RSS feed URLs by category (Atlas Obscura, etc.). No sensitive data. Autogenerated by `build_catalog.js`. | Add to `.gitignore` |
| `catalog_clean.json` | No (untracked) | Processed RSS catalog (same data, cleaned format). | Add to `.gitignore` |
| `catalog_final.json` | No (untracked) | Empty / zero-byte at time of scan. | Add to `.gitignore` |
| `build_catalog.js` | No (untracked) | Node script using `gh.exe` to build the RSS catalog. No credentials — uses the GH CLI already authenticated on the machine. Contains a local path (`C:\Program Files\GitHub CLI\gh.exe`). | Add to `.gitignore` |

**Default disposition:** Add all four to `.gitignore` under a `# Scratch / build catalog files` comment. No deletion needed (files are harmless and useful locally).

---

## Tracked .claude/ Files

**All tracked files under .claude/:**
- `.claude/launch.json` — the only tracked file

**Content of `.claude/launch.json`:**
```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "landing",
      "runtimeExecutable": "npx",
      "runtimeArgs": ["serve", "landing", "-p", "4444"],
      "port": 4444
    }
  ]
}
```

This is a VS Code / Claude Code debug launch config for serving the landing page locally. **It contains no secrets, tokens, or credentials.**

**Recommended disposition:** **Keep tracked** — it is safe to be public and useful for contributors who want to serve the landing page.

**Additional note:** `.claude/settings.local.json` and `.claude/worktrees/` are already untracked. To prevent them from ever being accidentally committed, add them to `.gitignore`.

---

## Summary

### Overall verdict: READY TO PROCEED (with one optional redaction decision)

**Blockers (hard stop):** None. No API keys, private keys, webhook signing secrets, or auth tokens appear in git history.

**Items requiring user decision before Wave 2 proceeds:**

1. **Third-party email in 08.1-01-SUMMARY.md (Flag 2):**
   - `redacted-tester@example.invalid` appears in a test-data table in planning docs, in git history.
   - **Option A (recommended):** Accept the exposure — it is a planning note in a `miniflare` (local) test row, likely a secondary test account. Mark as keep.
   - **Option B:** Run `git filter-repo --replace-text` to scrub from history.
   - No other action unblocks Wave 2.

2. **`.gitignore` additions (confirmed default):** After sign-off, the executor will append to `.gitignore`:
   - `catalog_raw.json`, `catalog_clean.json`, `catalog_final.json`, `build_catalog.js` under a `# Scratch / build catalog files` comment
   - `.claude/settings.local.json` and `.claude/worktrees/` under a `# Claude Code local config` comment

3. **`.claude/launch.json`:** Keep tracked (no action needed).

### Post-checkpoint actions (executor will apply after sign-off)

- Append `.gitignore` entries as described above
- If Option B chosen: document the `git filter-repo` command in this file under `## Remediation Taken`

### What this report confirms is clean

- No private keys anywhere in 392-commit history
- No Stripe secret keys or webhook signing secrets
- No OAuth client secrets committed with real values
- No Apple signing credentials committed
- No GH_TOKEN committed
- `.env.local` never tracked
- Ed25519 public key is intentionally public (by design)
- All "high-entropy" strings are either the intended public key or SHA-256 test vectors

---

## Remediation Taken

**Signed off:** 2026-06-02 by repo owner.

**Decisions applied:**

1. **Flag 2 (third-party tester email) — Option B: scrubbed from history.** The owner chose to remove the email rather than keep it. Because the offending commit (`e1c592c`) was already present on the private `origin/master`, a full history rewrite + force-push was required (not just a local scrub).
   - Tooling: `git filter-repo --replace-text` (installed via `python -m pip install --user git-filter-repo`, v2.47.0).
   - Replacement rule: `adediran.dbs@gmail.com==>redacted-tester@example.invalid`.
   - Safety: full `git bundle --all` backup taken first (`../Aria-backup-20260602-presrub.bundle`); uncommitted WIP captured to a patch and re-applied after the rewrite (working tree preserved).
   - Result: rewrote 393 commits; `git log --all -S "adediran.dbs@gmail.com"` and `git grep` over HEAD both return **zero** matches. HEAD moved `80ea8f0` → `203e489`.
   - Remote: `git push origin master --force-with-lease=master:7ec391e…` succeeded (`7ec391e...203e489 forced update`). Email is gone from the private GitHub remote.
   - Residual-risk note: GitHub may keep the old commit reachable by raw SHA in cache until it garbage-collects; negligible for a private, zero-fork repo. Contact GitHub Support to expedite GC if desired.

2. **Stray files — added to `.gitignore`:** `catalog_*.json` and `build_catalog.js` (kept locally, not deleted).

3. **`.claude/` — `launch.json` kept tracked**; `.claude/settings.local.json` and `.claude/worktrees/` added to `.gitignore`.

**Verdict after remediation: SAFE TO PUBLISH.** No secrets in history; the one flagged third-party email has been scrubbed from local and remote history.

# Aria — Release Runbook

> **Owner:** maintainer (currently solo dev).
> **Cadence:** rolling tester releases as plans land; tagged GA after the
> tester usage period closes the user-confirmed staged-signing window.
> **Source of truth for v1 release decisions:**
> `.planning/phases/08-insights-weekly-recap-learning-release-prep/08-CONTEXT.md`
> + amended XCUT-05 in `.planning/REQUIREMENTS.md`.

This runbook is the single, durable artifact for shipping Aria. Treat
every section as a hard pre-flight check before you push a tag.

---

## 1. Pre-flight checks

Before any `git tag v*` push:

1. Working tree is clean on `master`: `git status` shows nothing.
2. Local `pnpm install` is up to date with the lockfile (`pnpm install
   --frozen-lockfile` exits clean).
3. `pnpm typecheck` is green.
4. `pnpm lint:guard` is green (all five static ratchets pass).
5. `pnpm test:unit` is green.
6. `pnpm test:e2e` is green (CI default — Mode-A mocked LLM).
7. **REQUIRED before any `git tag v*` push:** the Mode-B real-Ollama
   RAG_ASK smoke is green:

   ```bash
   ARIA_E2E_REAL_LLM=true pnpm test:e2e --grep rag-ask-smoke
   ```

   This proves the Phase-7 RAG pipeline still answers against a live
   local model — the cross-process pino log-line ratchet (factory-
   constructed) is the proof-of-wire that closes B-2 round 2.
8. Environment variables present in the shell or `.env.local`:
   - `GH_TOKEN` (PAT classic, `repo` scope — see §8)
   - `APPLE_ID`
   - `APPLE_APP_SPECIFIC_PASSWORD`
   - `APPLE_TEAM_ID`
   - (optional) `ARIA_UPDATE_CHANNEL` — default `tester`.

---

## 2. Tag + publish

```bash
# 1. Bump version in package.json
# 2. Commit the version bump
# 3. Tag
git tag v1.0.0
git push origin v1.0.0

# 4. Build + publish to GitHub Releases (uses electron-builder + GH_TOKEN)
pnpm run release
```

For a pre-release (tester channel):

```bash
pnpm run release -- --prerelease
```

`electron-builder --publish github` writes `latest.yml` (or
`latest-tester.yml` when the channel is set to `tester`) and the
installer artifacts to the GitHub Release page.

---

## 3. macOS notarization smoke

After `pnpm run release:mac` completes, the produced `.app` must pass:

```bash
spctl --assess --verbose=4 build/mac-arm64/Aria.app
```

Expected: `accepted, source=Notarized Developer ID`. Anything else =
do NOT publish the tag — debug the notarytool submission first
(common: wrong `APPLE_TEAM_ID`; rejected entitlement; ticket not
stapled).

Notarization uses the credentials from `APPLE_ID` /
`APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`. The
`build/entitlements.mac.plist` file declares `allow-jit` and
`network.client` — these are required by Electron's Chromium renderer
plus Aria's outbound HTTPS to Google / Microsoft / Anthropic / OpenAI /
GitHub Releases / Ollama localhost.

Use `notarytool history` to diagnose:

```bash
xcrun notarytool history \
  --apple-id "$APPLE_ID" \
  --team-id  "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD"
```

---

## 4. Windows tester ship (unsigned NSIS — staged signing per XCUT-05)

Per the amended XCUT-05 (`.planning/REQUIREMENTS.md` line 114) the
initial v1 tester build ships **Windows-unsigned**. Document this
explicitly in tester onboarding:

> When you run the Aria installer for the first time on Windows you'll
> see a SmartScreen "Windows protected your PC" warning. This is
> expected for v1 tester builds. Click **More info** then **Run
> anyway**. We sign the Windows installer with an OV certificate at GA
> release; tester builds skip signing to keep the feedback loop tight.

`pnpm run release:win` builds an unsigned NSIS installer with the
flags `oneClick=false`, `perMachine=false`,
`allowToChangeInstallationDirectory=true` — so the tester explicitly
sees the install location.

---

## 5. AV submission portals (Antivirus)

After a stable build is signed (post-GA), submit the installer to the
major AV vendors so first-run scans don't quarantine it:

- **Microsoft Defender:** https://www.microsoft.com/en-us/wdsi/filesubmission
- **Symantec / Norton:** https://submit.symantec.com/false_positive/standard/
- **Avast / AVG:** https://www.avast.com/false-positive-file-form.php
- **Bitdefender:** https://www.bitdefender.com/consumer/support/answer/29358/
- **ESET:** https://www.eset.com/int/support/contact/sample-submission/
- **Kaspersky:** https://opentip.kaspersky.com/

Each submission needs the signed `.exe`, version, build hash, and a
plain-English description of what the binary does. Aria's positioning
("local-first desktop AI personal assistant for executives") suits
the description field; emphasize that all network calls are to user-
authorized OAuth endpoints + frontier LLM APIs + GitHub Releases.

---

## 6. SmartScreen reputation seeding strategy

Pre-GA (tester channel, unsigned): no reputation. Users see the
SmartScreen warning every install — that's expected and documented in
§4.

At GA release (OV-signed):

1. The OV cert provides immediate Authenticode signature trust but
   does NOT bypass SmartScreen reputation requirements.
2. SmartScreen reputation accrues per binary-hash + per-cert via real
   user installs over time. There is no API to "warm up" the
   reputation faster.
3. Document the temporary warning in the GA changelog so first-week
   adopters know to click through.
4. Within ~2 weeks of GA the cert reputation reaches a threshold where
   SmartScreen warnings drop for most installers.

EV certificates DO get immediate SmartScreen reputation, but the
trade-off is the HSM requirement + roughly 4x cost vs OV. The
amendment in `.planning/REQUIREMENTS.md` defers the OV-vs-EV
decision to the post-tester window — revisit when the tester user
count and crash-free rate justify the move.

---

## 7. Channel flip — tester → stable

When the tester usage period closes (user-confirmed exit criteria;
see XCUT-05 amendment):

1. Update `ARIA_UPDATE_CHANNEL` in the production env to `latest`.
2. Update `package.json` build config publish channel if the tester
   feed is on a separate track.
3. Tag a GA release: `git tag v1.0.0` (assuming you tagged the tester
   builds as `v1.0.0-tester.N`).
4. Push the tag; `pnpm run release` will publish to the stable feed.
5. Users on the tester channel keep receiving tester updates until
   they explicitly switch in `Settings → Updates`.

---

## 8. GitHub token scope

For local publishing: a **classic** PAT with `repo` scope is the
simplest path that works on a public repo. Configure once:

1. https://github.com/settings/tokens → **Generate new token
   (classic)**.
2. Select `repo` (full control of private repositories). Even for a
   public repo, `public_repo` alone is insufficient for some
   `electron-builder` flows.
3. Store the token in your `.env.local` or shell rc as `GH_TOKEN`.
4. Verify the repo is public OR the token has `repo` scope.

NEVER commit the PAT. The `.env.example` shows the variable name but
deliberately leaves the value blank.

---

## 9. Rollback procedure (M-2 round 2 — match softened CONTEXT)

If a release crashes for users after auto-update:

1. **Mark the affected GitHub Release as `draft` immediately.** This
   prevents new auto-updaters from downloading the broken build. Do
   this BEFORE any other diagnosis.
2. **electron-updater does NOT auto-rollback already-installed
   users.** Already-updated users are stuck on the broken binary. They
   must manually download the prior installer and reinstall the prior
   version. The
   in-app DB restore (pre-migration snapshot written by
   `runMigrationsWithBackup`) recovers user data after the prior
   binary is reinstalled — `restoreFromBackup` closes the live
   handle, renames the snapshot copy over `aria.db`, and reopens
   without re-migrating.
3. **User-facing flow** to put in the release-notes amendment:

   > If Aria fails to launch after the auto-update, download the
   > prior installer from
   > https://github.com/{owner}/{repo}/releases, uninstall the
   > broken version, and install the prior version. Your data is
   > preserved by Aria's pre-migration snapshot — the prior binary
   > will pick up where the broken release left off.

4. Investigate root cause. Common shapes: migration logic error,
   sqlite-vec ABI drift, signing chain mismatch, hardenedRuntime
   regression.
5. Land the fix on `master`, tag the next patch release, publish.
6. Restore the original (now-fixed) release to `latest` once
   verified.

---

## 10. EV-cert deferral note

The amended XCUT-05 explicitly defers Windows OV vs EV signing to
post-tester usage. **Why:**

- OV is cheaper (~$200/yr vs ~$700/yr for EV).
- OV gives instant Authenticode signature trust.
- OV does NOT bypass SmartScreen reputation, but reputation accrues
  within ~2 weeks of GA at the install volumes Aria expects.
- The EV cert hardware-key (HSM / USB token) workflow significantly
  complicates the CI signing pipeline for a solo dev.

Revisit the EV decision when:

- Tester user count > 50 AND crash-free install rate < 99% from
  SmartScreen warnings driving installs to fail.
- OR Windows is the dominant install platform AND first-week install
  drop-off correlates with SmartScreen.

Until then: OV at GA, EV deferred to v2.

---

## 11. Migration-failure packaged-build smoke (manual)

The Task-8 spec exercises the migration-failure path against a dev
build with `ARIA_E2E_FORCE_MIGRATION_FAIL=true`. For a quick smoke
against the packaged binary itself:

1. Build with `pnpm run release:mac` (or `release:win`).
2. Install the packaged build into a clean tester profile (delete
   any prior `~/Library/Application Support/Aria/` data first on
   macOS, `%APPDATA%\Aria\` on Windows).
3. Onboard normally → seal → quit.
4. Copy a known-bad SQL file into the local
   `<dataDir>/__test_migration_drop__/` directory and set the env
   `ARIA_E2E_FORCE_MIGRATION_FAIL=true` in the launch shell. (The
   packaged build looks for this directory ONLY when the env is set.)
5. Relaunch → unlock. The recovery dialog should appear; click
   **Restore** and verify the pre-migration snapshot replaces the
   broken DB.
6. Tear down the test profile.

The Task-9 manual smoke is intentionally separate from the Task-8
dev-build E2E (which uses
`tests/fixtures/999_force_fail.sql` via the test-only injection
helper) — the packaged-build path proves the user-facing recovery
dialog works against the real Electron binary.

---

## Notarytool credentials snippet

Save this snippet in your shell rc:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"   # from appleid.apple.com
export APPLE_TEAM_ID="AB1234CDEF"
export GH_TOKEN="ghp_..."
export ARIA_UPDATE_CHANNEL="tester"   # default; remove for stable
```

These are also documented in `.env.example` at the repo root.

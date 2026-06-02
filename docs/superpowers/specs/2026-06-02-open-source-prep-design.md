# Open-Sourcing Aria — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design); pending spec review → `/gsd-plan-phase`
**Author/maintainer:** Mainland Tech (`ai@mainlandtech.com`)

## Goal

Publish Aria as a **source-available showcase** open-source project that is **well documented**: a clear front door (README), real architecture and development docs, a permissive license, and light contribution scaffolding. The repository should let an interested developer understand what Aria is, why it was built the way it was, and run it locally with their own credentials.

## Locked Decisions

| Decision | Value | Source |
|---|---|---|
| Posture | Source-available showcase — solo maintainer, strong docs, light contribution flow | User Q&A |
| `.planning/` (213 tracked files) | **Stays public** as the "built with Claude Code + GSD" decision history (after sensitivity scan) | User Q&A |
| License | **MIT**, fully open — forks may remove the paywall; accepted for adoption/showcase | User Q&A + "proceed with MIT" |
| Copyright holder | **Mainland Tech** (default from user email — change is a one-line edit) | Default under "proceed" |
| GitHub templates | **Included** (light issue + PR templates) | Default under "proceed" |
| Implementation transition | **`/gsd-plan-phase`**, NOT writing-plans | Project CLAUDE.md GSD enforcement + saved feedback |

### Flagged conflict (resolved)

Phase 08.1 added a commercial subscription layer (Stripe + Cloudflare license server + Ed25519 JWT, 60-day trial, hard cutoff). Under MIT a fork can delete the license check. The user explicitly accepted this tradeoff. **Consequence for the safety pass:** the Phase 08.1 signing/secret material is the highest-priority thing to confirm is absent from git history.

## Phase 1 — Pre-Publish Safety Pass (runs first; gated on user sign-off)

Going public is irreversible for anything in history. No docs or metadata work proceeds until this passes and the user signs off.

1. **Full git-history secret scan.** Scan the entire history (not just the working tree) for:
   - Ed25519 **private** keys (Phase 08.1 license signing)
   - Stripe secrets (`sk_live_`, `sk_test_`, `whsec_`)
   - Cloudflare API tokens
   - `GH_TOKEN`, `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
   - Google / Microsoft OAuth client secrets
   - Generic high-entropy strings
   - Tooling: `gitleaks` if available, else a structured `git log -p` + regex grep sweep.
2. **`.planning/` content review** (213 files) — flag personal data, real contact/customer names, or internal-sounding notes that read badly in public. Produce a list; user approves keep/redact per item.
3. **Stray tracked-item disposition** — identify the single tracked `.claude/` file; decide whether untracked `catalog_*.json` + `build_catalog.js` scratch files should be `.gitignore`d or deleted.

**Deliverable:** a short findings report. If history is dirty: present scrub (history rewrite via `git filter-repo` / BFG) vs. rotate-keys-and-accept, and let the user choose. **Verified already:** `.env.local` is gitignored (`.env.*` with `!.env.example`) and never committed; tracked source reads secrets via `loadEnv` at build time (no literal keys in source).

## Phase 2 — Documentation Set

### Root-level (GitHub community standards)

- **README.md** — front door:
  - One-line pitch + short "what is Aria" paragraph
  - Hero screenshot(s) reusing existing `landing/` assets
  - Feature highlights (condensed from `FEATURES.md`)
  - **Privacy / local-first story**: data stays on the machine; only scoped LLM prompts leave, with PII pre-routed to a local model
  - Architecture-at-a-glance diagram
  - Quick start (link to `docs/DEVELOPMENT.md`)
  - **"Built with Claude Code + GSD"** section linking `.planning/` as the decision log
  - Status / disclaimer (showcase project, no warranty, bring your own API keys)
  - License badge + link
- **LICENSE** — MIT, `Copyright (c) 2026 Mainland Tech`.
- **CONTRIBUTING.md** — light: how to file issues, link to dev setup, honest "primary maintainer; PRs welcome but not actively solicited" framing.
- **SECURITY.md** — security posture (local-first; what leaves the machine = scoped LLM prompts only; PII pre-routed to local model; SQLCipher-encrypted DB; secrets in OS keychain via safeStorage) + private vulnerability reporting instructions.
- **CODE_OF_CONDUCT.md** — Contributor Covenant (standard, lightweight).

### Under `docs/`

- **docs/DEVELOPMENT.md** — the real setup story, grounded in `package.json`:
  - Prereqs: Node 20 LTS, **pnpm** (not npm), Ollama + required models (Llama 3.1 8B / Qwen for routing; `nomic-embed-text` for embeddings)
  - **Electron 41.6.1 pinned** + native rebuild / ABI gotchas (`pnpm run rebuild:native`, dual node/electron build)
  - **Bring-your-own OAuth**: Google Cloud + Azure app-registration walkthrough → `.env.local` (`GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*`)
  - Commands: `dev`, `test:unit` / `test:e2e`, `typecheck`, `build`, the custom `lint:guard` grep ratchets (`scripts/grep-*.mjs`)
- **docs/ARCHITECTURE.md** — grounded in `src/` (read, not imagined):
  - main / preload / renderer split + IPC surface
  - SQLCipher DB + migration system
  - provider-adapter abstraction (Google / Microsoft / Todoist)
  - sensitivity router (local vs frontier LLM)
  - the `assertApproved` approval chokepoint (all outbound comms / calendar changes gated)
  - background scheduling (node-cron + p-queue + powerMonitor)

### Leave as-is (already good)

`docs/RELEASE-RUNBOOK.md`, `FEATURES.md`, `landing/`.

## Phase 3 — GitHub Scaffolding (light)

- `.github/ISSUE_TEMPLATE/bug_report.md`
- `.github/ISSUE_TEMPLATE/feature_request.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

Minimal, showcase-appropriate.

## Phase 4 — Metadata Cleanup

- `package.json`: add `"license": "MIT"`, `repository`, `homepage`, `author`, `bugs`. **Keep `"private": true`** (desktop app, not an npm package — prevents accidental publish).
- Optional tidy: `AGENTS.md` has stray auto-generated "Codex" references mixed with the Claude workflow.

## Out of Scope (YAGNI)

- Rewriting `.planning/` into a curated subset (user chose to keep it whole).
- Heavy governance (no `GOVERNANCE.md`, no maintainer roster — solo showcase).
- npm publishing (`private: true` stays).
- Source-available/BSL licensing (user chose permissive MIT).
- CI changes beyond what already exists (`.github/workflows/build.yml` stays).

## Open Inputs (defaulted under "proceed" — change is trivial)

- Copyright holder name: defaulted to **Mainland Tech**.
- These do not block planning; they are one-line edits during execution.

## Success Criteria

1. Pre-publish safety report produced; no secrets in history (or remediation chosen); `.planning/` sensitivity-reviewed and signed off.
2. README, LICENSE (MIT), CONTRIBUTING, SECURITY, CODE_OF_CONDUCT present and accurate.
3. `docs/DEVELOPMENT.md` lets a fresh developer install prereqs, supply their own OAuth creds, and run `pnpm dev` successfully.
4. `docs/ARCHITECTURE.md` accurately reflects `src/` (no invented modules).
5. `package.json` carries MIT license + repo metadata.
6. Repo is ready to flip to public with no embarrassing or sensitive content.

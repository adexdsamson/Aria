# Phase 13: Open-Source Release Prep - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning
**Source:** PRD Express Path (docs/superpowers/specs/2026-06-02-open-source-prep-design.md)

<domain>
## Phase Boundary

Publish Aria as a **source-available showcase** open-source project that is **well documented**. Deliver: a pre-publish safety pass (secret scan + sensitivity review) as a hard gate, a complete documentation set (README, LICENSE, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, docs/DEVELOPMENT.md, docs/ARCHITECTURE.md), light GitHub issue/PR templates, and package.json metadata cleanup.

**In scope:** docs authoring, license/metadata, pre-publish security/sensitivity audit, light GitHub community scaffolding.
**Out of scope:** code refactoring, CI changes beyond existing `.github/workflows/build.yml`, npm publishing, curating/rewriting `.planning/` (kept whole), source-available/BSL licensing (chose permissive MIT), heavy governance docs.

The actual GitHub "flip to public" action is a manual user step after this phase passes — the phase makes the repo *ready*.
</domain>

<decisions>
## Implementation Decisions

### OSS Posture
- Source-available showcase: user is the primary/sole maintainer; strong docs, light contribution scaffolding; "contributions welcome but not actively solicited."

### License
- **MIT**, fully open. Copyright holder: **Mainland Tech** (default from `ai@mainlandtech.com`; one-line edit if user prefers personal name).
- Accepted tradeoff: under MIT a fork can remove the Phase 08.1 subscription/paywall license check. User explicitly accepted this for adoption/showcase credibility.

### `.planning/` Disposition
- **Keep public** (all 213 tracked files) as the "built with Claude Code + GSD" decision-history narrative.
- BLOCKING precondition: run a sensitivity scan over `.planning/` before publish; produce a flagged list (personal data, real contact/customer names, internal-sounding notes) for user keep/redact sign-off.

### Pre-Publish Safety Pass (HARD GATE — runs first; nothing publishes until user signs off)
- **Full git-history secret scan** (entire history, not just working tree): Ed25519 PRIVATE keys (Phase 08.1 license signing — highest risk), Stripe `sk_`/`whsec_`, Cloudflare tokens, `GH_TOKEN`, `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`, Google/MS OAuth client secrets, generic high-entropy strings. Tooling: `gitleaks` if available, else structured `git log -p` + regex sweep.
- **`.planning/` content review** (213 files) → flagged list for sign-off.
- **Stray tracked-item disposition**: identify the 1 tracked `.claude/` file; decide whether untracked `catalog_*.json` + `build_catalog.js` get `.gitignore`d or deleted.
- Deliverable: a short findings report. If history is dirty → present scrub (git filter-repo/BFG) vs rotate-keys-and-accept; user chooses.
- **Already verified clean:** `.env.local` is gitignored via `.env.*` (with `!.env.example`) and never committed; tracked source reads secrets via `loadEnv` at build time (no literal keys in source).

### Documentation Set
- **README.md** (root): one-line pitch + short blurb; hero screenshot(s) reusing `landing/` assets; condensed feature highlights from `FEATURES.md`; local-first/privacy story (data stays on machine; only scoped LLM prompts leave; PII pre-routed to local model); architecture-at-a-glance diagram; quick start linking docs/DEVELOPMENT.md; "Built with Claude Code + GSD" section linking `.planning/`; status/disclaimer (showcase, no warranty, bring-your-own API keys); license badge.
- **LICENSE** (root): MIT, `Copyright (c) 2026 Mainland Tech`.
- **CONTRIBUTING.md** (root): light — issue filing, link to dev setup, honest "primary maintainer; PRs welcome but not actively solicited" framing.
- **SECURITY.md** (root): posture (local-first; only scoped LLM prompts leave; PII pre-routed to local model; SQLCipher-encrypted DB; secrets via Electron safeStorage/OS keychain) + private vulnerability reporting.
- **CODE_OF_CONDUCT.md** (root): Contributor Covenant, standard.
- **docs/DEVELOPMENT.md**: grounded in package.json — Node 20 LTS + **pnpm** (not npm); Ollama install + required models (Llama 3.1 8B / Qwen routing; nomic-embed-text embeddings); **Electron 41.6.1 pinned** + native rebuild/ABI gotchas (`pnpm run rebuild:native`, dual node/electron build); **bring-your-own OAuth** (Google Cloud + Azure app-registration walkthrough → `.env.local` with `GOOGLE_OAUTH_*`/`MICROSOFT_OAUTH_*`); commands (`dev`, `test:unit`/`test:e2e`, `typecheck`, `build`); the custom `lint:guard` grep ratchets in `scripts/grep-*.mjs`.
- **docs/ARCHITECTURE.md**: grounded in actual `src/` (read, not imagined) — main/preload/renderer split + IPC surface; SQLCipher DB + migration system; provider-adapter abstraction (Google/Microsoft/Todoist); sensitivity router (local vs frontier); the `assertApproved` approval chokepoint (all outbound comms/calendar changes gated); background scheduling (node-cron + p-queue + powerMonitor).
- Leave as-is: `docs/RELEASE-RUNBOOK.md`, `FEATURES.md`, `landing/`.

### GitHub Scaffolding (light)
- `.github/ISSUE_TEMPLATE/bug_report.md`, `.github/ISSUE_TEMPLATE/feature_request.md`, `.github/PULL_REQUEST_TEMPLATE.md`. Minimal.

### Metadata Cleanup
- package.json: add `"license": "MIT"`, `repository`, `homepage`, `author`, `bugs`. **Keep `"private": true`** (desktop app, not an npm package — prevents accidental publish).
- Optional tidy: `AGENTS.md` has stray auto-generated "Codex" references mixed with the Claude workflow.

### Claude's Discretion
- Exact README section ordering, diagram format (ASCII vs mermaid), and prose.
- Whether ARCHITECTURE.md uses a mermaid diagram or prose+tree.
- Repository URL value in package.json (use a sensible GitHub placeholder; user confirms).
- Sequencing/wave structure of the plans (safety pass must gate doc publish-readiness).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Source spec
- `docs/superpowers/specs/2026-06-02-open-source-prep-design.md` — the approved design this phase implements (full rationale, decision table, success criteria).

### Existing assets to reuse / reflect accurately
- `package.json` — authoritative dep versions, scripts, electron-builder config (ground DEVELOPMENT.md here).
- `.gitignore` — confirms `.env.*` ignore + `!.env.example` whitelist.
- `.env.example` / `.env.local.example` — the env vars a contributor must supply.
- `AGENTS.md` — existing GSD-generated project + stack context (basis for ARCHITECTURE.md; note Codex/Claude inconsistency).
- `FEATURES.md` — feature catalog to condense into README highlights.
- `docs/RELEASE-RUNBOOK.md` — existing release docs (leave as-is; link from DEVELOPMENT.md).
- `landing/` — existing screenshots/SVG assets for README hero.
- `src/` (main/preload/renderer) — read to write an accurate ARCHITECTURE.md.

### Memory / history to honor
- Phase 08.1 subscription layer (Stripe + Cloudflare license server + Ed25519) — the secret-scan focus.
- Native ABI pain (Electron 41 pin, dual rebuild) — must appear in DEVELOPMENT.md troubleshooting.
</canonical_refs>

<specifics>
## Specific Ideas

- README "Built with Claude Code + GSD" section turns the kept `.planning/` directory into a feature, linking to ROADMAP and a few representative phase decision docs.
- DEVELOPMENT.md must call out the better-sqlite3 ABI lock (running the desktop app blocks vitest; close app before tests) since it will bite any contributor.
- SECURITY.md should state plainly what data leaves the machine and what does not.
</specifics>

<deferred>
## Deferred Ideas

- Curating `.planning/` into a polished public subset (chose to keep whole).
- Heavy governance (GOVERNANCE.md, maintainer roster).
- npm publishing.
- Source-available/BSL license.
- The actual GitHub visibility flip (manual user action post-phase).
</deferred>

---

*Phase: 13-open-source-release-prep-publish-aria-as-a-documented-source*
*Context gathered: 2026-06-02 via PRD Express Path*

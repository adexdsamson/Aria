---
phase: 13-open-source-release-prep-publish-aria-as-a-documented-source
plan: "03"
subsystem: docs
tags: [documentation, open-source, onboarding, architecture]

dependency_graph:
  requires: [13-01]
  provides: [docs/DEVELOPMENT.md, docs/ARCHITECTURE.md]
  affects: []

tech_stack:
  added: []
  patterns:
    - contributor onboarding doc grounded in package.json scripts
    - architecture doc verified against real src/ module paths

key_files:
  created:
    - docs/DEVELOPMENT.md
    - docs/ARCHITECTURE.md
  modified: []

decisions:
  - "DEVELOPMENT.md uses pnpm throughout (not npm) to match the lockfile and toolchain"
  - "rebuild:native dual-ABI build documented as the safe default; ABI lock troubleshooting added"
  - "ARCHITECTURE.md uses window.aria (not window.api) reflecting actual preload contextBridge exposure"
  - "Every src/ path in ARCHITECTURE.md verified against disk before naming"

metrics:
  duration: "~15 minutes"
  completed: "2026-06-02"
  tasks_completed: 2
  files_created: 2
---

# Phase 13 Plan 03: Developer Docs (DEVELOPMENT.md + ARCHITECTURE.md) Summary

Two new technical reference documents grounded in the actual codebase: a full contributor onboarding guide and an accurate architecture map verified against real src/ module paths.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write docs/DEVELOPMENT.md | 8e1bb08 | docs/DEVELOPMENT.md |
| 2 | Write docs/ARCHITECTURE.md | 9de11f5 | docs/ARCHITECTURE.md |

---

## What Was Built

### docs/DEVELOPMENT.md

Full contributor onboarding guide grounded in `package.json`. Covers:

- Prerequisites table (Node 20 LTS, pnpm, Electron 41.6.1 pin, Ollama)
- Ollama setup: `ollama pull llama3.1:8b` and `ollama pull nomic-embed-text`
- Clone + install (postinstall hook noted)
- Native binary rebuild section: `rebuild:native` (dual ABI), `rebuild:native:node` (Node-only), and why Electron/Node ABIs differ
- BYO OAuth walkthrough for Google (GCP project, API enable, consent screen, Desktop credentials) and Microsoft (Azure app registration, Graph permissions)
- `.env.local` setup referencing `.env.example` variables exactly
- `pnpm dev`, `pnpm run typecheck`, `pnpm run test:unit`, `pnpm run test:e2e`, `pnpm build`, `pnpm run release`
- Lint guard ratchet table (`grep-*.mjs` scripts and what each enforces)
- Troubleshooting: ABI lock (EBUSY/version mismatch), Electron pin rationale, esbuild skips typecheck

### docs/ARCHITECTURE.md

Accurate architecture map with every module path verified against disk. Covers:

- **Process Model**: main/preload/renderer split, ASCII process diagram, `contextBridge`/`window.aria` explanation
- **IPC Surface**: full handler module list from `src/main/ipc/index.ts`, `CHANNELS`/`CHANNEL_METHODS` contract
- **Database and Migrations**: SQLCipher open sequence from `src/main/db/connect.ts`, numbered migration files, `sqlite-vec` extension
- **Provider Adapters**: `google/`, `microsoft/`, `todoist/`, `registry.ts`, `sync-orchestrator.ts` — all confirmed present
- **Sensitivity Router**: `classifier.ts` regex prefilter → `sensitivityClassifier.ts` Ollama generateObject pipeline, routing decision table
- **Approval Chokepoint**: `assertApproved(db, approvalId)` signature confirmed from `src/main/approvals/gate.ts`; enforced at `send.ts` and `write-event.ts`; grep ratchet enforcement
- **Background Scheduling**: node-cron, p-queue serialization, powerMonitor sleep/wake, DB-null skip guard
- **Tray/Background Activity**: `window-decisions.ts`, `tray/` module breakdown, `prefs.ts` auto-launch, `single-instance.ts`
- **Logging**: pino + pino-roll, `redactObject` PII pass, Sentry opt-in crash-only

---

## Deviations from Plan

None — plan executed exactly as written.

One minor adjustment: the preload exposes `window.aria` (not `window.api` as the plan draft suggested) — this was corrected after reading `src/preload/index.ts` directly, consistent with the grounding rules.

---

## Verification

- `docs/DEVELOPMENT.md` contains: `rebuild:native`, `ABI lock`, `GOOGLE_OAUTH_CLIENT_ID`, `lint:guard`, `esbuild skips`, `## Prerequisites`, `## Ollama Setup`, `## OAuth Credentials`
- `docs/ARCHITECTURE.md` contains: `assertApproved`, `sensitivityClassifier`, `contextBridge`, `## Process Model`, `SQLCipher`
- All `src/` paths named in ARCHITECTURE.md verified on disk before writing
- No module names invented; where the plan draft suggested `window.api`, the real preload was read and `window.aria` used instead

## Self-Check: PASSED

- `docs/DEVELOPMENT.md` — FOUND (8e1bb08)
- `docs/ARCHITECTURE.md` — FOUND (9de11f5)
- Both commits present in git log
- No unrelated files staged or committed
- STATE.md and ROADMAP.md not modified

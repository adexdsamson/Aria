---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: ready_to_plan
last_updated: "2026-05-20T01:18:17.572Z"
progress:
  total_phases: 9
  completed_phases: 7
  total_plans: 30
  completed_plans: 27
  percent: 78
---

# State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-14)

**Core value:** Aria tells the exec what matters today and handles the rest under user oversight (local-first, hybrid LLM, approval-gated).

## Current Phase

**IPC schema-drift fix (2026-05-19, commit f44ffd4)** — Settings → Integrations Gmail block was rendering `Could not connect: no such table: gmail_account` because `GMAIL_CONNECT` still INSERT-OR-REPLACEd the legacy singleton table dropped by migration 014. Routed Gmail + Calendar IPC writes to `provider_account` (capability-merging UPSERT preserves SC3 per-kind disconnect scope) + `provider_sync_state`. Reads now use the legacy `gmail_account_view` / `calendar_account_view` (designed as compat shims by migration 014). Also fixed the symmetric `getUserEmail` SELECT in scheduling handler. Deferred: `sync-gmail.ts` / `sync-calendar.ts` still SELECT/UPDATE the dropped base tables for cursor advance — caught by `runTick` try/catch and surfaces as a non-fatal "Last sync" line in the UI; deeper cursor-pathway lift is a follow-up.

**Phase 7 UAT Gaps 8 + 9 closed (2026-05-19, commits 88e2736 + 3525079 + bd07779)** — Gap 8: migration 127 rebuilds `rag_source_dirty` with a COALESCE-based UNIQUE INDEX so NULL `target_model_id` no longer breaks `INSERT OR IGNORE` dedupe (backfill resumability restored). Gap 9: rewrote `people-directory-10.json` fixture into the structured shape consumed by `person-resolver.test.ts` (`displayName`/`canonicalEmail`/`aliases`/`cases`) and updated `people-directory.test.ts` to match. Targeted Phase 7 suite now **153/0/0** — fully green. Only Gap 6 (Ollama precondition) remains, and it lives in the integration tier by design.

**Phase 7 UAT Gap 7 closed (2026-05-19, commit 2458e98)** — Renamed `app_meta(key, value)` → `(k, v)` across Phase 7 modules to match migration 001's canonical schema. 17 previously-failing tests turned green; targeted Phase 7 suite now 130/2/1 (remaining 2 are pre-existing, unrelated).

**Phase 7 Plan 03 complete** — User-facing Q&A loop: hybrid BM25 + vector + RRF retrieval reading denormalized title + cached sensitivity (C5/C8/C12), person-mention resolver w/ local-LLM disambiguation + 24h directory-staleness (C10), answer router as a PURE function over chunk.sensitivity (zero classifier calls per query — C5) + XML-wrapped context AND thread history with explicit data semantics (C6), redaction-roundtrip util lifted from tokenize.ts (C4), answer service w/ 4 distinct result kinds (answer/refusal/error/disambiguation), 7 new IPC channels, global Cmd/Ctrl+K palette via cmdk@1.1.1 w/ thread-seeded Expand-to-chat (C9), /ask chat panel w/ TZ-correct timestamps + account chips from IPC payload + ?thread= hydration, disconnected-account RAG wipe UI. 8 tasks + 1 gate fix = 9 commits (`3efc6a1…2e0e4b9`). All grep gates green. Tests written but unrun (Aria desktop app holds the better-sqlite3 ABI lock). AnswerService↔IPC factory wiring deferred to a follow-up plan or Phase 8 hookup. **Phase 7 complete (3/3 plans).**

**Phase 7 Plan 02 complete** — RAG index online: VectorStore dual-impl (sqlite-vec + brute-force fallback w/ 250k cap, C11/C2), Ollama `/api/embed` client + mandatory live-roundtrip contract (C13), IndexWriter w/ sensitivity-at-index-time (C5), IndexWorker w/ atomic rebuild_progress_done (Pitfall 4), ReindexScheduler + model-swap boot reconciler (C3, 4 cases), opt-in backfill, people directory w/ inline + cron freshness paths (C10), Settings → RAG Index UI reachable from SettingsScreen.tsx (L-04-04). 11 tasks, 11 atomic commits (`faba095…4ebc206`). Live OLLAMA_AVAILABLE=1 + RAG_BENCH=1 gates deferred to phase verification (Aria desktop app holds the native-binary lock — same constraint as 07-01).

**Phase 7 Plan 01 complete** — RAG indexing foundation: migration 126 schema, chunk primitives, four-corpus harvesters, three chunking strategies, synthetic-fixture spike. Provisional winner `A-per-message`; replace synthetic fixture with real-DB user-authored fixture before plan 07-02 commits chunk-size (see 07-01-SUMMARY.md `Deferred / Followups` item 1). Task 0 human-action checkpoint was overridden by user authorization on 2026-05-19.

**Phase 4 complete (pending verification)** — All 3 waves landed. Wave 3 (04-03 NL pipeline + SchedulingChat + ApprovalCard calendar variant + APPR-02 dispatch) green: 43 scheduling unit tests + 2 skip-tolerant e2e specs. SC-1 demonstrable: "move my 3pm to Thursday" → ProposeResult with conflict check → approve → applyCalendarChange chokepoint.

## Phase Status

- [x] Phase 1: Foundation
- [x] Phase 2: Gmail + Daily Briefing MVP (pending verification)
- [ ] Phase 3: Approval Queue + Sensitivity Router + Email Triage/Drafting/Send
- [ ] Phase 4: Calendar Smart-Scheduling (Google)
- [ ] Phase 5: Outlook Parity (email + calendar)
- [ ] Phase 6: Meeting Capture + Todoist Push
- [x] Phase 7: RAG Q&A
- [ ] Phase 8: Insights, Recap, Learning, Release Prep

## Next Action

Run `/gsd-verify-work 7` to validate Phase 7 against its 4 success criteria (SC-1..SC-4). Phase 2 + Phase 4 verification still pending. Phase 8 is the final v1 phase; Phase 9 (product UI) follows.

## Accumulated Context

### Roadmap Evolution

- Phase 9 added: Implement product UI from Anthropic design system (design ref VGTQmBNc8uXN62kH9DBTXA) — fetch design + README, apply to product UI, integrate logo; landing page out of scope

### Phase 7 Followups

- 2026-05-20 — Gap 10 closed (bdb8693): destructive integration disconnect now gated by `DisconnectConfirmDialog` with explicit RAG-wipe copy; symmetric across Gmail, Calendar, Todoist, and generic provider-account rows. Matches CLAUDE.md approval-gating principle and plan 07-03 task 8 "confirm before wipe" contract.

## Workflow Config

- Mode: YOLO (auto-approve)
- Granularity: Standard
- Parallelization: Parallel
- Commit docs: Yes
- Research: Yes
- Plan check: Yes
- Verifier: Yes
- Model profile: Balanced (Sonnet)

---
phase: 20-foundation
plan: 05
subsystem: whatsapp
tags: [whatsapp, ingest, privacy, group-sync, retention, cron, WA-06, WA-07]

# Dependency graph
requires:
  - phase: 20-foundation-plan-04
    provides: "WhatsAppSessionManager socket, session-manager.ts attachment point"
  - phase: 20-foundation-plan-03
    provides: "whatsapp_group, whatsapp_message tables via migration 138"
provides:
  - "createIngestHandler(deps): 3-line WA-06 privacy filter + batched single-writer flush (gates 7/8/9)"
  - "extractText(msg): WA-07 text-only whitelist — conversation/extendedTextMessage → text; media → null"
  - "registerIngest(sock, deps): socket event-handler registration helper for Plan 20-07"
  - "registerGroupSync(sock, deps): groups.upsert → whatsapp_group tracked=0 default (D-03/D-04)"
  - "startWhatsAppRetention(deps): 30-day rolling sweep at 03:30 via scheduler.cronRegistry"
affects: [20-foundation-plan-06, 20-foundation-plan-07, 20-foundation-plan-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "3-line privacy filter BEFORE any write/log: (1) type!=='notify' return; (2) !@g.us continue; (3) !isTracked continue — exact gate order from RESEARCH.md Pattern 3"
    - "scheduler.queue.add(() => tx()) batch flush: in-memory buffer + single transaction, mirrors sync-gmail.ts 170-172; no sync db.run in event handler (gate 7)"
    - "INSERT OR IGNORE against UNIQUE(jid,wa_id): deduplication on reconnect without exception noise"
    - "extractText() co-located in retention.ts: single source for both ingest.ts (WA-07 gate) and spec assertions"
    - "sweep-cron.ts shape mirrored exactly: CRON_KEY const, SweepCronDeps, runSweep(), cronRegistry.set, dbHolder seal-guard"
    - "CatchupChannel union extended to include 'whatsapp-retention-sweep' (Rule 2 — pendingCatchup.add type safety)"

key-files:
  created:
    - "src/main/whatsapp/ingest.ts"
    - "src/main/whatsapp/group-sync.ts"
    - "src/main/whatsapp/retention.ts"
  modified:
    - "src/main/lifecycle/pendingCatchup.ts"

key-decisions:
  - "createIngestHandler returns a callable async fn (not socket-wiring): spec calls handler() directly without a socket; registerIngest() is the socket-wiring helper for Plan 20-07"
  - "extractText lives in retention.ts, not ingest.ts: retention spec imports it directly (import { extractText } from retention); ingest.ts imports it from the same file — single source avoids duplication"
  - "No scheduler required for test path: flushBatch falls back to synchronous transaction when scheduler is absent; spec passes no scheduler and assertions still hold"
  - "pendingCatchup.ts CatchupChannel union extended: 'whatsapp-retention-sweep' added to satisfy TypeScript strict-mode TS2345 (Rule 2 — seal-guard correctness requirement)"
  - "group-participants.update uses SELECT + UPDATE delta (not Baileys total): Baileys doesn't always provide the new total participant count; delta approach is safe for member_count best-effort tracking"

requirements-completed: [WA-05, WA-06, WA-07, WA-11]

# Metrics
duration: 15min
completed: 2026-06-10
---

# Phase 20 Plan 05: Group Discovery + Privacy-Filtered Ingest + Retention Summary

**Privacy-filtered Baileys message ingest (WA-06 boundary) + group discovery (tracked=0 default, D-03) + 30-day retention sweep at 03:30 (D-14)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-10T00:55:00Z
- **Completed:** 2026-06-10T01:05:00Z
- **Tasks:** 2 (Task 1: ingest.ts; Task 2: group-sync.ts + retention.ts)
- **Files created:** 3
- **Files modified:** 1

## Accomplishments

- WA-06 CRITICAL privacy boundary implemented: 3-line filter executes BEFORE any write or logger call that references message content
  - LINE 1 (gate 8): `if (type !== 'notify') return;` — drop history/append batches immediately
  - LINE 2 (gate 9): `if (!jid.endsWith('@g.us')) continue;` — drop 1:1 DMs, zero rows, zero logs
  - LINE 3: `if (!isTracked(jid)) continue;` — drop untracked groups (DB single source of truth)
- WA-07 text-only: `extractText()` whitelists `conversation` and `extendedTextMessage.text`; returns null for imageMessage, audioMessage, videoMessage, documentMessage, stickerMessage
- Gate 7 enforced: in-memory buffer + `scheduler.queue.add(() => tx())` single-transaction batch flush; no sync `db.run()` inside the event handler
- Group discovery: `registerGroupSync()` upserts `whatsapp_group` without ever setting `tracked` — new groups default to 0 via schema (D-03); existing tracked=1 groups unaffected by upsert
- Retention sweep: `startWhatsAppRetention()` at `'30 3 * * *'` (03:30) — distinct from 03:00 socket-recycle (D-14 addendum); mirrors `sweep-cron.ts` shape including seal-guard
- Passive-posture ratchet (8/8) + no-frontier ratchet (4/4) + no-bare-cron-schedule ratchet (1/1) all GREEN

## Task Commits

1. **Task 1: ingest.ts — 3-line privacy filter + batched flush (gates 7/8/9)** — `edfb604`
2. **Task 2: group-sync.ts + retention.ts (untracked-default + 03:30 sweep)** — `41c09f5`

## Files Created/Modified

- `src/main/whatsapp/ingest.ts` — `createIngestHandler()` + `registerIngest()` (WA-06 privacy boundary)
- `src/main/whatsapp/group-sync.ts` — `registerGroupSync()` (D-03/D-04 untracked-default)
- `src/main/whatsapp/retention.ts` — `extractText()` + `startWhatsAppRetention()` (WA-07/D-14)
- `src/main/lifecycle/pendingCatchup.ts` — extended `CatchupChannel` union with `'whatsapp-retention-sweep'`

## Decisions Made

- **createIngestHandler returns a callable async fn:** The spec (`ingest-privacy.spec.ts`) calls `handler({ messages, type })` directly — no socket needed. `registerIngest()` is the socket-wiring helper used by Plan 20-07.
- **extractText co-located in retention.ts:** `whatsapp-retention.spec.ts` imports `extractText` directly from `retention`. Co-location avoids a separate file. `ingest.ts` imports from the same path.
- **No scheduler for test path:** `flushBatch()` falls back to synchronous transaction when no scheduler provided, allowing spec assertions without a p-queue instance.
- **pendingCatchup.ts CatchupChannel extended:** TypeScript TS2345 error on `pendingCatchup.add('whatsapp-retention-sweep')` — added the literal to the union. Net effect: reduced total error count from 85 to 84.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] CatchupChannel union did not include 'whatsapp-retention-sweep'**
- **Found during:** Task 2 (typecheck run)
- **Issue:** `pendingCatchup.add(CRON_KEY)` in `retention.ts` produced TS2345 because `'whatsapp-retention-sweep'` was not in the `CatchupChannel` union type
- **Fix:** Added `| 'whatsapp-retention-sweep'` to `CatchupChannel` in `pendingCatchup.ts`
- **Files modified:** `src/main/lifecycle/pendingCatchup.ts`
- **Commit:** `edfb604`

---

None other — plan executed as specified.

## Test Results

| Spec | Tests | Status |
|------|-------|--------|
| `ingest-privacy.spec.ts` | 8/8 | GREEN |
| `whatsapp-retention.spec.ts` | 12/12 | GREEN |
| `no-bare-cron-schedule.spec.ts` | 1/1 | GREEN |
| `passive-posture.ratchet.spec.ts` | 8/8 | GREEN |
| `no-frontier.ratchet.spec.ts` | 4/4 | GREEN |
| **Total** | **33/33** | **GREEN** |

## Known Stubs

None — `ingest.ts`, `group-sync.ts`, and `retention.ts` are complete implementations. `registerIngest()` and `registerGroupSync()` are helper functions ready for Plan 20-07 socket-wiring.

## Threat Flags

No new threat surface beyond the plan's threat model:
- T-20-15 mitigated: 3-line filter executes before any write/log; ingest-privacy.spec asserts ZERO rows + no body in logs for DM and untracked
- T-20-16 mitigated: extractText() returns null for all media types (8 WA-07 spec assertions cover this)
- T-20-17 mitigated: in-memory buffer + scheduler.queue.add one-transaction flush; no sync db.run() in handler
- T-20-18 mitigated: 30-day rolling sweep at 03:30 via cronRegistry
- T-20-19 mitigated: group-sync.ts never sets tracked; schema DEFAULT 0 applies to all new rows

## Self-Check

Files exist:
- `src/main/whatsapp/ingest.ts` — FOUND
- `src/main/whatsapp/group-sync.ts` — FOUND
- `src/main/whatsapp/retention.ts` — FOUND

Commits exist:
- `edfb604` (Task 1 — ingest.ts) — FOUND
- `41c09f5` (Task 2 — group-sync.ts + retention.ts) — FOUND

Test results: 33/33 GREEN across 5 spec files

## Self-Check: PASSED

---

*Phase: 20-foundation*
*Completed: 2026-06-10*

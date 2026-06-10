---
phase: 21
slug: digest-briefing-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-10
---

# Phase 21 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `21-RESEARCH.md` § Validation Architecture (all source cites VERIFIED against live code).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2.x |
| **Config file** | `vitest.config.ts` (project root) |
| **Quick run command** | `npx vitest run tests/unit/main/whatsapp/ -x` |
| **Full suite command** | `npx vitest run tests/unit/main/whatsapp/ tests/unit/main/ipc/ tests/unit/renderer/features/briefing/` |
| **Estimated runtime** | ~30 seconds (scoped subset) |

> Note: project-wide vitest has a parallel-projects race (see memory) — run scoped specs, not the full repo suite, during phase work.

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run tests/unit/main/whatsapp/ -x`
- **After every plan wave:** Run `npx vitest run tests/unit/main/whatsapp/ tests/unit/main/ipc/ tests/unit/renderer/features/briefing/`
- **Before `/gsd-verify-work`:** Full scoped suite must be green
- **Max feedback latency:** ~30 seconds

---

## Per-Task Verification Map

| Req / Decision | Behavior | Test Type | Automated Command | File Exists |
|----------------|----------|-----------|-------------------|-------------|
| WA-08 | Today's digest row surfaces in briefing payload as `whatsApp.state='ready'` with `groups[].state='summarized'` | unit | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts -x` | ❌ W0 |
| WA-08 | D-10 state matrix: not-linked→undefined, zero-groups→undefined, sub-threshold→undefined, failed→`unavailable`, ready→`ready` | unit | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts -x` | ❌ W0 |
| WA-08 | Renderer renders WhatsApp section when `payload.whatsApp.state='ready'` | unit (renderer) | `npx vitest run tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx -x` | ✅ extend |
| WA-08 | Renderer renders "unavailable" note + Generate-now retry when `state='unavailable'` | unit (renderer) | `npx vitest run tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx -x` | ✅ extend |
| WA-09 | SC3 no-frontier ratchet stays GREEN with `digest-cron.ts` added under `src/main/whatsapp/` | static | `npx vitest run tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` | ✅ SHIPPED/GREEN |
| WA-10 | Briefing payload still returned when `generateText` throws (Ollama-down sim) | unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ W0 |
| WA-10 | `readWhatsAppDigests` returns `unavailable` when rows have `summary_text=NULL` | unit | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts -x` | ❌ W0 |
| D-06 | `UNIQUE(jid,date)`: re-running digest creates no duplicate rows (idempotent) | unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ W0 |
| D-07.1 | pendingCatchup: `'whatsapp-digest'` added when DB sealed, runs once on unlock via real `runChannelOnce` branch | unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ W0 |
| D-07.2 | powerMonitor resume: missed-tick triggers `runNow()` when `MAX(date) < today` (per-day guard) | unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ W0 |
| D-07.3 | Briefing-read fallback: `BRIEFING_TODAY` never awaits digest generation; response never throws | unit | `npx vitest run tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts -x` | ❌ W0 |
| D-09 | Partial p-queue failure: early groups summarized, later group fails → `ready` arm with mixed sub-states (good summaries preserved) | unit | `npx vitest run tests/unit/main/whatsapp/digest-cron.spec.ts -x` | ❌ W0 |

*Status legend: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky. Per-task IDs assigned by planner; rows map to PLAN task acceptance criteria.*

---

## Wave 0 Requirements

- [ ] `tests/unit/main/whatsapp/digest-cron.spec.ts` — stubs for WA-10, D-06, D-07.1, D-07.2, D-09 (mock `getLocalModel`/`generateText`, in-memory `better-sqlite3` DB)
- [ ] `tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` — stubs for WA-08, WA-10, D-07.3, D-10 state matrix (stubbed digest rows + `provider_account` status)
- [ ] `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` — EXISTS; extend with WhatsApp union-state cases (mirror `InsightsSection` stubbed-payload pattern)

*No new framework install — Vitest + `@testing-library/react` + in-memory `better-sqlite3` + `vi.fn()` seams already cover all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Local-model digest content quality (exec-framing actually reads well; mentions heuristic surfaces the right references) | WA-08 (Claude's-discretion prompt) | Output quality of a quantized 8B/7B model is not deterministically assertable; flagged as highest-uncertainty deliverable | Run a real digest against a live tracked group with ≥1 day of messages; eyeball `### KEY POINTS / DECISIONS / OPEN QUESTIONS / MENTIONS` for exec-quality and correct mention surfacing. Iterate prompt in UAT. |
| End-to-end 05:00→07:00 timing + graceful degradation with Ollama actually stopped | WA-09, WA-10 | Real cron timing + real Ollama-offline path cross process boundaries | Stop Ollama, trigger digest + briefing read; confirm briefing renders the "unavailable — local model offline" note with a working Generate-now retry, and never errors. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (3 spec files above)
- [ ] No watch-mode flags (use `vitest run`, not `vitest`)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

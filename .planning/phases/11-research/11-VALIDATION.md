---
phase: 11
slug: research
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-21
---

# Phase 11 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2 |
| **Config file** | vitest.config.ts (existing) |
| **Quick run** | `npx vitest run tests/unit/main/research-service.spec.ts tests/unit/main/search-provider-service.spec.ts --passWithNoTests` |
| **Full suite** | `npx vitest run --passWithNoTests` |
| **TypeScript check** | `npx tsc --noEmit` |

---

## Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | File | Wave |
|--------|----------|-----------|------|------|
| RES-01 | Job create validates input, inserts row, returns jobId | unit | `tests/unit/main/research-service.spec.ts` | 3 |
| RES-02 | Brave + Exa both called; results deduped by URL | unit (MSW) | `tests/unit/main/search-provider-service.spec.ts` | 3 |
| RES-02 | Graceful degradation: Brave key missing -> Exa only | unit (MSW) | same | 3 |
| RES-02 | Graceful degradation: Exa key missing -> Brave only | unit (MSW) | same | 3 |
| RES-02 | Jina fetch timeout (>10s) skips URL, run continues | unit (MSW) | same | 3 |
| RES-03 | Scheduled refresh fires cron; new report version=2 written | unit (vi.useFakeTimers) | `tests/unit/main/research-service.spec.ts` | 3 |
| RES-04 | Auto-detect: LLM extracts topics from transcript; draft jobs inserted | unit (MSW LLM) | same | 3 |
| RES-05 | Document view renders sections; Dashboard view renders stat cards + chart | UI render | `tests/unit/renderer/research-screen.spec.tsx` | 3 |
| RES-05 | Toggle switches between Document and Dashboard views | UI render | same | 3 |
| RES-06 | Feedback save writes research_feedback row (sentiment + note) | integration | `tests/integration/research-ipc.spec.ts` | 3 |
| RES-07 | Re-run creates new version; version nav shows N of M | integration | same | 3 |
| RES-08 | Start Research button disabled + tooltip when both keys absent | UI render | `tests/unit/renderer/research-screen.spec.tsx` | 3 |
| Static | Only `researchJobRun` sets `job.status = 'running'` | static grep | `tests/static/research-running-ratchet.spec.ts` | 1 |
| Entitlement | `assertEntitled` called from research.ts only | static grep | `tests/static/single-entitlement-gate-site.test.ts` | 2 (updated + GREEN) |

---

## Wave 0 Stubs (created in Wave 1)

| File | Status | Created by |
|------|--------|------------|
| `tests/unit/main/research-service.spec.ts` | stub | Plan 01 Task 2 |
| `tests/unit/main/search-provider-service.spec.ts` | stub | Plan 01 Task 2 |
| `tests/integration/research-ipc.spec.ts` | -- | No longer created by Plan 01; integration stub pattern deferred to Plan 03 |
| `tests/static/research-running-ratchet.spec.ts` | create | Plan 01 Task 2 |
| `tests/static/single-entitlement-gate-site.test.ts` | update + GREEN | Plan 02 Task 1 (not Plan 01) |

---

## Sampling Schedule

| Checkpoint | Command |
|------------|---------|
| Per task commit (Wave 1) | `npx vitest run tests/unit/main/research-service.spec.ts tests/unit/main/search-provider-service.spec.ts --passWithNoTests` |
| Per wave merge | `npx vitest run --passWithNoTests` |
| After Wave 2 renderer | `npx tsc --noEmit 2>&1 \| grep "src/renderer/features/research" \| head -20` |
| After Wave 2 ratchet | `npx vitest run tests/static/single-entitlement-gate-site.test.ts` (expect FULL GREEN) |
| Phase gate (Wave 3) | `npx vitest run --passWithNoTests` (full suite green) |

---

## Security Validation

| Control | Verified by |
|---------|-------------|
| `assertEntitled` on job create + run | `single-entitlement-gate-site.test.ts` ratchet (GREEN from Wave 2) |
| API keys never in SQLite | integration test: assert `research_job` has no key columns; safeStorage mock in unit tests |
| Jina SSRF mitigation | unit test: assert Aria calls `r.jina.ai/<url>` and not the raw URL directly |
| Prompt injection in page content | unit test: synthesized output does not contain injected `<instruction>` tags |

---

## Assumptions

| # | Claim | Risk |
|---|-------|------|
| A1 | CSS-only bars sufficient for coverage chart | Low |
| A2 | zod available as peer dep of ai package | Very low |
| A3 | Per-job cronRegistry entries don't collide with existing fixed-size assertions | Confirmed LOW (see RESEARCH.md Open Questions resolved) |

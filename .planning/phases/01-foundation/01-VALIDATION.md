---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x (unit/integration), playwright `_electron` 1.48+ (E2E) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` — Wave 0 installs |
| **Quick run command** | `pnpm test:unit` (vitest run --changed) |
| **Full suite command** | `pnpm test` (vitest run && playwright test) |
| **Estimated runtime** | ~30s unit, ~90s full incl. E2E |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test:unit`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (unit)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01-04 | TBD | FOUND-01..07, LLM-01..05 | TBD | TBD | TBD | TBD | ❌ W0 | ⬜ pending |

*Populated by planner during PLAN.md generation. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Install vitest + @vitest/coverage-v8
- [ ] Install playwright + @playwright/test
- [ ] Create `vitest.config.ts` (jsdom env for renderer, node env for main)
- [ ] Create `playwright.config.ts` with `_electron` launcher
- [ ] Create `tests/setup.ts` shared fixtures (temp userData dir, mock keychain)
- [ ] Add `pnpm test:unit` / `pnpm test:e2e` / `pnpm test` scripts

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Frontier API key never written to disk in plaintext | FOUND-06 | Requires filesystem inspection of userData | After saving key in Settings, grep userData dir for known prefix (e.g. `sk-ant-`); must return no matches |
| Ollama-missing graceful warning UX | FOUND-07 | Visual/UX judgement | Stop Ollama; launch app; confirm Settings shows "Ollama not detected" with install link, not a stack trace |
| Encrypted backup/restore roundtrip on real disk | FOUND-04 | Touches filesystem + passphrase prompt | Create DB → write row → backup → wipe userData → restore with passphrase → row present |
| SQLCipher file unreadable without key | FOUND-03 | Requires sqlite3 CLI outside the app | Open `.db` file with stock sqlite3 — must error / show no readable tables |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

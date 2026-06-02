---
quick_id: 260602-l4c
slug: fix-dark-mode-white-backgrounds-in-phase
status: complete
date: 2026-06-02
---

# 260602-l4c SUMMARY — Dark-mode white backgrounds in Research UI

## What was done

Fixed white form surfaces in the Phase 11 Research UI under dark mode. Root cause: the
Research components referenced an **undefined CSS var `var(--bg, #fff)`** (theme-blind →
always white). Phase 11 shipped this because it was never exercised in dark mode.

- **globals.css** (`:root` base palette): added `--bg: var(--paper)` (theme-aware surface,
  tracks `--paper` across light/dark) and `--on-gold: #FFFFFF` (fixed white). Surface
  usages of `var(--bg…)` are now theme-aware with zero per-file change.
- **9 on-gold text sites** swapped `var(--bg…)` → `var(--on-gold, #fff)` across 5 files so
  gold buttons/chips keep white labels in both themes:
  - `NewResearchJobModal.tsx` ×2 (active schedule label, Start Research label)
  - `ResearchScreen.tsx` ×4 (New Research, Approve chip, active Document/Dashboard toggle, run button)
  - `FeedbackBar.tsx` ×1, `RerunModal.tsx` ×1, `settings/IntegrationsSection.tsx` ×1 (Save key)

## Verification

- Static: `grep` confirms 9 `var(--on-gold)` sites; all remaining `var(--bg…)` are `background:` surfaces; both tokens defined in globals.css.
- Live (HMR, dev server): all 6 files hot-reloaded with no errors.
- **User visual confirm (dark mode):** Research modal inputs/textarea/Focus-domains now render dark; gold "Once" / buttons keep labels. User: "looks good."

## Decisions
- On-gold text kept **white in both themes** (user choice over letting it flip dark).

## Scope / caveat
- The commit bundles `globals.css` (which carried ~45 lines of pre-existing dark-mode WIP — same feature) + the 5 clean Research/Integrations files. Other unrelated WIP (App.tsx, BehaviourSection, SettingsScreen, SidebarStatus, SectionCalendar, TranscriptCaptureScreen, package-lock.json) intentionally left untouched.
- Did not run `pnpm typecheck` — changes are pure inline-style string-literal swaps (no type surface); HMR compiled clean.

## Self-Check: PASSED

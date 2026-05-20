---
phase: 09-implement-product-ui-from-anthropic-design-system-design-ref
plan: 01
subsystem: renderer / design-system
tags: [ui, design-system, phase-9, foundation]
requires: []
provides:
  - editorial-design-tokens
  - fontsource-bundles
  - editorial-primitives
affects:
  - src/renderer/app/theme/globals.css
  - src/renderer/components/editorial/*
tech-stack:
  added:
    - "@fontsource/playfair-display@5.2.8"
    - "@fontsource/source-sans-3@5.2.9"
    - "@fontsource/ibm-plex-mono@5.2.7"
  patterns:
    - "Editorial primitives as leaf components — no imports from features/*"
    - "CSS variables coexist (--aria-* + editorial) per D-13"
    - "Heading defaults scoped under :where(.editorial) until 09-02 wires shell"
key-files:
  created:
    - src/renderer/assets/fonts/.gitkeep
    - src/renderer/components/editorial/MonogramSquare.tsx
    - src/renderer/components/editorial/Avatar.tsx
    - src/renderer/components/editorial/StatusDot.tsx
    - src/renderer/components/editorial/RouteBadge.tsx
    - src/renderer/components/editorial/KbdHint.tsx
    - src/renderer/components/editorial/LabelRule.tsx
    - src/renderer/components/editorial/Card.tsx
    - src/renderer/components/editorial/Button.tsx
    - src/renderer/components/editorial/Input.tsx
    - src/renderer/components/editorial/Modal.tsx
    - src/renderer/components/editorial/Logo.tsx
    - src/renderer/components/editorial/index.ts
    - src/renderer/components/editorial/__tests__/primitives.test.tsx
  modified:
    - src/renderer/app/theme/globals.css
    - package.json
decisions:
  - "Heading defaults are scoped under :where(.editorial) so legacy screens (Phase 1-8) are unaffected until 09-02 swaps the shell to carry the editorial class."
  - "Component files do not import React (jsx: react-jsx); only Modal/Input/Button import React for hooks / forwardRef."
  - "StatusDot halo uses explicit rgba per kind rather than the design-ref `${color}1A` template (Tailwind/CSS-var concatenation does not produce a valid color)."
metrics:
  duration: ~25min
  completed: 2026-05-20
---

# Phase 9 Plan 01: Editorial Design-System Foundation Summary

Editorial CSS tokens, locally-bundled fonts, and 11 React primitives now exist as the single source of truth for the Phase 9 UI re-skin. Subsequent plans (09-02 shell, 09-03..05 features) import from `@/renderer/components/editorial` and consume `var(--ink)`, `var(--gold)`, `.smallcaps`, `.label-rule`, `.card` directly — no bespoke per-screen styles.

## Tasks Completed

| Task | Name                                                                  | Commit    | Files                                                          |
| ---- | --------------------------------------------------------------------- | --------- | -------------------------------------------------------------- |
| 1    | Install bundled fonts and add editorial tokens to globals.css         | `3ef4281` | `package.json`, `pnpm-lock.yaml`, `globals.css`, `fonts/.gitkeep` |
| 2    | Port editorial React primitives under `src/renderer/components/editorial/` | `9f26dbf` | 11 primitives + `index.ts` + test file                         |

## What Shipped

### Task 1 — Tokens + fonts (commit `3ef4281`)

- `pnpm add @fontsource/playfair-display @fontsource/source-sans-3 @fontsource/ibm-plex-mono` — 3 runtime deps locked to current latest (5.2.8 / 5.2.9 / 5.2.7).
- 14 weight-specific `@import` lines at the top of `globals.css` (4×Playfair + italic, 5×Source Sans 3, 3×IBM Plex Mono). All font assets resolved from `node_modules` — verified zero `fonts.googleapis.com` references remain in source.
- Editorial palette added under `:root` alongside `--aria-*` (D-13): `--ivory`, `--ivory-deep`, `--paper`, `--ink`, `--ink-soft`, `--gray`, `--gray-soft`, `--gray-faint`, `--rule`, `--rule-strong`, `--gold`, `--gold-light`, `--gold-deep`, `--rose`, `--moss`.
- Type vars (`--f-display`, `--f-body`, `--f-mono`), layout vars (`--container`, `--container-wide`, `--radius-sm/-/-lg`), motion vars (`--t`, `--t-slow`).
- Verbatim primitive classes from `design-ref/project/shared.css`: `.display`, `.smallcaps[/-gold/-ink]`, `.label-rule` (+ `.rule` / `.lbl` / `.center` / `.left` descendants), `.container[/-wide]`, `.hr[/-strong]`, `.btn[/-primary/-outline/-ghost]`, `.card[/-accent-top/-hover]`, `:focus-visible`, `.muted/.ink/.gold/.tnum/.italic/.serif/.mono/.sans`, `.dropcap::first-letter`, `.fleuron`, `::selection`, `::-webkit-scrollbar*`.
- `h1`–`h4` heading defaults wrapped in `:where(.editorial)` to avoid bleeding into legacy screens until 09-02 sets the editorial class on the body.

### Task 2 — Primitives + tests (commit `9f26dbf`)

11 primitives ported under `src/renderer/components/editorial/`:

- **MonogramSquare** — ivory squircle + Playfair "A" + gold underline rule (verbatim from `app-shell.jsx` 18-38).
- **Avatar** — ink/gold circle with mono initials (verbatim from `app-shell.jsx` 40-51).
- **StatusDot** — 6px dot with halo glow; 4 kinds (ok=moss / warn=gold / err=rose / idle=gray-faint). `data-status-kind` attribute exposed for test selectors.
- **RouteBadge** — `LOCAL` (gold-tinted) / `FRONTIER` (ivory-deep ink) pill.
- **KbdHint** — mono mini-pill for `⌘K`, `esc`.
- **LabelRule** — flanking-rule section label using the global `.label-rule` class; `align="left"` suppresses leading rule.
- **Card** — wraps children in `.card` + optional `card-accent-top` + `card-hover`.
- **Button** — `.btn .btn-{primary|outline|ghost}`; forwards all native button props; defaults `type="button"`.
- **Input** — `React.forwardRef` 44px paper input with optional `label` / `hint` / `error`; mono uppercase label; `aria-invalid` wired to error.
- **Modal** — `createPortal` to `document.body`, `role="dialog"` + `aria-modal="true"`, Esc + backdrop close, gold 2px top accent, mono eyebrow + Playfair title, optional `footer` slot. Used by 09-05 `DisconnectConfirmDialog` re-skin per D-12.
- **AppLogo** — three documented variants (Logo Studies III / V / II): `sidebar` (monogram + "Aria" + italic "chief of staff"), `header` (editorial lockup with gold underline + "Est. 2026" + "A Chief of Staff" tag), `splash` (italic Study II + hairline + tag).
- **index.ts** — barrel re-exports all 11 components + their named prop types.

### Test coverage

`primitives.test.tsx` ships 9 tests (one extra over the plan's 8 — AppLogo has separate sidebar + header assertions). All pass:

```
Test Files  1 passed (1)
     Tests  9 passed (9)
```

Static export-count verification at commit time: `index.ts` exposes the 11 named exports per the plan's must-haves contract.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — TS strict] Unused React imports**
- **Found during:** Task 2 post-write typecheck.
- **Issue:** Under `tsconfig.json` `"jsx": "react-jsx"` (automatic runtime), the leaf components (`MonogramSquare`, `Avatar`, `StatusDot`, `RouteBadge`, `LabelRule`, `Logo`) did not actually use the `React` namespace — only hooks/forwardRef consumers (`Modal`, `Input`, `Button`, `Card`) do. Strict TS emitted `TS6133 'React' is declared but its value is never read`.
- **Fix:** Dropped the unused `import React from 'react'` lines. Kept `React` import only where `React.forwardRef`, `React.useEffect`, `React.CSSProperties`, or `React.ReactNode` types are actually referenced.
- **Files modified:** `MonogramSquare.tsx`, `Avatar.tsx`, `StatusDot.tsx`, `RouteBadge.tsx`, `LabelRule.tsx`, `Logo.tsx`.
- **Commit:** folded into `9f26dbf`.

**2. [Rule 1 — Bug] jest-dom matchers not loaded in test**
- **Found during:** Task 2 typecheck.
- **Issue:** `toBeInTheDocument` / `toHaveAttribute` not on vitest's `Assertion` type because `@testing-library/jest-dom/vitest` wasn't being imported.
- **Fix:** Added `import '@testing-library/jest-dom/vitest';` at top of `primitives.test.tsx`. (The matcher package is already in devDeps.)
- **Commit:** folded into `9f26dbf`.

**3. [Rule 1 — Bug] StatusDot halo string concatenation**
- **Found during:** Component write.
- **Issue:** The design-ref source uses `boxShadow: \`0 0 0 3px ${color}1A\`` which works only when `color` is a hex literal — not when it's a CSS variable reference like `var(--moss)`. `var(--moss)1A` is not a valid CSS color.
- **Fix:** Hardcoded the 10%-alpha halo as explicit `rgba(...)` per kind (moss / gold / rose / gray-faint). Visual result is the same.
- **File:** `StatusDot.tsx`.
- **Commit:** folded into `9f26dbf`.

### Out-of-scope deferred (per envelope rule #5)

Pre-existing TS errors not touched by this plan, captured for tracking:

- `src/renderer/features/recap/RecapScreen.tsx(45,45)` — TS2367 (true/false comparison).
- `src/renderer/features/settings/SchedulingRulesSection.tsx(437,9)` — TS2322 (unknown → ReactNode).

Neither file is consumed by the editorial primitives. Will be cleaned during the per-feature re-skins in 09-03..05 or as a Phase 8 polish PR.

## Schema Deviations

None — no DB / IPC / migration changes.

## Verification Results

| Criterion                                                                                         | Status                                                                            |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Editorial CSS variables coexist with `--aria-*` in globals.css                                    | PASS — `grep -- '--ivory'`, `--gold`, `--aria-bg` all return ≥1 hit.              |
| 3 Fontsource packages declared as runtime deps                                                    | PASS — `@fontsource/playfair-display`, `source-sans-3`, `ibm-plex-mono` in `package.json` dependencies. |
| Zero Google Fonts CDN reference in source                                                         | PASS — no `fonts.googleapis.com` string remains in `globals.css`.                 |
| 11 primitives exist + are exported                                                                | PASS — `index.ts` re-exports all 11 (test 9 asserts each is a component reference). |
| TypeScript clean for new files                                                                    | PASS — `tsc --noEmit` shows zero `components/editorial` errors.                   |
| 9/9 primitives tests pass                                                                         | PASS — vitest run reports `Test Files 1 passed (1) · Tests 9 passed (9)`.         |
| No primitive imports from `features/*`                                                            | PASS — `grep -r "from '../../features" src/renderer/components/editorial/` → no results. |
| `--aria-*` declarations unchanged                                                                 | PASS — `grep '--aria-bg'` still present; dark-mode override left intact.          |

## Success Criteria

| Criterion                                                                                              | Status |
| ------------------------------------------------------------------------------------------------------ | ------ |
| Plan 09-02 can `import { AppLogo, MonogramSquare, Avatar, StatusDot, Button, Card, KbdHint }`         | READY  |
| Plans 09-03..05 can use `var(--ink)`, `var(--gold)`, `.smallcaps`, `.label-rule`, `.card`             | READY  |
| Zero feature files touched yet (re-skin work hasn't started)                                          | PASS — no edits outside `app/theme/`, `assets/fonts/`, and `components/editorial/`. |

## Followups / Deferred

1. **`:where(.editorial)` heading-scope unwrap** — Plan 09-02 will add the `editorial` class to `<body>` (or `#root`), at which point `h1`–`h4` apply globally and the `:where(.editorial)` wrapping is the legitimate global default.
2. **Pre-existing renderer TS errors** — RecapScreen.tsx + SchedulingRulesSection.tsx noted above. Out of scope for 09-01 per envelope.

## Self-Check: PASSED

- File `src/renderer/components/editorial/index.ts` — FOUND.
- File `src/renderer/app/theme/globals.css` — FOUND (updated).
- File `src/renderer/components/editorial/Modal.tsx` — FOUND.
- File `src/renderer/components/editorial/Logo.tsx` — FOUND.
- File `src/renderer/components/editorial/__tests__/primitives.test.tsx` — FOUND.
- Commit `3ef4281` (task 1) — FOUND in `git log`.
- Commit `9f26dbf` (task 2) — FOUND in `git log`.
- Test run — 9/9 passed.
- No editorial TypeScript errors.

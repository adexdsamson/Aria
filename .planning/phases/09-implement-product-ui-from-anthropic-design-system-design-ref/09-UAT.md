---
status: testing
phase: 09-implement-product-ui-from-anthropic-design-system-design-ref
source: [09-01-SUMMARY.md, 09-02-SUMMARY.md, 09-03-SUMMARY.md, 09-04-SUMMARY.md, 09-05-SUMMARY.md]
started: 2026-05-20T12:00:00Z
updated: 2026-05-20T12:00:00Z
---

## Current Test

number: 1
name: Cold Start Visual Smoke
expected: |
  Run `pnpm dev` from a clean repo. Aria launches; UnlockScreen renders in
  editorial typography (Playfair Display display title, Source Sans 3 body,
  IBM Plex Mono captions). No console errors. Sidebar mounts with editorial
  AppLogo + RouteBadges. Briefing displays at /briefing post-unlock.
awaiting: user response

## Scope

Phase 9 re-skinned the entire renderer from the legacy `--aria-accent`
Tailwind layer to the editorial design system (Playfair Display / Source
Sans 3 / IBM Plex Mono + ink/gold/rose token palette). UAT covers:

- **Editorial primitives** (11 in barrel): MonogramSquare, Avatar, StatusDot,
  RouteBadge, KbdHint, LabelRule, Card, Button, Input, Modal, AppLogo
- **Workspace screens** (10): Briefing, Approvals, Calendar, Meetings, Tasks,
  Scheduling, Ask, Recap, RoutingLog, plus the SideNav + Topbar shell
- **Settings tabs** (14+): root + FrontierKey + Integrations + Subscription +
  Diagnostics + RAG Index + LearnedPreferences + RoutingLog + others
- **Onboarding flow** (4-step): Welcome, MnemonicShow, MnemonicConfirm, Seal
  + UnlockScreen + RestoreScreen + BackupRestoreSection
- **Entitlement states** (4): trial-active-day0, trial-locked, pro-active,
  pro-locked + clock-skew + TrialBanner info/warn/urgent
- **Destructive flows** (DisconnectConfirmDialog): integration disconnect,
  learned-pref field reset, recap finalize

## Tests

### 1. Cold Start Visual Smoke
expected: Run `pnpm dev`. App launches; UnlockScreen renders in editorial fonts (Playfair display title, Source Sans body, IBM Plex Mono captions). No console errors. Post-unlock, Briefing mounts with editorial Card grid + SideNav + Topbar.
result: _pending_

### 2. Per-screen visual check vs design-ref prototypes
expected: For each route in [/briefing, /approvals, /calendar, /meetings, /tasks, /scheduling, /ask, /recap, /routing-log, /settings], open side-by-side with `design-ref/project/app-screen-*.jsx` prototype. Note any spacing > 2px / typography / color > 1 shade drift. Compare /briefing against the 3 PNG screenshots in `design-ref/project/screenshots/` (briefing.png, briefing-v2.png, briefing-v3.png).
result: _pending_

### 3. Cmd+K command palette works from all 3 triggers
expected: Open ⌘K palette from (a) the sidebar trigger, (b) the topbar trigger, (c) the keyboard shortcut. All three open the same editorial overlay. Typing a question + Enter routes to /ask answer.
result: _pending_

### 4. DisconnectConfirmDialog destructive-flow recheck
expected: Trigger each destructive flow:
  - Settings → Integrations → Disconnect a Google account (cancel before final confirm).
  - Settings → Learned preferences → Reset a single field.
  - Recap → open a draft → Finalize (cancel).
Each requires typed confirmation. Modal renders with rose top rule, Playfair italic title, mono "Type … to confirm" hint. Cancel preserves state.
result: _pending_

### 5. Onboarding seal step shows editorial copy
expected: Clear dev vault (or use fresh profile). Walk onboarding. At the seal step, screen displays "Sealing your vault…" in Playfair italic + mono caption "5–15 seconds on this machine". Post-seal lands on Briefing.
result: _pending_

### 6. /ask returns answers with editorial styling
expected: Open /ask. Submit a question against ingested mail/calendar. Answer card renders in editorial Card primitive with cited source chunks (account chip, source-kind icon, TZ-correct timestamp). Citation click opens source preview in editorial Modal.
result: _pending_

### 7. Recap export buttons fire
expected: Open /recap. Click "Export DOCX" and "Export PDF" buttons. Both produce files via the docx + react-pdf pipelines without console errors. File downloads trigger user save dialog.
result: _pending_

### 8. All 14 Settings tabs mount cleanly
expected: Walk every Settings tab: root, FrontierKey, Integrations, Subscription, Diagnostics, RAG Index, LearnedPreferences, RoutingLog, BackupRestoreSection, plus subtabs. Every tab renders editorial primitives; no console errors; no missing-component warnings.
result: _pending_

### 9. Reachability ratchet passes
expected: Run `npx vitest run tests/integration/phase-9-reachability.spec.ts`. All 4 assertions green. KNOWN_ORPHAN_PRIMITIVES list = [MonogramSquare, StatusDot, Input, Modal]. KNOWN_NAKED_FEATURES = [diagnostics, email]. Decide per-orphan: wire into a Screen (Phase 10 plan), or remove the export.
result: _pending_

### 10. Snapshot count delta is reasonable
expected: Run `pnpm test --run`. Any updated snapshot files should reflect ONLY the editorial re-skin (font-family, color tokens, spacing primitives) — not behavioral changes. Spot-check 3+ snapshot diffs for unexpected behavioral drift.
result: _pending_

### 11. TrialBanner entitlement states render correctly
expected: Force each TrialBanner state via dev fixture or DevTools entitlement override:
  - info (day 0-49) — gold rule, "X days left in trial"
  - warn (day 50-54) — amber rule, "X days left — add billing"
  - urgent (day 55-59) — rose rule, "X days left — locking soon"
  - clock-skew — rose rule, time-mismatch copy
Each renders with documented Playfair italic title + mono caption.
result: _pending_

### 12. No feature regression across core flows
expected: Confirm no regression in (a) briefing regenerate, (b) approval approve/reject, (c) calendar event display, (d) meeting transcript paste→extract, (e) task push to Todoist (if test token present), (f) Ask Aria query → cited answer.
result: _pending_

## Issues found

_To be filled during walkthrough. Each issue gets:_

- **Severity:** BLOCKER / MAJOR / MINOR / COSMETIC
- **Screen / flow:**
- **Description:**
- **Routing decision:** fix-in-09-06 / route-to-phase-10 / defer-to-backlog

## Success criteria check (D-01 .. D-17 from 09-CONTEXT.md)

_Filled at close-out. Each criterion → PASS / PASS-W-CAVEATS / FAIL with one-line rationale._

- D-01: _pending_
- D-02: _pending_
- D-03: _pending_
- D-04: _pending_
- D-05: _pending_
- D-06: _pending_
- D-07: _pending_
- D-08: _pending_
- D-09: _pending_
- D-10: _pending_
- D-11 (reachability ratchet): _pending_ — test green at Phase 9 close with documented allowlist (4 orphan primitives + 2 naked features); routing decisions pending in this UAT.
- D-12: _pending_
- D-13: _pending_
- D-14: _pending_
- D-15: _pending_
- D-16: _pending_
- D-17: _pending_

## Design-ref screenshot comparisons

User-driven pixel-diff. Reference assets at
`.planning/phases/09-.../design-ref/project/screenshots/`:

| Screenshot          | Target screen   | Route       | Result    |
| ------------------- | --------------- | ----------- | --------- |
| `briefing.png`      | BriefingScreen  | `/briefing` | _pending_ |
| `briefing-v2.png`   | BriefingScreen  | `/briefing` | _pending_ |
| `briefing-v3.png`   | BriefingScreen  | `/briefing` | _pending_ |

Other screens compare against JSX prototypes in
`design-ref/project/app-screen-*.jsx` (no PNG capture for those).

## Close-out summary

_To be filled at the end of the walkthrough._

verdict: _pending_ (PASS / GAPS / BLOCKED)
rationale: _one line_

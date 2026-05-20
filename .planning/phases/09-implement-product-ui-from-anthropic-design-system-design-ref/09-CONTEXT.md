---
phase: 09-implement-product-ui-from-anthropic-design-system-design-ref
type: context
source: design-ref bundle from claude.ai/design (3 chat transcripts, 14 prototype files)
discuss_phase_skipped: true
rationale: |
  Phase 9 was added late as a UI re-skin tracked by an external design ref
  (VGTQmBNc8uXN62kH9DBTXA). The design bundle in `design-ref/` IS the spec — it
  was iterated 3 times against the shipped codebase (Phases 1–8) and the final
  app-shell.jsx mirrors `src/renderer/app/routes.tsx` 1:1. This file captures
  locked decisions extracted from the chat transcripts so future readers do
  not have to re-derive them.
---

# Phase 9 — Locked Decisions

## Source

Three Claude Design chat transcripts in `design-ref/chats/`:
- **chat1.md** (2026-05-17 07:47 UTC) — first cut. Mocked all 9 screens + landing page + logo.
- **chat2.md** (2026-05-17 16:53 UTC) — updated prototype to honestly reflect Phases 1+2 shipped state.
- **chat3.md** (2026-05-19 19:51 UTC) — re-synced after Phases 3–8 shipped. **This is current.** Adds Tasks, Scheduling, Routing-log, Recap, Entitlement (paywall + trial banner), feedback chips, Insights/Learned-prefs/Updates settings tabs.

## D-01 — Design voice: editorial / magazine masthead

Playfair Display + Source Sans 3 + IBM Plex Mono. Ivory canvas (`#FAFAF8`), ink text (`#1A1A1A`), single burnished-gold accent (`#B8860B`). Reference: New Yorker / Monocle / quarterly journal mastheads. No AI engravings, no busy graphics — typography + thin rules + tasteful sparklines do all the work.

Source: `design-ref/project/shared.css`, mark study in `design-ref/project/logo.html`.

## D-02 — Brand name stays "Aria"

The design bundle is named `aria/`. Product name is unchanged. The logo wordmark is "Aria" set in Playfair Display medium (500), with a short gold rule underline for the in-product editorial lockup variant (study V).

## D-03 — Logo: classic masthead is primary; monogram "A" is the app icon

Five wordmark studies were explored (chat1.md). The decisions:
- **Primary mark** = Study I "Classic Masthead" — centered Playfair "Aria", flanked rules, "Established MMXXVI" tag, gold swash fleuron, "A Chief of Staff" bottom rule. Used for marketing/cover.
- **In-product header** = Study V "Editorial Lockup" — Aria + italic "Est. 2026" + short gold underline + "A Chief of Staff" mono tag. Used in app shell brand row.
- **App icon / favicon / sidebar squircle** = Study III "Monogram" — single serif "A" with a gold horizontal rule across the lower third, ivory squircle background (22% radius small, 28% radius full size). Already implemented in `app-shell.jsx` as `MonogramSquare`.
- Studies II (italic signature), IV (breath mark) — explored, not adopted as primary surfaces. They exist for splash / loading states only.

Replace any existing brand mark across the renderer with the monogram squircle (sidebar) + Playfair wordmark (topbar/marketing) combination.

## D-04 — Accent color: gold (`#B8860B`)

Default accent. The design bundle also defined 4 alternate accents (oxblood, ink, moss, navy) wired through `--gold` CSS variable in the prototype's tweaks panel. **For Phase 9 product ship: gold only.** Alternate accents are a deferred idea — they require theming infrastructure beyond the re-skin scope.

## D-05 — Re-skin only. No new features. No data-layer changes.

If a design screen shows a feature that does not exist in code, we DO NOT silently build it. Surface the gap to the user as a question. Confirmed scope after diffing `app-shell.jsx` against `routes.tsx`:

| Design screen | Existing renderer file | Action |
|---|---|---|
| Briefing | `features/briefing/BriefingScreen.tsx` + Section* + BriefingFeedbackChips | Re-skin |
| Approvals | `features/approvals/ApprovalsScreen.tsx` + ApprovalCard + ApprovalQueue + InlineApprovalsPreview | Re-skin |
| Calendar | `features/calendar/UnifiedCalendarScreen.tsx` + CalendarGrid + AccountVisibilityToggle + RecurrenceUnsupportedPill | Re-skin |
| Meetings | `features/meetings/TranscriptCaptureScreen.tsx` + NoteReviewScreen + NoteView + CitationHighlighter | Re-skin |
| Tasks | `features/tasks/TasksScreen.tsx` + TaskRow | Re-skin |
| Scheduling | `features/scheduling/SchedulingChat.tsx` | Re-skin |
| Ask Aria | `features/ask/AskScreen.tsx` + AnswerCard + CitationList + SourcePreview | Re-skin |
| Weekly Recap | `features/recap/RecapScreen.tsx` + RecapEditor | Re-skin |
| Settings (14 tabs / ~17 section components) | `features/settings/SettingsScreen.tsx` + sections under `features/settings/` (note: the "Restore license" tab pulls `RestoreLicenseSection` from `features/entitlement/`, not from `features/settings/`) | Re-skin |
| Onboarding (4 steps) | `features/onboarding/OnboardingWizard.tsx` + MnemonicShow/Confirm + CountrySectorPicker | Re-skin |
| Routing log | `features/diagnostics/RoutingLogScreen.tsx` | Re-skin |
| Paywall + TrialBanner | `features/entitlement/PaywallScreen.tsx` + TrialBanner.tsx | Re-skin |
| Cmd-K palette | `components/CommandPalette.tsx` | Re-skin |
| Side nav | `components/SideNav.tsx` | Re-skin |
| Topbar | (does not exist yet — see D-06) | Add |

Zero new business logic. Zero IPC changes. Zero migrations. Zero new dependencies (unless the visual fidelity requires a Google Fonts loader — see D-09).

## D-06 — Add a Topbar component

The design has a Topbar (per-screen eyebrow + display title + ⌘K search button + bell + avatar). The codebase currently has only `SideNav.tsx` and routes; the per-screen title is implicit. Add `src/renderer/components/Topbar.tsx` and wire it inside `Layout.tsx`. The Topbar reads the active route and renders an eyebrow + Playfair display title (per `app-shell.jsx` titles map). This is **layout chrome, not a new feature** — it does not change behavior. The bell icon is decorative for v1 (no notification system exists yet; bell stays as a styled non-interactive affordance — or hidden behind a `<!-- TODO Phase 10 notifications -->` comment block).

## D-07 — Onboarding owns the full window (no sidebar, no topbar)

Confirmed in chat1.md user comment. The OnboardingWizard renders without the Sidebar + Topbar chrome. `Layout.tsx` must conditionally suppress chrome when the active path matches the onboarding route. Match the existing `App.tsx` gate logic, do not re-implement.

## D-08 — Window chrome (macOS rounded / Windows square)

The prototype demonstrates a `MacChrome` / `WinChrome` toggle. The shipped Electron app already uses native OS chrome (no custom titlebar in v1). **Do NOT introduce custom chrome.** The prototype's chrome wrapper was a presentation device for the design bundle. Native OS chrome stays.

## D-09 — Google Fonts loading: bundled, not CDN

The shared.css uses `@import url(fonts.googleapis.com)`. For a local-first desktop app this is wrong — it leaks a request on every launch. **Bundle Playfair Display, Source Sans 3, IBM Plex Mono, and Cormorant Garamond as woff2 files** under `src/renderer/assets/fonts/` and serve via `@font-face` in `globals.css`. Use Fontsource (npm: `@fontsource/playfair-display`, `@fontsource/source-sans-3`, `@fontsource/ibm-plex-mono`) — adding three font packages is the only allowed new dependency for this phase. Cormorant Garamond is referenced as a fallback in shared.css and is not actually used in any screen; skip it.

## D-10 — Snapshot tests: update, do not disable

Existing snapshot/jsdom tests will fail because the rendered DOM changes substantially. The plan must:
1. Run all renderer test suites after each plan.
2. For snapshot tests: update with `-u` / `--update` only after a human spot-checks the new snapshot is the intended design.
3. Behavioural tests (interactions, IPC mocks, entitlement gates, DisconnectConfirmDialog 3-assertion pattern) MUST continue to pass without modification. If a behavioural test breaks, the re-skin broke logic — fix the re-skin, not the test.

## D-11 — Reachability gate (carries forward from Phase 4 verifier blindspot)

`feedback_verifier_blindspot_ui_wiring.md`: every new component MUST be imported by a Screen / route. Each plan ends with a grep ratchet:

```
grep -rn "import.*{NewComponent}" src/renderer/features src/renderer/app src/renderer/components | wc -l   # must be ≥1
```

A component file that exists but is unreferenced from any route or Screen is treated as a missing artifact, not a passing one.

## D-12 — DisconnectConfirmDialog primitive: restyle, preserve consent shape

Phase 7 / Phase 8 ship `DisconnectConfirmDialog` with a 3-assertion test contract (modal mounts, typed confirmation required, callback only fires after confirm). The re-skin REPLACES the visual treatment with the editorial card+rules pattern. The 3 assertion tests stay green unchanged. This applies wherever destructive actions live: Disconnect account, Reset learned preferences, Delete recap draft, Sign out.

## D-13 — Tokens: ADDITIVE, do not delete `--aria-*`

The existing tokens (`--aria-bg`, `--aria-fg`, `--aria-accent`, etc.) drive Tailwind theme extension and are referenced from non-feature places (test utilities, `app/theme/tokens.ts`, `tailwind.config.ts`). The new editorial tokens (`--ivory`, `--ink`, `--gold`, etc.) ship alongside in the same `globals.css`. After the re-skin lands, the `--aria-*` variables will become orphaned and can be cleaned up in a follow-up phase. **Do not delete them during Phase 9** — that's a separate, riskier change.

## D-14 — Tailwind stays, but is downgraded to utility-only

The design system as expressed in `shared.css` is pure CSS variables + class selectors (`.btn`, `.card`, `.smallcaps`, `.label-rule`). Re-skinned components use those CSS classes directly via `className` attributes, with `style` for one-offs. Tailwind utilities remain available for layout (`flex`, `gap-4`, etc.) but **stop using Tailwind tokens** (`bg-gray-200`, `text-accent`) — those reference the legacy `--aria-*` palette. New visual styling uses the editorial CSS classes.

## D-15 — Plan order & wave structure

Sequential. Every plan touches `globals.css` or `Layout.tsx` or both, so parallelism is unsafe.

1. **09-01** — Design system foundation (tokens, fonts, primitive classes, logo asset, Button/Card/Input/Modal class library, Topbar component).
2. **09-02** — App shell re-skin (SideNav, Topbar wiring, Layout chrome, brand row, ⌘K palette restyle, sidebar status footer).
3. **09-03** — Workspace screens batch 1 (Briefing, Approvals, Calendar, Scheduling).
4. **09-04** — Workspace screens batch 2 (Meetings, Tasks, Ask Aria, Recap).
5. **09-05** — System surfaces (Settings 10 tabs, Routing log, Entitlement: TrialBanner + PaywallScreen, Onboarding 4 steps).
6. **09-06** — Visual QA + reachability ratchet + snapshot updates + sweep for orphaned `--aria-*` references in feature files (replace with editorial tokens where they're now visible).

## D-16 — Out of scope (deferred ideas)

The following appeared in the design bundle but are **NOT** in Phase 9:
- **Landing page** (`landing.html`) — out of scope, confirmed by user in phase title.
- **Index hub** (`index.html`) — that's a design-bundle contents page, not a product surface.
- **Tweaks panel** — design-bundle preview affordance only, not shipped.
- **Alternate accents (oxblood / navy / moss / ink)** — D-04. Defer to a "user theming" follow-up.
- **macOS / Windows chrome wrapper** — D-08. Use native OS chrome.
- **Notification bell behaviour** — D-06. Decorative only.
- **Paper-texture overlay** (`body::before` in shared.css) — the shared.css already opts out via `body::before { display: none; }` in `app.html`. We ship without it; revisit only if visual review says it's missing.
- **Splash screen** (study II italic). No splash screen exists in v1 — Electron loads straight into the unlock screen. Defer.

## D-17 — Pixel-perfect target

"Pixel perfect" per README.md = match the visual output of the prototype's screens. **Do not copy the prototype's JSX structure** (it's prototype-grade single-file React with inline styles). Re-implement using the actual feature components, but produce the same visual output. Tolerance: ±2px on spacing, exact match on color/typography/border-radius/shadow values.

## Open Question handed to executor (Q-01)

The design bundle's `app-screen-meetings.jsx` shows a transcript citation highlighter with hover popovers showing transcript span text on hover over each cited action item. The shipped `CitationHighlighter.tsx` does inline span highlighting only. **Question for the user during execution:** is the hover popover preview already implemented elsewhere, or is that a P9 stretch? Default answer if user is unreachable: re-skin to match inline highlighting only (current behavior); the hover preview is a deferred idea.

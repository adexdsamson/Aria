---
phase: 09-implement-product-ui-from-anthropic-design-system-design-ref
type: design-tokens-contract
source: design-ref/project/shared.css (verbatim extraction)
---

# Phase 9 — Design Tokens Contract

This is the verbatim contract that every Phase 9 plan implements. Tokens MUST be added to `src/renderer/app/theme/globals.css` exactly as listed, alongside (not replacing) the existing `--aria-*` variables (per D-13).

## Color palette

| Variable | Hex | Role |
|---|---|---|
| `--ivory` | `#FAFAF8` | App canvas |
| `--ivory-deep` | `#F5F3F0` | Muted canvas (nav hover, sidebar bg sometimes) |
| `--paper` | `#FFFFFF` | Card surface |
| `--ink` | `#1A1A1A` | Primary text |
| `--ink-soft` | `#2A2826` | Secondary text |
| `--gray` | `#6B6B6B` | Muted text |
| `--gray-soft` | `#8A8784` | Tertiary / placeholder text |
| `--gray-faint` | `#C7C2BB` | Disabled / decorative |
| `--rule` | `#E8E4DF` | Divider lines |
| `--rule-strong` | `#D6D1C8` | Emphasised divider |
| `--gold` | `#B8860B` | Accent (default) |
| `--gold-light` | `#D4A84B` | Accent hover |
| `--gold-deep` | `#8E6708` | Accent active / deep text on gold-tinted bg |
| `--rose` | `#B8493A` | Urgent / destructive (use sparingly) |
| `--moss` | `#5B6E3A` | Approved / sent / success (use sparingly) |

## Type stack

| Variable | Value | Role |
|---|---|---|
| `--f-display` | `"Playfair Display", "Cormorant Garamond", Georgia, serif` | Display headings, brand wordmark, screen titles |
| `--f-body` | `"Source Sans 3", system-ui, sans-serif` | Body text, buttons, nav |
| `--f-mono` | `"IBM Plex Mono", ui-monospace, monospace` | Smallcaps, eyebrows, metadata, badges |

Font weights used: Playfair 400/500/600/700/800/900 + 400i/700i; Source Sans 3 300/400/500/600/700 + 400i; IBM Plex Mono 300/400/500/600.

Bundle via Fontsource (D-09). Do NOT use Google Fonts CDN.

## Type scale

| Selector | Size | Line-height | Letter-spacing |
|---|---|---|---|
| `h1` | `clamp(3rem, 8vw, 6rem)` | 1.02 | -0.025em |
| `h2` | `clamp(2rem, 4vw, 3rem)` | 1.1 | -0.01em |
| `h3` | `1.5rem` | 1.2 | -0.01em |
| `h4` | `1.125rem` | 1.3 | -0.01em |
| body | `16px` | 1.6 | 0.005em |
| `.smallcaps` | `0.7rem` | — | 0.18em (uppercase) |
| `.label-rule .lbl` | `0.7rem` | — | 0.2em (uppercase) |

## Layout tokens

| Variable | Value | Role |
|---|---|---|
| `--container` | `64rem` | Standard content max-width |
| `--container-wide` | `80rem` | Wide content max-width (briefing, recap) |
| `--radius-sm` | `4px` | Pills, chips, badges |
| `--radius` | `6px` | Buttons, inputs, nav items |
| `--radius-lg` | `8px` | Cards, modals |

Sidebar width: `256px` (per app-shell.jsx line 134).
Topbar height: derived (padding `12px 24px` + content).
Mac chrome titlebar height: `32px` (native, not custom — D-08).

## Motion

| Variable | Value | Role |
|---|---|---|
| `--t` | `200ms cubic-bezier(.2,.6,.2,1)` | Standard transition |
| `--t-slow` | `320ms cubic-bezier(.2,.6,.2,1)` | Modal / overlay |

Keyframes used in app.html:
- `fadeIn` — opacity 0 → 1, translateY 4px → 0
- `pulse` — opacity 0.3 ↔ 1, 50% midpoint

## Primitive classes (port verbatim from shared.css)

| Class | Purpose |
|---|---|
| `.smallcaps` | Mono uppercase tracked label (gray default) |
| `.smallcaps-gold` | Gold variant |
| `.smallcaps-ink` | Ink variant |
| `.label-rule` | Flanking-rule section label (used in screen headers) |
| `.label-rule.left` | Suppresses leading rule (for left-aligned headers) |
| `.label-rule.center` | Centers the label |
| `.container` / `.container-wide` | Max-width wrapper |
| `.hr` / `.hr-strong` | Horizontal rule |
| `.btn` | Base button (44px min-height, mono-ish letterspacing) |
| `.btn-primary` | Gold fill, white text, lift-on-hover |
| `.btn-outline` | Ink border, ivory-deep hover, gold-on-hover text |
| `.btn-ghost` | No border/bg, gray → ink on hover |
| `.card` | Paper surface, rule border, 1.75rem padding, 8px radius |
| `.card-accent-top` | Adds 2px gold top border |
| `.card-hover` | Adds hover shadow + strong rule border |
| `.dropcap::first-letter` | Editorial drop cap |
| `.fleuron` | Gold italic ornament |
| `:focus-visible` | 2px gold outline, 2px offset |
| `.muted` / `.ink` / `.gold` | Color utilities |
| `.serif` / `.sans` / `.mono` | Font utilities |
| `.tnum` | Tabular numerals (for tables, timestamps) |
| `.italic` | font-style: italic |

## Selection + scrollbar styling

- `::selection` background `rgba(184,134,11,0.2)` (gold @ 20%)
- `::-webkit-scrollbar` width `10px`, thumb `--rule-strong`, hover `--gray-soft`
- Inside the app shell (`.app-root *`): slimmer 8px scrollbar (per `app.html` lines 28-30)

## Reused composite patterns from app-shell.jsx

These are not in shared.css but are demonstrated repeatedly across screens. They become reusable React components in Plan 09-01:

| Component | Pattern | Reference |
|---|---|---|
| `<MonogramSquare size={N} />` | Ivory squircle (22% radius small / 28% radius large) + Playfair "A" + gold rule | app-shell.jsx:18-38 |
| `<Avatar initials="EV" size={N} gold={false} />` | Ink (or gold) circle, ivory mono initials | app-shell.jsx:40-51 |
| `<StatusDot kind="ok\|warn\|err\|idle" />` | 6px dot with halo glow | app-shell.jsx:53-64 |
| `<NavItem active icon label badge badgeColor />` | Sidebar row with active-state left-rail gold bar | app-shell.jsx:66-103 |
| `<NavSection label sub>` | Sidebar section header (mono uppercase + optional italic sub) | app-shell.jsx:105-127 |
| `<RouteBadge route="LOCAL\|FRONTIER" />` | Mono uppercase tag for routing decisions (extract from briefing screens) | Various |
| `<KbdHint>⌘K</KbdHint>` | Mono mini-pill in ivory-deep with rule border | app-shell.jsx:163-167 |

## Visual rules — DO / DON'T

**DO**
- Use Playfair only for headings, hero text, brand wordmark, and intentionally editorial copy (sample queries, drop-caps).
- Use IBM Plex Mono for: smallcaps labels, eyebrows, badges, timestamps, key combos, status rows.
- Use Source Sans 3 for: body copy, buttons, nav labels, form inputs.
- Use thin gold rules (1-2px, often with 50-70% opacity) as the primary divider language.
- Card density is generous — `1.75rem` padding by default.

**DON'T**
- Don't use color for status beyond the 4 status kinds (ok=moss, warn=gold, err=rose, idle=gray-faint).
- Don't add drop shadows except the documented `card-hover` shadow + the window chrome shadow.
- Don't introduce new font families.
- Don't lean on emoji as iconography — the app-icons set in `app-icons.jsx` is the icon system (stroke-based, 17-18px sidebar / 14-15px topbar).

## Migration note: existing `--aria-*` tokens

Per D-13, the existing tokens stay. Plans 09-03 through 09-05 will encounter feature files using `var(--aria-fg)` / `var(--aria-border)` etc. — replace usage at the call site with `var(--ink)` / `var(--rule)` etc. as part of the re-skin. Do NOT delete the variable declarations from `globals.css` during Phase 9.

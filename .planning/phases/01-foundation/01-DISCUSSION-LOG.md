# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 1-Foundation
**Areas discussed:** Recovery passphrase UX, LLM routing hard-rules v1, App shell + hello-briefing stub

Areas presented but not selected for discussion: Ollama-missing UX (deferred — sensible default will be picked in planning).

---

## Recovery Passphrase UX

### Q1 — How should the recovery passphrase be generated?

| Option | Description | Selected |
|--------|-------------|----------|
| System-generated mnemonic (12-word BIP39) | Aria generates 12 random words; user re-enters 3 to confirm. High entropy. | |
| User-chosen passphrase (zxcvbn) | User types own passphrase, min strength enforced. Familiar; risk of weak/forgotten. | |
| Hybrid: mnemonic + optional user-set password | Mnemonic is canonical recovery key; user sets shorter daily-unlock password. | ✓ |

**User's choice:** Hybrid

### Q2 — When does Aria prompt for the daily-unlock password?

| Option | Description | Selected |
|--------|-------------|----------|
| Every app launch | Cold-start prompt. 1Password-like. | |
| Every launch + after OS lock/sleep | Re-prompt after wake. Stronger for always-on assistant. | |
| Launch only; stays unlocked until quit | Single unlock per session; OS lock screen is the boundary. | ✓ |

**User's choice:** Launch only

### Q3 — How should the mnemonic be confirmed during onboarding?

| Option | Description | Selected |
|--------|-------------|----------|
| Re-enter 3 random words from the mnemonic | Words at positions e.g. 4, 7, 11. Standard wallet UX. | ✓ |
| Re-enter the full 12-word mnemonic | Highest assurance; most friction. | |
| Show once + checkbox 'I have saved this' | Fastest; weakest guarantee. | |

**User's choice:** 3 random words

### Q4 — What does 'restore' mean in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Encrypted backup file on a new machine | Mnemonic decrypts; OAuth tokens NOT restored (re-auth). | ✓ |
| Backup + secrets | Tokens/API keys included in backup. Convenient; posture change. | |
| Same-machine restore only in Phase 1 | safeStorage keys machine-bound; cross-machine deferred. | |

**User's choice:** Backup file on a new machine (no secrets)

---

## LLM Routing Hard-Rules v1

### Q1 — What triggers LOCAL routing in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Pattern list (emails, phones, $$, contacts) | Regex/keyword rules only. | |
| Source-based (any user-data content → LOCAL) | Tag-driven; ignore PII detection. | |
| Fail-closed (everything LOCAL unless opt-in) | Most conservative. | |
| Combination: source-based default + pattern overrides | Tag-driven default; patterns can force LOCAL on generic prompts. | ✓ |

**User's choice:** Combination

### Q2 — Routing log visibility in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Full UI panel from day 1 | Dedicated Routing Log with table/filters. | |
| DB-only; UI in Phase 3 | Inspectable via debug command. | |
| Minimal UI: last-N entries in Settings > Diagnostics | Read-only list. Compromise. | ✓ |

**User's choice:** Minimal UI in Settings > Diagnostics

### Q3 — Behavior when user has NO frontier API key?

| Option | Description | Selected |
|--------|-------------|----------|
| LOCAL-only mode with banner | Forces LOCAL; non-blocking banner. | |
| Block frontier features inline | Per-feature 'Add API key' prompt. | |
| Ask once on onboarding; fall back to LOCAL-only mode if skipped | Sets expectations at onboarding. | ✓ |

**User's choice:** Ask once on onboarding, then LOCAL-only

### Q4 — Which frontier providers in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Anthropic only | Single provider; minimal UI. | |
| All three (Anthropic + OpenAI + Google), one active | Proves abstraction; more deps. | ✓ |
| Anthropic + OpenAI; Google deferred | Two providers. | |

**User's choice:** All three, one active at a time

---

## App Shell + Hello-Briefing Stub

### Q1 — Primary app shell shape?

| Option | Description | Selected |
|--------|-------------|----------|
| Single main window with left side nav | Briefing / Approvals / Routing Log / Settings. | ✓ |
| Tray app + popover only | Menu-bar; always-on-glance. | |
| Both: main window + tray | Long-term shape; more Phase 1 work. | |

**User's choice:** Single main window with side nav

### Q2 — Hello-briefing stub content in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Live routing-decision demo on Briefing surface | Input + 'Ask Aria' round-trip on main screen. | |
| Static briefing card + separate debug panel | Mock 'Good morning' rows. | |
| Plain 'Aria is alive' + Diagnostics has the round-trip test | Bare briefing; loop lives in Settings > Diagnostics. | ✓ |

**User's choice:** Plain 'Aria is alive' + round-trip in Diagnostics

### Q3 — Visual / design direction?

| Option | Description | Selected |
|--------|-------------|----------|
| shadcn/ui defaults, no custom styling | Fastest. | |
| shadcn/ui + thin custom theme (tokens) | Small token set: palette, type, radii, spacing. | ✓ |
| Defer all visual decisions | Ugly-but-functional. | |

**User's choice:** Thin custom theme on top of shadcn

### Q4 — Platform priority?

| Option | Description | Selected |
|--------|-------------|----------|
| macOS + Windows dev builds; Linux best-effort | Matches FOUND-01 phrasing. | |
| Windows-first; macOS in Phase 8 | Dogfood on the dev's machine. | ✓ |
| All three from day 1 in CI | Catches native-dep issues early; overkill for solo dev. | |

**User's choice:** Windows-first

---

## Claude's Discretion

- Migration framework shape (umzug-style vs hand-rolled SQL files) for better-sqlite3.
- Specific shadcn components scaffolded up-front vs added lazily.
- p-queue concurrency defaults for the router.
- node-cron schedule scaffolding (cadence open).
- PII redaction allowlist/regex at pino sink.
- Routing log "last N" entry count (50 vs 100).

## Deferred Ideas

- Tray app + global hotkey — revisit after Phase 2.
- Unlock-after-OS-lock as an opt-in setting — revisit with user feedback.
- Full routing-log UI (filter/search/export) — folded into Phase 3.
- Mock briefing data — Phase 2 supplies the real thing.
- macOS / Linux dev builds in CI — Phase 8 handles macOS; Linux not in v1.
- OAuth tokens / API keys in encrypted backup — only if real restore friction demands it.
- Ollama-missing UX details (install button vs modal vs badge, auto-pull default model) — sensible default chosen during planning; not a user-vision decision.

# Phase 20: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-09
**Phase:** 20-foundation
**Areas discussed:** Group-picker placement & UX, Ban-risk consent gate framing, Connection status & degraded UX, Technical gap confirmations

> **Note:** Advisor-mode research-agent fan-out was intentionally skipped. The milestone research (`.planning/research/SUMMARY.md` + PITFALLS/ARCHITECTURE/STACK) already provides comparison-grade analysis, and the roadmap flagged "Phase 20: No additional research needed." Comparison tables below were synthesized from that locked research + live codebase inspection (AccountRow, IntegrationsSection, editorial Checkbox, ToastHost).

---

## Group-picker placement & UX

| Option | Description | Selected |
|--------|-------------|----------|
| Modal from AccountRow link | "Manage groups" link on the WhatsApp AccountRow opens a modal with search filter; all-untracked default; new groups untracked at top with count badge | ✓ |
| Inline expandable panel | Click AccountRow to expand group list with toggles inline; row gets complex, long with many groups, no clean search | |
| Dedicated SideNav screen | Full route for WhatsApp group management; nav clutter, breaks consistency with other integrations | |

**User's choice:** Modal from AccountRow link
**Notes:** Reuses existing AccountRow action-button pattern + DisconnectConfirmDialog modal pattern. New-group handling folded in: count badge + untracked-at-top, no toast.

---

## Ban-risk consent gate framing

| Option | Description | Selected |
|--------|-------------|----------|
| Single editorial-Checkbox ack | Short modal: 3-4 bullet risks + emphasized secondary-number callout + one editorial Checkbox enabling "Show QR code"; mirrors MnemonicShow | ✓ |
| One checkbox per risk | Each risk its own checkbox, all must be ticked; friction-heavy | |
| Typed "I understand" confirmation | User types a phrase; highest deliberateness, user-hostile, overkill | |

**User's choice:** Single editorial-Checkbox ack
**Notes:** QR generation (not just visibility) gated on acknowledgement — hard gate per SC-1.

---

## Connection status & degraded UX

| Option | Description | Selected |
|--------|-------------|----------|
| AccountRow badge + Reconnect, briefing note | Status chip is source of truth (linked/reconnecting/needs-relink/disconnected) + inline Reconnect; quiet degraded note in briefing (Phase 21 hook); no toasts | ✓ |
| Badge + toast on every drop | Also fire ToastHost toast on drop/needs-relink; can feel alarming/noisy | |
| Badge only | AccountRow chip only; briefing could silently lack WhatsApp with no explanation | |

**User's choice:** AccountRow badge + Reconnect, briefing note
**Notes:** Map session states onto existing chip styles (needs-auth amber, degraded red). Briefing degraded-note rendering deferred to Phase 21; Phase 20 exposes status via provider_account.

---

## Technical gap confirmations

| Option | Description | Selected |
|--------|-------------|----------|
| Accept all 4 | account_id=phone JID, QR-only, syncFullHistory:false explicit, sweep in sweep-cron | ✓ |
| Accept but adjust one | Mostly accept, change one before writing CONTEXT.md | |

**User's choice:** Accept all 4
**Notes:** All four flow into CONTEXT.md as decided (D-11..D-14).

---

## Claude's Discretion

- Consent-modal risk-copy wording and "no history before link" sentence (within research-locked structure)
- Internal state-machine naming, p-queue batch-flush interval (~2s), table column details beyond migration 138 spec
- Group-picker modal visual layout within the editorial design system

## Deferred Ideas

- Briefing WhatsApp degraded-note rendering → Phase 21
- Pairing-code linking → future enhancement (not v2.1)
- Configurable / per-group retention window → future (fixed 30-day for v2.1)
- Daily digest + per-group summaries → Phase 21
- Action-item / meeting-proposal / RAG extraction consumers → Phase 22 (deferred)

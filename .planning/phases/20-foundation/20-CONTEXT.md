# Phase 20: Foundation - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Link a WhatsApp **personal** account to Aria via QR scan, let the user pick which groups to track, and silently ingest **tracked-group text messages** into the local SQLCipher database — with every load-bearing safety guard in place before the first message is stored.

**Delivers:** `makeWASocket` connected via QR; ban-risk consent gate; group discovery + per-group track/untrack toggle; tracked-group text ingestion to `whatsapp_message`; `provider_account` row (`provider_key='whatsapp'`) with disconnect cascade; AccountRow connection-status display + Reconnect; 30-day retention sweep; migration 138; all 12 security/safety pitfalls addressed as hard gates.

**Out of scope (permanent / later milestone):** outbound message send, 1:1 DM ingestion, media blob storage, historical backfill, auto-track-by-default. The daily digest + briefing section is **Phase 21**; extraction consumers (action items / meeting proposals / RAG) are **Phase 22**.

</domain>

<decisions>
## Implementation Decisions

### Group-picker placement & UX
- **D-01:** Tracked-group management lives in a **modal** opened from a **"Manage groups" link on the WhatsApp AccountRow** (reuses the existing AccountRow action-button pattern — Sync/Disconnect already render there — and the `DisconnectConfirmDialog` modal pattern). Reachable any time, not only at link (WA-05).
- **D-02:** The group-picker modal includes a **search/filter field** for large group lists.
- **D-03:** All groups are **untracked by default** (privacy boundary per WA-06). The track toggle is the only thing that authorizes ingestion.
- **D-04:** A **newly-joined group** (from `groups.upsert`) surfaces as a **count badge on the "Manage groups" link** and appears **untracked at the top** of the picker. No toast — avoids notification noise for a passive background capability.

### Ban-risk consent gate
- **D-05:** The pre-QR disclosure is a **single editorial-`Checkbox` acknowledgement** modal (mirrors the `MnemonicShow` / `CountrySectorPicker` editorial Checkbox ack pattern at `src/renderer/components/editorial/Checkbox.tsx`). 3–4 bullet risks; one checkbox "I understand the risks" enables the "Show QR code" action.
- **D-06:** The **"use a secondary number" recommendation** is rendered as an **emphasized callout** within the consent modal (not buried in a bullet).
- **D-07:** **The QR does not render until the checkbox is acknowledged** (hard gate, SC-1). The consent state gates QR generation, not just visibility.

### Connection status & degraded UX
- **D-08:** The **AccountRow status chip is the source of truth** for connection state. Map session states to the existing chip styling: `needs-relink` → `needs-auth` chip style (amber `#c98a3a`) with the inline **Reconnect** button AccountRow already renders for `needs-auth`; `reconnecting` / dropped → `degraded` chip style (red `#b34`).
- **D-09:** **No toasts** on connection drop/needs-relink — keeps with the passive / degradable posture for an unofficial-protocol capability expected to occasionally disconnect.
- **D-10:** A **quiet degraded note in the briefing WhatsApp section** is the secondary surfacing — but that rendering belongs to **Phase 21** (briefing assembler). Recorded here as a **Phase 21 hook**, not a Phase 20 deliverable. Phase 20 must expose the status via the `provider_account` row so Phase 21 can read it.

### Technical gap confirmations (research defaults accepted)
- **D-11:** `account_id` = the **phone JID** from `creds.me.id` after link, so AccountRow displays the number with no separate lookup.
- **D-12:** Ship **QR only** in v2.1. Pairing-code linking is a future enhancement, explicitly not in this phase.
- **D-13:** Set **`syncFullHistory:false` explicitly** in `makeWASocket` config (document intent; prevent an accidental first-link write storm) — not left as default-undefined.
- **D-14:** Place the **30-day rolling retention sweep in a dedicated WhatsApp retention cron**, timed to avoid overlap with the nightly socket recycle and the 05:00 digest cron.
  - **Addendum (2026-06-09, post-research reconciliation):** Phase research found the existing `sweep-cron.ts` is knowledge-folder-specific **and already runs at 03:00**, which collides with the planned 03:00 socket recycle. Reconciled per D-14's intent (a 30-day retention sweep), not its literal wording: implement a **sibling `src/main/whatsapp/retention.ts` cron at 03:30** rather than extending the knowledge-folder sweep-cron. Honors the "avoid overlap" constraint.

### Claude's Discretion
- Exact bullet wording of the consent-modal risk copy and the "no history before link" one-sentence notice (within the research-locked structure).
- Internal state-machine naming, table column details beyond what migration 138 spec defines, and the precise `p-queue` batch-flush interval (~2s per research).
- Group-picker modal visual layout (rows/toggles styling) within the editorial design system.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (locked — follow build order exactly)
- `.planning/research/SUMMARY.md` — full stack/feature/architecture/pitfalls synthesis; Phase 20 build order and the 12 hard-gate pitfalls
- `.planning/research/ARCHITECTURE.md` — component breakdown, migration 138 design, IPC wiring, build order
- `.planning/research/PITFALLS.md` — the 12 security/safety pitfalls (passive posture, auth atomicity, reconnect classification, frontier-LLM ban, supply-chain pin, memory leak, batch writes)
- `.planning/research/STACK.md` — Baileys `@whiskeysockets/baileys@6.7.23` exact-pin rationale, ESM externalize, `qrcode@1.5.4`
- `.planning/research/FEATURES.md` — MVP feature boundary and deferred/rejected list

### Roadmap & requirements
- `.planning/ROADMAP.md` §"Phase 20: Foundation" — goal + 5 success criteria
- `.planning/REQUIREMENTS.md` — WA-01..WA-07, WA-11, WA-12 (Phase 20's requirement IDs)

### Live Aria source — integration points to follow
- `src/main/ipc/index.ts` — `onDbReady` post-unlock wiring pattern (where `WhatsAppSessionManager` is constructed); pre-unlock stub + `removeHandler` re-register pattern
- `src/main/ipc/provider-accounts.ts` — disconnect cascade to mirror for `provider_key='whatsapp'`
- `src/main/integrations/sync-orchestrator.ts` — `isMailCalendarAccount()` already excludes whatsapp (no change needed); do NOT route whatsapp through `scheduleAccount`/`tickAccount`
- `src/main/migrations/135_repair_approval_child_fks.sql` — the `PRAGMA legacy_alter_table=ON` FK-rewrite pattern migration 138 must replicate
- `electron.vite.config.ts` — `externalizeDepsPlugin` exclude pattern (add `@whiskeysockets/baileys`)
- `src/renderer/components/AccountRow.tsx` — status chip / dot / Reconnect / Disconnect surface to extend for whatsapp (add `'whatsapp'` to `providerDisplayName`)
- `src/renderer/features/settings/IntegrationsSection.tsx` — `AddAccountModal` connect entry + `AccountRow` render + `DisconnectConfirmDialog` flow to integrate WhatsApp into
- `src/renderer/components/editorial/Checkbox.tsx` — editorial Checkbox primitive for the consent-gate ack
- `src/renderer/components/ToastHost.tsx` — exists, but D-09 says NOT used for connection drops

### Cross-cutting references (from MEMORY)
- IPC double-register fix — `WHATSAPP_CHANNELS` const array + `removeHandler` loop (reference: `reference_electron_ipc_double_register`); the `ipc/index.spec.ts` handler-count test must be updated
- SQLite RENAME FK-rewrite — migration 138 must use `PRAGMA legacy_alter_table=ON` (reference: `reference_sqlite_rename_fk_rewrite`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AccountRow.tsx`: status chip (`linked`/`needs-auth`/`degraded`), colored dot, inline Reconnect (needs-auth), Sync now, Disconnect. Add `'whatsapp'` to `providerDisplayName()`; map WhatsApp session states onto existing chip styles (D-08). Add a "Manage groups" action link (D-01).
- `IntegrationsSection.tsx`: connect entry is `AddAccountModal`; connected rows via `AccountRow`; destructive disconnect via `DisconnectConfirmDialog` + `providerAccountDisconnect` IPC. WhatsApp connect needs a QR path (not OAuth browser window) launched from AddAccountModal.
- `editorial/Checkbox.tsx`: hairline→gold-fill checkbox used in MnemonicShow/CountrySectorPicker — the consent-gate ack (D-05).
- `sweep-cron`: existing retention sweep cron — extend for the 30-day WhatsApp window (D-14).

### Established Patterns
- `onDbReady` post-unlock service construction in `ipc/index.ts` (same pattern as SyncOrchestrator, folderRegistry, entitlement) — where `WhatsAppSessionManager` is wired.
- Canonical-channel-array + `removeHandler` loop for stub→real IPC re-registration (avoids the double-register throw that hit all 4 sites on 2026-06-09).
- `provider_account` row + generic disconnect cascade reused for a non-mail/calendar provider.

### Integration Points
- New `src/main/whatsapp/` module (session-manager, auth-state, ingest, group-sync; digest-cron is Phase 21).
- New `src/main/ipc/whatsapp.ts` registrar exporting `WHATSAPP_CHANNELS`.
- Migration `138_whatsapp.sql` (4 tables + `provider_account` CHECK rebuild).
- Renderer: consent modal, QR modal, AccountRow extension, group-picker modal, disconnect confirm.

</code_context>

<specifics>
## Specific Ideas

- Consent ack should feel like the existing mnemonic-acknowledgement moment (editorial Checkbox, gold fill) — informed-consent friction without being punitive.
- "No history before this moment" notice is a single sentence shown at link-success time.
- Group picker is modal-with-search, not a long inline list — anticipate execs in 50+ groups.

</specifics>

<deferred>
## Deferred Ideas

- **Briefing WhatsApp degraded-note rendering** — surfaces a "WhatsApp reconnecting / needs re-link" line in the briefing section (D-10). Belongs to **Phase 21** (briefing assembler). Phase 20 only exposes the status via `provider_account`.
- **Pairing-code linking** (alternative to QR) — future enhancement, not v2.1 (D-12).
- **Per-group / configurable retention window** — locked at fixed 30-day rolling for v2.1; user-configurable retention is a future idea, not this phase.
- **Daily digest + per-group summaries** — Phase 21.
- **Action-item / meeting-proposal / RAG extraction consumers** — Phase 22 (deferred, post-Phase-21 UAT).

</deferred>

---

*Phase: 20-foundation*
*Context gathered: 2026-06-09*

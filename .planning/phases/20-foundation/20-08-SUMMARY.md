---
phase: 20-foundation
plan: 08
status: complete
completed_at: 2026-06-10
requirements: [WA-12, WA-01, WA-02, WA-04, WA-06]
---

# Plan 20-08 Summary — Phase Close-out (WA-12 test + live UAT)

## Outcome

**COMPLETE.** Both tasks done; Phase 20 live UAT APPROVED.

### Task 1 — WA-12 degradable integration test (automated)

- `tests/unit/main/whatsapp/whatsapp-degradable.spec.ts` — 8/8 GREEN (commit `cc7601c`).
- Proves a socket-startup throw is caught, `start()` resolves (never rejects), and
  `provider_account.status` becomes `degraded` — app boot and the briefing path are
  never blocked. SyncOrchestrator exclusion also asserted.

### Task 2 — Live manual verification (human-action checkpoint)

Ran end-to-end on a secondary WhatsApp number (2348160622940), 2026-06-10. All six
checklist steps PASS — see `20-08-VERIFICATION.md` for the signed-off table. Summary:

- **WA-01** QR link: QR renders (SVG data-URL) and auto-refreshes; scan completes the link.
- **WA-02** consent: ban-risk bullets + secondary-number callout; QR gated on the ack checkbox.
- **WA-03** status: AccountRow shows `WHATSAPP · OK` with the phone number.
- **WA-04** disconnect: cascade wipes `provider_account` + `whatsapp_auth_state` + `whatsapp_group`
  (→ `whatsapp_message`/`whatsapp_group_digest` via FK); confirmed by the post-disconnect
  `start.skip-unlinked` log (no row → no auto-connect).
- **WA-05** groups: 90 participating groups fetched on connect; per-group track toggle.
- **WA-06** ingest: tracked-group messages flushed (`batch.flushed count:1` ×6); untracked
  group + DM produced ZERO rows (3-line privacy filter); message body never logged.
- Persistence: link survives restart (auto-reconnect, no re-scan). Gap-6: silent boot.

## Key files

- `tests/unit/main/whatsapp/whatsapp-degradable.spec.ts` (Task 1)
- `.planning/phases/20-foundation/20-08-VERIFICATION.md` (signed-off checklist)

## Deviations / live-UAT fixes

Nine root-cause defects surfaced only under live linking (none caught by unit tests +
typecheck, which were all green) and were fixed during UAT — commits `87045e0..9a8864f`.
Full list in `20-08-VERIFICATION.md` § Issues Found. Highlights with reusable lessons:

- Migrations must self-restore PRAGMA state — prod boots via `runMigrationsOnOpen:'deferred'`
  which bypasses the connect.ts re-enable (FK-off would have broken the WA-04 cascade).
- A pure-ESM dep (Baileys) must be bundled, but its CJS deps that drag optional natives
  (`ws`→bufferutil, `jimp`) must be externalized; run `pnpm build` as a gate (typecheck/vitest miss it).
- NEVER hardcode a Baileys WA Web version — `fetchLatestWaWebVersion()` (cached per session);
  a stale version is a hard `<failure reason=405>` before any QR.
- A Baileys auth adapter MUST persist the full `sock.authState.creds`, not the `creds.update`
  PARTIAL payload (overwriting drops noiseKey).
- Group discovery needs an explicit `groupFetchAllParticipating()` on open; `groups.upsert` is delta-only.

## Self-Check: PASSED

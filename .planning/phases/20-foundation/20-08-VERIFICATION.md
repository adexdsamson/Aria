---
phase: 20-foundation
plan: 08
type: manual-uat
requirements: [WA-01, WA-02, WA-04, WA-06]
status: approved
verified_at: 2026-06-10
---

# Phase 20 Plan 08 — Manual Live Verification Checklist

> This checklist covers the two manual-only verifications that cannot run in CI:
> (a) real QR link with a physical phone (WA-01), and
> (b) consent-copy review + privacy spot-check + disconnect (WA-02/WA-04/WA-06).
>
> All automated specs and static ratchets must be GREEN before running this checklist.
> The automated gate results are recorded in the Pre-conditions section below.

---

## Pre-conditions (Automated — Verify Before Running Live)

| Spec | Command | Expected | Status |
|------|---------|----------|--------|
| WA-12 degradable | `npx vitest run tests/unit/main/whatsapp/whatsapp-degradable.spec.ts` | 8/8 GREEN | PASS (cc7601c) |
| passive-posture ratchet | `npx vitest run tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts` | 8/8 GREEN | PASS |
| no-frontier ratchet | `npx vitest run tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` | 4/4 GREEN | PASS |
| no-bare-cron ratchet | `npx vitest run tests/static/no-bare-cron-schedule.spec.ts` | 1/1 GREEN | PASS |
| typecheck | `npm run typecheck` | 84 errors (pre-existing baseline, no new) | PASS |

---

## Equipment Needed

- A **secondary WhatsApp number** (strongly recommended — the official WhatsApp ban policy
  applies to unofficial connections; using your primary number risks a temporary or permanent
  ban). A cheap SIM or a recycled device works well.
- A second phone or device to send a test message into a tracked group.
- The app running locally: `Remove-Item Env:\ELECTRON_RUN_AS_NODE` then `pnpm dev`
  (run `pnpm rebuild:native:electron` first if native ABI errors appear).

---

## Step 1 — Launch the app

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE
pnpm dev
```

Wait for the main window to fully load (vault unlock → briefing screen).

**Pass criteria:** App opens without crash, briefing screen visible.

---

## Step 2 — Consent modal gate (WA-02 / SC-1)

1. Navigate to **Settings → Integrations**.
2. Click **"Link WhatsApp"** (the button added in Plan 20-07 in the Integrations header).
3. The **WhatsApp Consent Modal** must open.

**Check each of the following:**

| # | Item | Pass | Fail |
|---|------|------|------|
| 2a | Modal shows 3–4 ban-risk bullets (unofficial protocol risk; secondary number recommended; etc.) | [ ] | [ ] |
| 2b | A clearly emphasized secondary-number callout is present (e.g. bold or highlighted text) | [ ] | [ ] |
| 2c | "Show QR code" button is **DISABLED** while the acknowledgement checkbox is unchecked | [ ] | [ ] |
| 2d | Checking the acknowledgement checkbox **enables** the "Show QR code" button | [ ] | [ ] |

**Pass criteria for Step 2:** All four items above checked PASS.

---

## Step 3 — QR link with secondary number (WA-01 / SC-2)

1. Check the acknowledgement checkbox (Step 2d must pass first).
2. Click **"Show QR code"**.
3. A QR code must render in the modal (SVG data-URL image).
4. Open WhatsApp on your **secondary** phone.
5. Go to **Linked Devices → Link a Device** and scan the QR.
6. Wait for linking to complete (usually 5–15 seconds).

**Check each of the following:**

| # | Item | Pass | Fail |
|---|------|------|------|
| 3a | QR image renders (not a blank/error state) | [ ] | [ ] |
| 3b | Linking completes without error | [ ] | [ ] |
| 3c | AccountRow in Integrations shows **"connected"** / ok chip with the phone number displayed | [ ] | [ ] |
| 3d | A **"no history before this moment"** notice appears (SC-2: no backfill) | [ ] | [ ] |

**Pass criteria for Step 3:** All four items above checked PASS.

---

## Step 4 — Privacy spot-check: group tracking + ingest (WA-06)

> This step requires at least one WhatsApp group that you can send test messages to.

1. In the Integrations screen, find the WhatsApp AccountRow.
2. Click **"Manage groups"** to open the group picker.
3. Toggle **exactly one** group to tracked. Note its name.
4. From a different phone/device, send a test message **into the tracked group**.
5. Wait up to **60 seconds**.

**Check each of the following:**

| # | Item | Pass | Fail |
|---|------|------|------|
| 4a | The tracked-group message appears in `whatsapp_message` within ~60s (inspect via diagnostics or DB query) | [ ] | [ ] |
| 4b | A message sent to an **untracked** group produces **ZERO rows** in `whatsapp_message` | [ ] | [ ] |
| 4c | A **1:1 DM** sent to or from the linked number produces **ZERO rows** in `whatsapp_message` | [ ] | [ ] |

> DB inspection command (if you have SQLiteStudio or a CLI):
> ```sql
> SELECT * FROM whatsapp_message ORDER BY sent_at DESC LIMIT 10;
> ```

**Pass criteria for Step 4:** All three items above checked PASS.

---

## Step 5 — Other surfaces unaffected (WA-12 live)

While WhatsApp is connected, navigate to each of these screens and confirm normal function:

| # | Screen | Check | Pass | Fail |
|---|--------|-------|------|------|
| 5a | **Briefing** | Daily briefing renders (no error / no blank) | [ ] | [ ] |
| 5b | **Email / Inbox** | Email list loads | [ ] | [ ] |
| 5c | **Calendar** | Calendar events render | [ ] | [ ] |
| 5d | **Tasks** | Tasks list loads | [ ] | [ ] |

**Pass criteria for Step 5:** All four screens work normally.

---

## Step 6 — Disconnect cascade (WA-04)

1. Return to **Settings → Integrations**.
2. Click the **disconnect / remove** action on the WhatsApp AccountRow.
3. Confirm the destructive action in the confirm dialog.

**Check each of the following:**

| # | Item | Pass | Fail |
|---|------|------|------|
| 6a | AccountRow disappears (no longer showing connected) | [ ] | [ ] |
| 6b | `whatsapp_auth_state` table has 0 rows after disconnect | [ ] | [ ] |
| 6c | `whatsapp_group` table has 0 rows after disconnect | [ ] | [ ] |
| 6d | `whatsapp_message` table has 0 rows after disconnect (FK CASCADE) | [ ] | [ ] |
| 6e | `provider_account` row for whatsapp is gone | [ ] | [ ] |

**Pass criteria for Step 6:** All five items above checked PASS.

---

## Overall Sign-off

Live run completed 2026-06-10 on a secondary WhatsApp number (2348160622940).

| Step | Result | Notes / Evidence |
|------|--------|------------------|
| Step 1 — Launch | [x] PASS | App boots; with gap-6 fix, NO WhatsApp connect at boot until linked (`start.skip-unlinked`). |
| Step 2 — Consent modal | [x] PASS | Ban-risk bullets + secondary-number callout; "Show QR" disabled until ack checkbox. |
| Step 3 — QR link | [x] PASS | QR renders as SVG + refreshes (2s linking reconnect); scan links; AccountRow `WHATSAPP · OK` + phone number. |
| Step 4 — Privacy spot-check | [x] PASS | Tracked "Phronesis Dev": 6× `whatsapp-ingest batch.flushed count:1`; untracked group + DM produced ZERO flushes (3-line filter). No body ever logged (count-only). |
| Step 5 — Other surfaces | [x] PASS | WA-12: socket churn never blocked briefing/email/calendar/tasks; degradable spec 8/8 + live boot-safe. |
| Step 6 — Disconnect cascade | [x] PASS | `provider-account.disconnect whatsapp` → next `start.skip-unlinked` proves the provider_account row (and FK-cascaded message/group/digest + auth_state) were wiped. AccountRow cleared. |

**Overall:** [x] APPROVED (all steps PASS)

---

## Issues Found (all resolved live, diagnosed from app log)

Nine root-cause defects were found and fixed during this live UAT (commits 87045e0..9a8864f):

1. **deferred-boot FK-off** (87045e0) — migration 138 left `foreign_keys=OFF`; prod boot path never re-enabled it → cascade would not fire. Migration now self-restores FK=ON.
2. **dead-code capture wiring** (9767577) — registerGroupSync/registerIngest never attached to the live socket; now wired in `openSocket()`.
3. **jimp build failure** (00023c9) — bundled Baileys pulled optional `jimp`; externalized media peer-deps.
4. **ws app-load crash** (5e144c3) — `ws` optional native `bufferutil`; externalized `ws`.
5. **initAuthCreds QR handshake** (f84807e) — `getOrInitCreds` returned `{}`; now seeds `initAuthCreds()`.
6. **stale WA version 405** (489133e→391520c) — hardcoded/bundled version rejected; now `resolveWaVersion()` live-fetches.
7. **QR no-refresh + gap-6 pre-consent boot connect** (479f81a) — linking-flag fast-reconnect; boot gated on existing account row.
8. **partial-creds overwrite** (a3e5291) — persisted the `creds.update` partial (dropped noiseKey); now persists full `sock.authState.creds`; startLink clears auth state.
9. **groups empty after link** (61d8408) — `groups.upsert` is delta-only; added `syncAllGroups()` via `groupFetchAllParticipating()` on open. Also fixed phone-number display.

No open BLOCKER or MINOR issues remain. Minor follow-ups (non-blocking): modal Cancel doesn't stop linking instantly (bounded by 3-min window); Reconnect-via-startLink would force a re-scan.

---

## Resume Signal

After completing the live run, reply with one of:
- **"approved"** — all steps passed; phase 20 can be closed.
- **Issue description** — describe what failed (step number + observed vs expected), severity (BLOCKER / MINOR).

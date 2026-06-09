---
phase: 20
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `20-RESEARCH.md` § Validation Architecture. Per-task IDs are
> seeded at requirement level here and bound to plan/wave during planning.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 2 (unit/integration) + Playwright `_electron` (E2E/smoke) |
| **Config file** | `electron.vite.config.ts` / vitest projects (main/renderer split) |
| **Quick run command** | `npx vitest run <spec> -t "<name>"` — run ONE spec at a time (parallel-projects race, MEMORY reference_vitest_parallel_projects_quirk) |
| **Full suite command** | `pnpm test` **+ `npm run typecheck`** (esbuild skips typecheck) |
| **Estimated runtime** | ~30–60 s per spec; full suite minutes |

---

## Sampling Rate

- **After every task commit:** `npx vitest run <spec touched>` + `npm run typecheck`
- **After every plan wave:** full `pnpm test` + all WhatsApp ratchet specs green
- **Before `/gsd-verify-work`:** full suite green + 3 static ratchets (WA-11 send-ban, frontier-import-ban, no-bare-cron) green + handler-count test updated
- **Max feedback latency:** ~60 s (single spec)

---

## Per-Task Verification Map

> Plan/Wave/Task-ID columns bind during planning. Seeded at requirement + hard-gate level.

| Ref | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----|-------------|-----------------|-----------|-------------------|-------------|--------|
| R-WA01 | WA-01 | QR `connection.update.qr` → `WHATSAPP_QR_UPDATE` push fires with data-URL | smoke + unit | `npx vitest run whatsapp-session.spec` | ❌ W0 | ⬜ pending |
| R-WA02 | WA-02 | "Show QR" disabled until Checkbox checked; `onShowQr` uncallable while unchecked | unit (renderer) | `npx vitest run whatsapp-consent.spec` | ❌ W0 | ⬜ pending |
| R-WA03 | WA-03 | AccountRow chip `#c98a3a` needs-auth / `#b34` degraded; Reconnect dispatches `WHATSAPP_LINK` | unit | `npx vitest run AccountRow.spec` | ❌ W0 | ⬜ pending |
| R-WA04 | WA-04 | After `WHATSAPP_DISCONNECT`: 0 rows in all 4 WA tables + provider_account row gone; `manager.stop()` called | integration | `npx vitest run whatsapp-disconnect.spec` | ❌ W0 | ⬜ pending |
| R-WA05 | WA-05 | `WHATSAPP_SET_TRACKED` flips `whatsapp_group.tracked`; picker opens from "Manage groups" link | unit | `npx vitest run whatsapp-groups.spec` | ❌ W0 | ⬜ pending |
| R-WA06 | WA-06 | **CRITICAL** — 1:1 + untracked-group msgs produce ZERO rows AND no log of body; only tracked-group written | integration | `npx vitest run ingest-privacy.spec` | ❌ W0 | ⬜ pending |
| R-WA07 | WA-07 | `extractText` → null for media; retention sweep deletes `sent_at < now-30d`, keeps newer | unit | `npx vitest run whatsapp-retention.spec` | ❌ W0 | ⬜ pending |
| R-WA11 | WA-11 | **HARD GATE** — grep `src/main/whatsapp/**`: 0 `sendMessage`/`sendReceipt`/`readMessages`/non-`'unavailable'` presence; config `markOnlineOnConnect:false`,`emitOwnEvents:false` | static-grep ratchet | `npx vitest run passive-posture.ratchet.spec` | ❌ W0 | ⬜ pending |
| R-WA12 | WA-12 | Briefing/email/calendar/tasks IPC succeed when WA `degraded`; `isMailCalendarAccount({providerKey:'whatsapp'})===false`; socket-startup throw doesn't reject boot | integration | `npx vitest run whatsapp-degradable.spec` | ❌ W0 | ⬜ pending |
| R-G03 | WA-09 (Ph21 ratchet, dir lands now) | grep `whatsapp/**`: 0 `getFrontierModel`/`@ai-sdk/{anthropic,openai,google}`/frontier router | static-grep ratchet | `npx vitest run no-frontier.ratchet.spec` | ❌ W0 | ⬜ pending |
| R-G04 | (gate 4) | `authState.keys.set()` partial-failure mid-loop → 0 rows persisted (transaction rollback) | unit | `npx vitest run auth-state.spec` | ❌ W0 | ⬜ pending |
| R-G05 | (gate 5) | 401/403/440/500 → no reconnect (→needs-auth); 408/515 → backoff; cap→degraded after 5 | unit | `npx vitest run session-reconnect.spec` | ❌ W0 | ⬜ pending |
| R-G06 | (gate 6) | recycle cron in `scheduler.cronRegistry` (no bare `cron.schedule`); firing → disconnect()+start() | unit | `npx vitest run session-recycle.spec` | ❌ W0 | ⬜ pending |
| R-G07 | (gate 7) | grep `ingest.ts`: 0 `db.*.run(` in `messages.upsert` callback; N msgs/window → ONE transaction | unit + static-grep | `npx vitest run ingest-privacy.spec` | ❌ W0 | ⬜ pending |
| R-G12 | (gate 12) | migration 138 contains `legacy_alter_table=ON`; post-138 insert into `provider_sync_state` ok; `user_version==138` | integration + file | `npx vitest run migration-138.spec` | ❌ W0 | ⬜ pending |
| R-G11 | (gate 11) | `electron.vite.config.ts` `main.plugins` exists; externalize exclude contains baileys id; config has `syncFullHistory:false` | unit (config) | `npx vitest run electron-vite-config.spec` | ❌ W0 | ⬜ pending |
| R-G10 | (gate 10) | `package.json` baileys==`"6.7.23"` (no `^`/`~`); lockfile resolves it; CI `--frozen-lockfile` | CI / file | `npx vitest run supply-chain-pin.spec` | ❌ W0 | ⬜ pending |
| R-IPC | (IPC double-register) | post stub→removeHandler(WHATSAPP_CHANNELS)→real register: no throw; handler-count test updated for +7 channels | unit | `npx vitest run ipc/index.spec` | ✅ (update) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/main/whatsapp/auth-state.spec.ts` — gate 4 (transaction atomicity), WA-06 helpers
- [ ] `tests/unit/main/whatsapp/ingest-privacy.spec.ts` — WA-06 + gates 7/8/9 (CRITICAL privacy)
- [ ] `tests/unit/main/whatsapp/session-reconnect.spec.ts` — gate 5 (DisconnectReason classification)
- [ ] `tests/unit/main/whatsapp/passive-posture.ratchet.spec.ts` — gates 1/2 (WA-11 send-ban grep)
- [ ] `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` — gate 3 (frontier-import ban)
- [ ] `tests/unit/main/db/migration-138.spec.ts` — gate 12 (legacy_alter_table + provider_sync_state insert)
- [ ] `tests/unit/main/ipc/index.spec.ts` — UPDATE handler-count for +7 WHATSAPP channels
- [ ] `tests/unit/main/electron-vite-config.spec.ts` — gate 11 (main externalize exclude) + D-13 flags
- [ ] `tests/unit/renderer/whatsapp-consent.spec.ts` — WA-02 (D-07 QR gating)
- [ ] No new framework install needed (Vitest + Playwright already present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real QR link completes against live WhatsApp | WA-01 | Requires a real phone + WhatsApp account; cannot run in CI | Link a **secondary number** in-app; confirm AccountRow shows "connected" + phone; send a tracked-group message; confirm it appears in `whatsapp_message` <60s; confirm "no history before this moment" notice shown |
| Ban-risk consent copy + secondary-number callout reads clearly | WA-02 | Subjective copy/UX review | Open consent modal; confirm 3–4 risk bullets, emphasized secondary-number callout, QR does not render until ack |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

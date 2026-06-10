# Aria Roadmap

**Project:** Aria — local-first desktop AI executive assistant

## Milestones

- **v1.0** — ✅ SHIPPED 2026-06-02 — Phases 1–13 (incl. 08.1). Daily briefing + approval-gated chief-of-staff actions (email/calendar/meetings/tasks), RAG + Knowledge Folders, insights/recap, subscription, editorial UI, research, background tray, open-source prep. Full detail: [milestones/v1.0-ROADMAP.md](./milestones/v1.0-ROADMAP.md) · audit: [v1.0-MILESTONE-AUDIT.md](./v1.0-MILESTONE-AUDIT.md) · summary: [MILESTONES.md](./MILESTONES.md)

---

## Milestone v2.0 — Voice Interface ⏸ PARKED

> **Status: PARKED as of 2026-06-09.** v2.0 phases (14–19) are preserved intact — no phase directories were cleared. Phases 14–17 are code-complete; Phase 17 is paused at a live-acoustic human-verify checkpoint. Phases 18–19 are unstarted. Resume after v2.1, or interleave. Phase numbering for v2.1 continues from Phase 20.

**Goal:** Aria becomes voice-driven — a full conversational, talk-to-Aria assistant layered over the existing briefing / triage / scheduling / ask / drafting surfaces. Voice is a new input/output **modality**, not a rebuild: every outbound action still routes through the existing `assertApproved` chokepoint.

**Locked decisions (carry into every phase's context):**

- **Hybrid audio, local-first default + cloud opt-in.** On-device STT (Whisper large-v3-turbo, MIT) + on-device TTS (Kokoro-82M / Chatterbox-Turbo) by default; consent-gated cloud STT/TTS opt-in mirrors the existing hybrid-LLM routing. Sensitivity-flagged turns stay on-device regardless of opt-in.
- **Push-to-talk first; wake-word last** (opt-in, OFF by default, licensing-gated).
- **Voice-confirm routes THROUGH `assertApproved`, never around it.** A spoken "yes" produces the same explicit approval transition the UI click does; the unified send adapter still runs the gate.
- **STT in a sidecar/worker** (mirrors the Ollama sidecar pattern) to dodge the Electron-41 native-addon ABI trap; renderer owns all audio I/O.
- **Half-duplex mic-gating during playback** — Chromium AEC no-ops in Electron (#47043); do not build on `echoCancellation: true`.

**Phase numbering continues from v1.0** (which ended at Phase 13). v2.0 = Phases 14–19.

### Phases (v2.0)

- [x] **Phase 14: Voice Safety / Confirm Contract** - Design the voice-confirm contract, the HARD GATE blocking voice from forced/high-severity, and the STATIC RATCHET on voice write-paths — before any fluency work. (completed 2026-06-03)
- [x] **Phase 15: Audio I/O + Model Runtime** - Renderer mic/VAD/playback + STT sidecar that survives packaging; prove AEC + ABI + RAM + device handling on the packaged app. (completed 2026-06-04)
- [x] **Phase 16: Streaming Cascade + Barge-in (read-only)** - The "feels conversational" loop with zero write risk: streaming STT→LLM→TTS, barge-in, spoken briefing/answer playback. (completed 2026-06-07)
- [x] **Phase 17: Voice-Confirm + Writes Through the Gate** - Voice-driven triage/scheduling/drafting via the confirm flow + assertApproved; mishear recovery; cloud opt-in consent + voice settings. (completed 2026-06-09)
- [ ] **Phase 18: Opt-in Wake-Word + Privacy Isolation** - "Hey Aria" in a privacy-isolated, provably-killable process, OFF by default — gated on the commercial wake-word licensing decision.
- [ ] **Phase 19: Cloud Opt-in Polish + Performance** - GPU whisper, MessagePort PCM, voice-priority p-queue lane, idle model unload, accessibility polish. (Optimization, not net-new capability.)

## Phase Details (v2.0)

### Phase 14: Voice Safety / Confirm Contract

**Goal**: The voice-to-approval safety contract exists and is enforced before any conversational fluency is built — voice can stage but never auto-execute, and high-stakes actions can never be authorized by voice alone.
**Depends on**: Nothing (first phase of v2.0; extends existing `assertApproved` / approval-transition / static-grep patterns)
**Requirements**: VOICE-10
**Success Criteria** (what must be TRUE):

  1. A voice-staged action lands as an approval row in `state='draft'` and is never executed without a separate explicit confirm turn.
  2. The approval gate rejects a voice-confirm (`approval_path='voice-explicit'`) for forced categories (financial/legal/HR) and `severity==='high'`, forcing the on-screen typed/clicked confirm — verifiable by a failing-then-passing gate test.
  3. The static-grep ratchet fails the build if the voice handler is a direct caller of `send.ts` / `write-event.ts` / `push-actions.ts`, proving voice routes through the same staging the UI uses.
  4. A voice confirm of a low/medium-severity action performs the SAME `approve()` transition the Approvals UI performs, then runs the unchanged unified send adapter (`assertApproved`).

**Plans**: 3 plans (2 waves)

  - [x] 14-01-PLAN.md — Schema + type foundation: ApprovalPath union extension + v134 CHECK-widening migration (.sql + embedded.ts)
  - [x] 14-02-PLAN.md — Named voice-forbidden-forced gate branch + dormant voiceConfirm seam + SC2/SC4 tests
  - [x] 14-03-PLAN.md — Two static ratchets (chokepoint caller allow-list + named voice ratchet) + ARCHITECTURE.md reconciliation

### Phase 15: Audio I/O + Model Runtime

**Goal**: Aria can capture the user's voice, detect speech endpoints, run local transcription that survives packaging, and play synthesized speech — proven on the packaged app on Windows + macOS, without echoing itself or breaking the native-addon ABI.
**Depends on**: Phase 14
**Requirements**: VOICE-01, VOICE-04, VOICE-07
**Success Criteria** (what must be TRUE):

  1. User holds a hotkey (or clicks) to talk and sees their words transcribed live on screen (push-to-talk + live transcription).
  2. Transcription runs fully on-device by default (local Whisper via the STT sidecar/worker) — no audio leaves the machine, and the packaged app launches with no `NODE_MODULE_VERSION` ABI crash.
  3. Mic state is always visible (listening / processing / speaking), and the mic is gated during TTS playback so Aria never transcribes its own speech (verified on laptop speakers, not just headphones).
  4. First-run model download is a designed flow (progress + resumable + size disclosure + graceful "voice unavailable until ready" state), not a bare spinner.
  5. Plugging/unplugging an audio device mid-session is handled gracefully (device hot-swap + 16 kHz resample + permission-denied surfaced as an actionable error).

**Plans**: 9 plans (5 waves)

  - [x] 15-01-PLAN.md — Wave 0 foundation: CSP blob: fix + voice-types/IPC contract + settings-KV model-readiness prefs + no-cloud ratchet
  - [x] 15-02-PLAN.md — STT whisper.cpp CLI sidecar manager + WAV writer + no-native-addon ratchet (SC2 by construction)
  - [x] 15-03-PLAN.md — Resumable Whisper model download manager (NDH + powerMonitor + readiness flip)
  - [x] 15-04-PLAN.md — Renderer mic capture: getUserMedia + inline-Blob AudioWorklet + 16kHz + device hot-swap
  - [x] 15-05-PLAN.md — Voice IPC handlers (feedAudio→sidecar→transcript push) + bootstrap powerMonitor wiring
  - [x] 15-06-PLAN.md — Real Kokoro TTS playback + Zustand session store + half-duplex micGated gate (SC3)
  - [x] 15-07-PLAN.md — Mic-state surface: VoiceStatusDot + VoiceHUDBand + PTT + App/Topbar wiring
  - [x] 15-08-PLAN.md — Model-download UX: onboarding step + lazy modal + disabled-PTT affordance (SC4)
  - [x] 15-09-PLAN.md — Packaging: extraResources binary + mac.binaries signing + packaged-launch E2E (SC2) + RAM ceiling

**UI hint**: yes

### Phase 16: Streaming Cascade + Barge-in (read-only)

**Goal**: Aria holds a natural spoken conversation over read-only surfaces — it starts speaking before it finishes thinking, the user can interrupt and be heard immediately, and context carries across turns. Zero write risk.
**Depends on**: Phase 15
**Requirements**: VOICE-02, VOICE-03, VOICE-06
**Success Criteria** (what must be TRUE):

  1. Aria reads the daily briefing aloud with working pause / skip-section / speed (0.5–2x) controls.
  2. Aria speaks `/ask` answers aloud, streaming the first sentence while the rest is still generating (first-audio p50 well under ~900 ms, visible in per-stage telemetry).
  3. The user can talk over Aria and Aria stops promptly (<~200 ms): the single per-turn AbortController cancels the LLM stream, flushes the TTS queue, stops audio playback, and persists the spoken-so-far portion to context.
  4. Aria maintains context across turns (referent resolution like "that one" / "and then") so a multi-turn read-only conversation feels coherent.
  5. A backchannel ("mhm", "right") does not interrupt Aria, but a real interruption does.

**Plans**: 5 plans (4 waves)
Plans:

- [x] 16-01-PLAN.md — Wave 0 contract foundation: 3 new IPC channels + migration 136 (voice_latency_log) + stub handlers (handler-count 149→152) + failing spec scaffolds
- [x] 16-02-PLAN.md — Main-process pure logic: TtsSegmenter (D-04) + streamVoiceAnswer (D-03/D-11) + voice-latency-log writer (D-06)
- [x] 16-03-PLAN.md — Renderer pure logic: useVoiceSession bargeIn/pause/resume (D-01/D-09) + KokoroPlayer speed type (D-08) + useReadAloudQueue (D-05/D-07)
- [ ] 16-04-PLAN.md — Integration: VoiceSessionManager (D-11/D-12) + IPC wiring + VoiceHUDBand transport controls (D-09/D-10) + BriefingScreen read-aloud (D-07)
- [x] 16-05-PLAN.md — D-13 read-only static ratchet (voice-streaming-no-write.spec.ts)

**UI hint**: yes

### Phase 17: Voice-Confirm + Writes Through the Gate

**Goal**: The user can do real chief-of-staff work by voice — triage, schedule, draft, push tasks — and every action that writes is read back with resolved entities and explicitly confirmed before the existing gate runs. Hybrid local/cloud audio is available behind consent, and the user controls voice settings.
**Depends on**: Phase 16 (read-only loop + barge-in/cancellation battle-tested first) and Phase 14 (the confirm contract it now exercises)
**Requirements**: VOICE-05, VOICE-08, VOICE-09, VOICE-11
**Success Criteria** (what must be TRUE):

  1. User can drive triage / scheduling / `/ask` / drafting by voice, and each voice intent calls the same in-process service the existing IPC handler uses (never re-crossing the preload bridge).
  2. Before any send / calendar change / task push, Aria reads back the RESOLVED entities (resolved contact email, absolute date/time in the user's tz — never the raw transcript) and requires an explicit dual-channel confirm; high-severity / forced categories fall back to the on-screen tap.
  3. The user can correct or cancel a mis-recognized command (spoken "cancel / stop / never mind", recognized even mid-read-back) before it acts.
  4. User can opt into cloud STT/TTS via an explicit consent + data-handling disclosure gate; sensitivity-flagged turns stay on-device regardless of the opt-in.
  5. User can set voice / speed / local-vs-cloud output preferences in Settings, and the choice is honored per turn.

**Plans**: 7 plans (4 waves)
Plans:

- [x] 17-01-PLAN.md — Wave 1: migration 137 ('cancelled' state) + state.ts + new IPC channels (VOICE_CONFIRM_APPROVAL/CANCEL/GET_PREFS/SET_PREFS) + stub handlers + voice/prefs.ts extension + ApprovalCard/approvals list 'cancelled' update
- [x] 17-02-PLAN.md — Wave 1: ask-service.ts extraction from ipc/ask.ts (D-02) — ask.spec.ts passes UNCHANGED
- [x] 17-03-PLAN.md — Wave 2: VoiceIntentRouter (D-01/D-03) + read-back template builder (D-05)
- [x] 17-04-PLAN.md — Wave 2: cloud-stt.ts (D-13) + shouldUseCloud() sensitivity gate (D-15) + real VOICE_GET/SET_PREFS handlers (D-16)
- [x] 17-05-PLAN.md — Wave 3: voiceConfirm wired live via VOICE_CONFIRM_APPROVAL handler + confirm-classifier (D-06) + useVoiceSession pendingApprovalId + useVoiceConfirm hook (D-04/D-09/D-10)
- [x] 17-06-PLAN.md — Wave 3: VoiceSection.tsx settings UI (D-16/VOICE-08) + ApprovalCard forceExplicit suppression + Cancel button (D-07/D-09/D-11/D-12)
- [x] 17-07-PLAN.md — Wave 4: D-17 ratchet update + voice-write-path integration test (SC2) + voice-confirm cancel path test (SC3) + human-verify checkpoint

**UI hint**: yes

### Phase 18: Opt-in Wake-Word + Privacy Isolation

**Goal**: A user who opts in can say "Hey Aria" to start a turn hands-free, with the always-listening detector running in a privacy-isolated, provably-killable process — OFF by default, and never sending or persisting raw audio.
**Depends on**: Phase 17 (push-to-talk + indicator + consent must ship first); gated on the commercial wake-word licensing decision (openWakeWord pretrained = non-commercial; Porcupine free tier caps at 3 MAU)
**Requirements**: VOICE-12
**Success Criteria** (what must be TRUE):

  1. Wake-word is OFF by default and enabled only through an explicit consent + disclosure toggle in Settings.
  2. When enabled, the detector runs in a separate, mic-isolated process that emits only a boolean trigger to main — pre-trigger audio lives in a ring buffer that is never written to disk or forwarded.
  3. Toggling wake-word off provably terminates that process (mic goes cold), and a visible "mic active" indicator is shown whenever it is listening.
  4. OS mic permission is requested lazily at first voice use, not at app launch.

**Plans**: TBD
**UI hint**: yes

### Phase 19: Cloud Opt-in Polish + Performance

**Goal**: The voice loop is dialed in for latency, quality, and resource use across the local and cloud paths — fast enough to feel effortless on the target laptop, with accessibility polish. Optimization of capabilities already shipped in 14–18; no net-new requirement.
**Depends on**: Phase 17 (and Phase 18 if wake-word shipped)
**Requirements**: _(none net-new — tunes VOICE-04 / VOICE-05 / VOICE-06 already delivered)_
**Success Criteria** (what must be TRUE):

  1. GPU-build whisper (Metal / CUDA / Vulkan) is selected when available and measurably cuts STT decode latency vs the CPU path.
  2. A hardware-capability probe routes under-spec machines to a lighter model or recommends cloud opt-in, and STT+TTS+LLM co-resident stays within RAM budget (lazy-load + idle-unload, RTF ≤ 1 on a 16 GB no-GPU laptop).
  3. Interactive voice turns are not stalled by a background briefing/sync (voice-priority p-queue lane), and the tuned latency budget holds under load.
  4. Accessibility polish lands: eyes-free TTS plus on-screen captions of Aria's speech.

**Plans**: TBD
**UI hint**: yes

## Progress (v2.0)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 14. Voice Safety / Confirm Contract | 3/3 | Complete    | 2026-06-03 |
| 15. Audio I/O + Model Runtime | 9/9 | Complete   | 2026-06-04 |
| 16. Streaming Cascade + Barge-in | 6/6 | Complete   | 2026-06-07 |
| 17. Voice-Confirm + Writes Through the Gate | 7/7 | Complete   | 2026-06-09 |
| 18. Opt-in Wake-Word + Privacy Isolation | 0/0 | Not started | - |
| 19. Cloud Opt-in Polish + Performance | 0/0 | Not started | - |

### Research Flags (v2.0)

Phases likely needing deeper `/gsd-research-phase` during planning:

- **Phase 15** — highest uncertainty: whisper.cpp binding under Electron 41 (sidecar vs addon, empirical build); Chromium AEC no-op (#47043) verified on Win + macOS; RAM ceiling of STT+TTS+LLM on 16 GB no-GPU; Kokoro WASM vs WebGPU perf.
- **Phase 18** — the wake-word licensing/cost decision (pay Picovoice / train custom openWakeWord / defer to v2.1) must be resolved before any dependency is added.

Lighter research (standard patterns extending existing Aria source): Phase 14 (assertApproved / static ratchet / approval transitions), Phase 16 (AI SDK streamText + sentence-split + streaming TTS).

---

## Milestone v2.1 — Messaging / Group Intelligence

**Goal:** Aria links the user's WhatsApp (QR-linked, like WhatsApp Web) and turns selected group chats into chief-of-staff intelligence — starting with a local-only daily-briefing digest of tracked groups. Group content (third-party PII) is summarized **local-only** via Ollama and never leaves the machine. Read-only / passive posture throughout — Aria observes, never sends.

**Locked decisions (carry into every phase's context):**

- **Baileys `@whiskeysockets/baileys@6.7.23` exact-pinned.** `latest` resolves to v7 RC (breaking API + WASM dep + p-queue v9 conflict). Pin must appear in `package.json` and `pnpm-lock.yaml` committed.
- **Passive posture is a hard invariant.** `markOnlineOnConnect:false`, `sendPresenceUpdate('unavailable')` on connect, `emitOwnEvents:false`. No send path exists — ever.
- **WhatsApp is a degradable capability.** A dropped session surfaces as a visible status badge and leaves all other Aria surfaces fully functional. The briefing generates without WhatsApp.
- **Group content is local-only.** `getLocalModel()` unconditionally in digest cron — no routing step, no frontier model, no cloud opt-in for WhatsApp content.
- **Hybrid `provider_account` + dedicated `WhatsAppSessionManager`.** Reuses existing account-management UI and disconnect cascade; does NOT participate in `scheduleAccount` / `tickAccount` / `provider_sync_state`.
- **Migration 138 uses `PRAGMA legacy_alter_table=ON`** around the `provider_account` CHECK-constraint rebuild — same pattern as migration 135 (avoids dangling FK rewrite to `provider_account_old`).

**Phase numbering continues from v2.0** (parked at Phase 19). v2.1 = Phases 20–22.

### Phases (v2.1)

- [x] **Phase 20: Foundation** - WhatsApp link/QR flow with ban-risk consent + auth state in SQLCipher + group selection + message ingestion + IPC/UI + all load-bearing safety guards (migration 138). (completed 2026-06-10)
- [x] **Phase 21: Digest + Briefing Integration** - Local Ollama digest cron (05:00) per tracked group + WhatsApp section in daily briefing + graceful Ollama-unavailable degradation + frontier-prohibition static ratchet. (completed 2026-06-10)
- [ ] **Phase 22: Extraction Consumers** *(deferred — post-Phase 21 validation)* - Action-item extraction (WA-F1), meeting-proposal detection (WA-F2), and project-feedback RAG capture (WA-F3) layered onto stored messages with zero schema additions.

## Phase Details (v2.1)

### Phase 20: Foundation

**Goal**: The user can link their WhatsApp account to Aria, select which groups to track, and have those groups' text messages silently ingested to the local encrypted database — with every load-bearing safety guard in place before the first message is stored.
**Depends on**: Nothing in v2.1 (extends existing `provider_account`, `ipc/index.ts` onDbReady pattern, `sweep-cron`, and SQLCipher DB from v1.0)
**Requirements**: WA-01, WA-02, WA-03, WA-04, WA-05, WA-06, WA-07, WA-11, WA-12
**Success Criteria** (what must be TRUE):

  1. User sees an explicit ban-risk disclosure (with secondary-number recommendation) before any QR code is shown, and must acknowledge it — the QR does not render until acknowledgement.
  2. User can scan the QR in Aria, complete linking, see the WhatsApp AccountRow show "connected" with their phone number, and see a one-sentence "no history before this moment" notice.
  3. After linking, the user can open a group-picker panel at any time, toggle groups tracked/untracked, and confirm that messages from untracked groups and 1:1 DMs are never written to the database.
  4. User can disconnect WhatsApp from the AccountRow; doing so tears down the Baileys socket and deletes all WhatsApp rows (auth state, groups, messages, digests) via the ON DELETE CASCADE disconnect cascade.
  5. The connection status badge (linked / reconnecting / needs-relink / disconnected) updates visibly on session events, and a degraded WhatsApp connection leaves the Briefing, Email, Calendar, and Tasks screens fully functional.

**Plans**: 8 plans (7 waves)
Plans:

- [x] 20-01-PLAN.md — Wave 1: pin baileys@6.7.23 + qrcode@1.5.4 + lockfile (gate 10) + main.plugins externalize exclude (gate 11) + ProviderKey/7 WHATSAPP_* channels + DTOs
- [x] 20-02-PLAN.md — Wave 1: Wave 0 test infra — 2 green-before-dir static ratchets (passive-posture, no-frontier) + 7 spec scaffolds (ingest-privacy CRITICAL, auth-state, reconnect, recycle, retention, migration-138, consent)
- [x] 20-03-PLAN.md — Wave 2: migration 138 (4 tables + provider_account CHECK rebuild w/ legacy_alter_table=ON, gate 12) + auth-state.ts (transactional keys.set, gate 4)
- [x] 20-04-PLAN.md — Wave 3: session-manager.ts — passive socket (gates 1/2) + QR push + reconnect classify (gate 5) + recycle cron (gate 6) + boot-safe degrade
- [x] 20-05-PLAN.md — Wave 4: group-sync (untracked-default) + ingest (3-line privacy filter + p-queue batch flush, gates 7/8/9, WA-06) + retention 03:30 sweep
- [x] 20-06-PLAN.md — Wave 5: ipc/whatsapp.ts (WHATSAPP_CHANNELS) + ipc/index.ts stubs + main/index.ts bootPoll wiring (removeHandler loop) + provider-accounts disconnect cascade (WA-04) + handler-count
- [x] 20-07-PLAN.md — Wave 6: renderer — consent ack-gate modal (SC-1) + QR modal + AccountRow chip/Reconnect/Manage-groups + group-picker (search+toggle) + IntegrationsSection + preload
- [x] 20-08-PLAN.md — Wave 7: WA-12 degradable integration test + live-QR/consent UAT checkpoint (human-verify)

**UI hint**: yes

### Phase 21: Digest + Briefing Integration

**Goal**: Each morning, before the daily briefing runs, Aria summarizes the activity in every tracked WhatsApp group using the local model only and inserts a WhatsApp section into that day's briefing — degrading gracefully if Ollama is unavailable, and never touching a frontier API.
**Depends on**: Phase 20 (tracked groups must exist; `whatsapp_message` rows must be present)
**Requirements**: WA-08, WA-09, WA-10
**Success Criteria** (what must be TRUE):

  1. The daily briefing contains a WhatsApp section with one named sub-section per tracked group, exec-framed: key points, decisions, open questions, and mentions of the user — visible from the first morning after at least one tracked-group message was received.
  2. The digest cron runs at 05:00 (before the briefing at 07:00), uses only `getLocalModel()` with no routing step, and the `UNIQUE(jid, date)` constraint makes re-runs idempotent.
  3. A static ratchet (grep test in CI) fails if any file under `src/main/whatsapp/` imports `getFrontierModel` or any frontier provider — enforcing that group content never reaches a cloud API.
  4. When Ollama is down or the local model is unavailable, the briefing still generates and the WhatsApp section shows a clear "WhatsApp digest unavailable — local model offline" note rather than failing or silently omitting the section.

**Plans**: 6 plans (4 waves)
Plans:
**Wave 1**

- [x] 21-01-PLAN.md — Wave 1: ipc-contract.ts BriefingPayload.whatsApp union + WhatsAppGroupSummaryDto + WHATSAPP_GENERATE_DIGEST_NOW channel + CatchupChannel 'whatsapp-digest'

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 21-02-PLAN.md — Wave 2: Wave 0 test scaffolds (digest-cron.spec.ts + briefing-whatsapp-enrichment.spec.ts + BriefingScreen.spec.tsx extensions)
- [x] 21-03-PLAN.md — Wave 2: digest-cron.ts — 05:00 local-model per-group digest cron (getLocalModel, p-queue, seal-guard, INSERT OR REPLACE)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 21-04-PLAN.md — Wave 3: briefing.ts readWhatsAppDigests helper + BRIEFING_TODAY enrichment + WHATSAPP_GENERATE_DIGEST_NOW handler
- [x] 21-05-PLAN.md — Wave 3: BriefingScreen.tsx WhatsApp section render switch + DigestGenerateNowAffordance retry component

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 21-06-PLAN.md — Wave 4: index.ts _digestHandle bootstrap + runChannelOnce real switch + powerMonitor D-07.2 onResume hook

**UI hint**: yes

### Phase 22: Extraction Consumers *(Deferred)*

**Goal**: The stored `whatsapp_message` rows from Phase 20 are fed through three additional extraction passes — action items, meeting proposals, and project-feedback RAG — each routing through the existing `assertApproved` chokepoint and established pipelines. Zero schema additions required.
**Depends on**: Phase 21 (digest quality validated in UAT before extraction consumers are trusted)
**Requirements**: WA-F1, WA-F2, WA-F3
**Success Criteria** (what must be TRUE):

  1. Action items detected in tracked groups appear as `task_batch` approval rows in the Approvals queue, with the source group and message context cited — pushable to Todoist after user approval.
  2. Meeting proposals detected in tracked groups appear as `calendar_change` approval rows for the user to accept or dismiss.
  3. Project-feedback and sentiment content from tracked groups is indexed in the RAG corpus (`source_kind='whatsapp'`) and returns cited answers via the `/ask` interface.

**Plans**: TBD

> **Note on Phase 22 deferral:** This phase is intentionally the last phase of this milestone and is blocked on Phase 21 UAT. The three consumers reuse existing pipelines (`task_batch`, `calendar_change`, `assertApproved`, RAG chunker) with zero schema additions. They are deferred because (a) the digest quality must be validated before extracted items would be trusted, and (b) keeping Phase 20 and 21 clean avoids scope creep that could delay the foundation. A brief research pass on `assertApproved` integration schema for action-item output format is recommended before planning Phase 22.

## Progress (v2.1)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 20. Foundation | 8/8 | Complete   | 2026-06-10 |
| 21. Digest + Briefing Integration | 6/6 | Complete   | 2026-06-10 |
| 22. Extraction Consumers (deferred) | 0/0 | Not started | - |

### Research Flags (v2.1)

- **Phase 20:** No additional research needed. All integration points (Baileys socket, migration 138, IPC patterns, `provider_account` disconnect cascade, `sweep-cron`) verified against live Aria source at HEAD (2026-06-09). Follow SUMMARY.md build order exactly.
- **Phase 21:** Digest prompt text is the highest-uncertainty deliverable. Structure (exec framing: decisions / open questions / @mentions / waiting-on) is locked; actual system/user prompt content needs drafting in the plan phase and iteration in UAT.
- **Phase 22:** Brief research needed on `assertApproved` integration schema for action-item output format and whether the RAG corpus filter needs changes to accept `source_kind='whatsapp'`. Expected low-effort — all pipelines exist.

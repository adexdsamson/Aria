# Phase 17: Voice-Confirm + Writes Through the Gate - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

The user does real chief-of-staff **writes** by voice — triage, schedule, draft, push tasks — and every write is read back with **resolved** entities and explicitly confirmed before the existing `assertApproved` gate runs. Hybrid local/cloud audio is available behind consent; the user controls voice settings. Scope = VOICE-09 (voice drives triage/schedule/draft/ask via the same in-process services), VOICE-11 (mishear recovery / cancel), VOICE-05 (cloud STT/TTS opt-in + sensitivity routing), VOICE-08 (voice settings).

**This is the first write-capable voice phase.** Every voice write routes through the dormant Phase-14 `voiceConfirm(db, approvalId)` → `transitionTo` → `assertApproved` chokepoint — never around it. The Phase-14 HARD GATE still applies (voice blocked from forced-explicit / high-severity → on-screen tap).

Builds on: Phase 14 (`voiceConfirm` seam + HARD GATE), Phase 16 (`VoiceSessionManager`, `streamVoiceAnswer`, `bargeIn()`, read-only loop battle-tested), Phase 3 (sensitivity classifier), Phase 4 (`parseIntent` + tz/propose), Phase 7 (person-resolver).

</domain>

<decisions>
## Implementation Decisions

### Voice Intent Routing & Parsing (SC1 / VOICE-09)
- **D-01 (Parsing = two-stage):** Deterministic keyword/verb pre-filter (schedule/move/draft/ask/task → domain) → per-domain `generateObject` extraction that **reuses** the existing Phase-4 `parseIntent` (schedule branch, untouched) + `DraftSchema` + `ThreadSummarySchema`. Unrecognized input → explicit `unknown` bucket → TTS "I didn't catch that — can you rephrase?" (never silent mis-dispatch). New file `src/main/voice/voice-intent-router.ts`.
- **D-02 (Dispatch = thin-wrapper service extraction):** Each IPC handler calls an exported shared service function that the `VoiceIntentRouter` ALSO calls in-process — never re-crossing the preload bridge (SC1). `draftReply` (`drafting/email.ts`), `proposeCalendarChange` (`scheduling/propose.ts`), and `pushApprovedMeetingActions` (`integrations/todoist/push-actions.ts`) are ALREADY extracted. **Only `ipc/ask.ts` needs extraction** → move its inner logic (routing decision + generate + frontier fallback + routing-log write) to `src/main/rag/ask-service.ts`; both `ipc/ask.ts` and the router import it. Preserve the routing-log + frontier-fallback paths during extraction.
- **D-03 (Router stops at staging):** The intent router ends at "stage an approval row (status `'ready'`) + trigger read-back" — it does NOT execute the write. Writes happen only via `voiceConfirm`→`assertApproved`.

### Read-back + Dual-channel Confirm (SC2)
- **D-04 (Dual-channel = spoken affirmative + visible ApprovalCard):** Aria TTS-reads the resolved entities (mic half-duplex-gated during playback), then re-arms for a short PTT STT turn; a recognized affirmative dispatches `voiceConfirm(db, approvalId)` through the dormant Phase-14 seam (`ready`→`approved`, `approval_path='voice-explicit'`). The on-screen **ApprovalCard is the genuine second channel** (user hears AND sees resolved entities; can tap Approve or speak). New IPC `VOICE_CONFIRM_APPROVAL`.
- **D-05 (Read-back text = template-built, deterministic):** A pure string-builder in main interpolates the **resolved** approval-row fields (`recipients_json`, `after_json`, `subject`; absolute date/time in the user's tz from `scheduling_rules.timeZone`) — per-kind branches (email / calendar / task). NOT LLM-phrased (avoids 200–800 ms latency on the confirm hot path + hallucinating the very entities being verified). "Never the raw transcript" — read back resolved values only.
- **D-06 (Confirm-utterance guard = LLM classifier + re-prompt):** The affirmative STT turn is classified via `generateObject` + Zod `{intent: 'confirm'|'cancel'|'ambiguous'}`. On `ambiguous` (e.g. "yeah no") → re-prompt with a condensed summary + binary prompt, **max 2 re-prompts then auto-cancel**. Never execute on a hedged utterance.
- **D-07 (HARD-GATE forced path = renderer suppresses voice-confirm):** For forced-explicit / high-severity rows, the renderer suppresses the voice-confirm affordance entirely and shows the existing `explicit-required` chip (mirrors the `forceExplicit` boolean already computed in `ApprovalCard`). The user never reaches a `voice-forbidden-forced` runtime error through the intended UX — those rows are on-screen-tap only (Phase-14 gate is the backstop).
- **D-08 (Disambiguation = pre-staging):** When `person-resolver` (Phase 7) returns `kind: 'ambiguous'` (multiple contacts), Aria reads a numbered TTS list and requires selection (spoken number or tap) **before** the approval row is staged — keeps `recipients_json` clean and the read-back unambiguous. No post-staging row mutation.

### Mishear Recovery / Cancel (SC3 / VOICE-11)
- **D-09 (Cancel = PTT-to-cancel + mandatory Cancel button):** Cancel during read-back is PTT-driven (extend Phase-16 `bargeIn()`), with an always-visible Cancel button as the reliable second channel. **No always-on cancel-word listener** — it would self-trigger on the word "cancel" in Aria's own read-back (half-duplex / #47043). Consistent with Phase-16 D-01 PTT-to-interrupt.
- **D-10 (Barge-in in awaiting-confirm aborts the approval):** A barge-in while the session sub-state is `awaiting-confirm` aborts the staged `'ready'` approval (not just stop audio). `useVoiceSession` gets a `pendingApprovalId` ref (set at read-back start, cleared on terminal transition) so `bargeIn()` knows "stop + cancel approval" vs "just stop speaking".
- **D-11 (Cancel terminal state = new `'cancelled'`):** Add a `'cancelled'` status (distinct from `rejected` = deliberate deny, `expired` = timeout) for audit clarity (SC3/VOICE-11 debuggability). Update `src/main/approvals/state.ts` union + transitions (`ready: [...,'cancelled']`); update `assertApproved`, the expiry cron, and any terminal-state enumerations. If the DB enforces a status CHECK constraint, add migration ≥137 (latest is 136).
- **D-12 (After cancel → idle):** Return to idle (PTT-first); "correct" = user re-presses PTT and re-states (a fresh intent turn). Surface a toast / audio cue ("Cancelled — press to try again") so the user knows the staged action is gone.

### Cloud Opt-in + Sensitivity Routing + Settings (SC4 / VOICE-05, SC5 / VOICE-08)
- **D-13 (Cloud scope = cloud STT + non-streaming cloud answer; defer streaming):** Cloud = OpenAI Whisper STT (audio → cloud) + a **non-streaming** cloud LLM answer via the EXISTING buffered `tokenizeForFrontier`/`rehydrate` round-trip, then local Kokoro reads it. `streamVoiceAnswer` stays local-route. Frontier voice **streaming** (the token-boundary-safe `StreamingRehydrator`) is DEFERRED to Phase 18's first task — the "hard mid-stream" PII problem deferred from Phase 16.
- **D-14 (Consent = single master toggle + disclosure):** One "Enable cloud audio processing" toggle with a modal data-handling disclosure stating: what leaves the device (raw audio for STT; answer text for TTS), recipient (OpenAI), retention (30-day standard; ZDR = enterprise), and the override guarantee (sensitivity-flagged turns always local). Recorded in settings KV (`voice.cloudAudio.consented` + `consentedAt`) + an `action_audit_log` row (`action='voice_cloud_consent'`, `approval_path='explicit'`).
- **D-15 (Per-turn sensitivity routing = fail-safe local):** Pre-audio coarse check (regex/`classify` over last-N thread context) gates the AUDIO upload; post-transcript two-stage `classify()` gates the LLM-answer route. If the classifier throws or `confidence < 0.6` → force local. `classify()` never-throws (Stage-3 regex fallback) so fail-closed is structural. **Sensitivity-flagged turns stay on-device REGARDLESS of opt-in.**
- **D-16 (Voice settings = extend `voice/prefs.ts` KV):** Add `voice.speed`, `voice.voiceId`, `voice.useCloud` KV keys + a `VOICE_GET_PREFS`/`VOICE_SET_PREFS` IPC pair (mirror `BG_GET_PREFS`/`BG_SET_PREFS`). Read synchronously at turn start in `voice-session-manager.startAnswer()` so changes are honored **per turn** (SC5). New `VoiceSection.tsx` in Settings (editorial ToggleRow/Checkbox); cloud voice list gated behind consent. `voice.useCloud` is the runtime per-turn gate even when consented. **No `user_prefs` table** (does not exist — settings KV only).

### Write-path Safety (this phase makes voice write-capable)
- **D-17 (Update the read-only ratchet for write-capability):** The Phase-14/16 `tests/static/voice-streaming-no-write.spec.ts` ratchet must be UPDATED: the intent-router / confirm modules now legitimately reach `voiceConfirm` (which itself routes through `assertApproved`), but MUST STILL NOT import the raw write chokepoints (`send.ts` / `write-event.ts` / `push-actions.ts`'s execute paths) directly. Update the allow-list to permit `voiceConfirm` while keeping the direct-write-chokepoint ban. Every voice write provably routes voice → stage → read-back → `voiceConfirm` → `assertApproved`.

### Claude's Discretion
- Exact affirmative/cancel keyword vocab + the LLM confirm-classifier prompt; read-back template phrasing per kind; `VoiceSection.tsx` layout; speed select values (e.g. 0.75/1.0/1.25/1.5); re-prompt copy; the `'cancelled'` migration mechanics; the `unknown`-intent re-prompt wording.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` §"Phase 17: Voice-Confirm + Writes Through the Gate" — goal + 5 success criteria
- `.planning/REQUIREMENTS.md` — VOICE-05, VOICE-08, VOICE-09, VOICE-11 acceptance

### The gate + confirm seam (route writes THROUGH these)
- `src/main/voice/confirm.ts` — `voiceConfirm(db, approvalId)` (DORMANT seam to wire live; stamps `approval_path='voice-explicit'`)
- `src/main/approvals/gate.ts` — `assertApproved` chokepoint + the `voice-forbidden-forced` HARD-GATE branch (D-07 backstop)
- `src/main/approvals/state.ts` — approval status union + transitions map (D-11 adds `'cancelled'`)

### In-process services to dispatch to (SC1 — same fn the IPC handler calls)
- `src/main/drafting/email.ts` `draftReply` · `src/main/scheduling/propose.ts` `proposeCalendarChange` + `src/main/scheduling/intent.ts` `parseIntent` (Phase 4) · `src/main/triage/thread.ts` `summarizeThread` · `src/main/integrations/todoist/push-actions.ts` `pushApprovedMeetingActions` · `src/main/ipc/ask.ts` → extract to `src/main/rag/ask-service.ts` (D-02)
- `src/main/rag/person-resolver.ts` — `kind:'ambiguous'` path (D-08)

### Phase-16 voice substrate (extend)
- `src/main/voice/voice-session-manager.ts` (startAnswer; add awaiting-confirm sub-state, pendingApprovalId, cloud-answer path) · `src/main/rag/answer-service.ts` (`streamVoiceAnswer` local; buffered `ask()` for cloud answer) · `src/renderer/features/voice/useVoiceSession.ts` (`bargeIn()` → cancel-approval)

### Cloud + sensitivity + PII
- `src/main/llm/sensitivityClassifier.ts` `classify()` (never-throws; D-15) · `src/main/llm/tokenize.ts` `tokenizeForFrontier`/`rehydrate` (buffered PII round-trip; D-13) · OpenAI provider (cloud STT/TTS)

### Settings + prefs
- `src/main/voice/prefs.ts` (settings KV — extend; NO user_prefs table) · `src/main/background/prefs.ts` (`BG_GET_PREFS`/`BG_SET_PREFS` pattern to mirror) · `src/renderer/features/settings/BehaviourSection.tsx` + `LearnedPreferencesSection.tsx` (VoiceSection pattern) · `src/renderer/.../ApprovalCard` (`forceExplicit`/`explicit-required` chip — D-07)

### Contracts, ratchet, audit
- `src/shared/ipc-contract.ts` (new channels: VOICE_CONFIRM_APPROVAL, voice-cancel, VOICE_GET_PREFS/SET_PREFS, cloud-consent) · `tests/static/voice-streaming-no-write.spec.ts` (Phase-16 ratchet — UPDATE for write-capability, D-17) · `action_audit_log` (consent audit, D-14)

### External
- OpenAI Whisper STT (25 MB limit; `whisper-1` no native streaming, `gpt-4o-transcribe` streams) · OpenAI TTS (chunk-transfer streaming) · OpenAI data retention (30-day standard; ZDR = enterprise)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `voiceConfirm` (Phase 14): dormant, zero callers — this phase's primary wiring target. Routes through `transitionTo`→`assertApproved`.
- Three of five domain services already extracted (`draftReply`/`proposeCalendarChange`/`pushApprovedMeetingActions`) — only `ask.ts` needs the thin-wrapper extraction (D-02).
- `parseIntent` (Phase 4): queue-serialized, model-lazy, PII-redacting, 2-retry — reuse as the schedule branch; do NOT extend it to other domains.
- `person-resolver` (Phase 7): already returns `kind:'ambiguous'` with candidates (D-08).
- `sensitivityClassifier.classify()` (Phase 3): never-throws (Stage-3 regex fallback) → fail-closed is structural (D-15).
- `voice/prefs.ts` settings-KV (Phase 15): extend for voice settings (D-16). `ApprovalCard.forceExplicit` already computed (D-07).
- Phase-16 `VoiceSessionManager` + `bargeIn()` + half-duplex: extend with awaiting-confirm sub-state + cancel-approval (D-09/D-10).

### Established Patterns
- BG_GET/SET_PREFS IPC pair → mirror for VOICE_GET/SET_PREFS. Push/invoke channel + preload bridge + handler-count invariant (`tests/unit/main/ipc/index.spec.ts`).
- Static-grep ratchets (`tests/static/`) — update voice-streaming-no-write for write-capability (D-17).
- `generateObject` + Zod for intent + confirm classifiers (Phase 3/4 pattern).

### Integration Points
- VoiceIntentRouter (main) → shared service fns → stage `'ready'` approval → read-back (template) → short STT turn → confirm classifier → `voiceConfirm`→`assertApproved` → external write. Cancel (PTT/button) at awaiting-confirm → `ready`→`cancelled`.
- Cloud: per-turn sensitivity gate → cloud STT (OpenAI) + non-streaming cloud answer (buffered PII round-trip) OR forced-local.

</code_context>

<specifics>
## Specific Ideas

- "Never the raw transcript" — read back RESOLVED values (contact email, absolute date/time/tz), not what STT heard.
- The HARD GATE (Phase 14) is the backstop: even if D-07's renderer suppression is bypassed, `assertApproved` throws `voice-forbidden-forced` for forced/high-severity voice paths.
- Fail-safe default everywhere cloud is involved: classifier error / low confidence → local; un-consented → local.
- whisper-1 has no native streaming + a 25 MB upload limit; cloud STT is per-utterance (consistent with the local file-based sidecar).

</specifics>

<deferred>
## Deferred Ideas

- **Frontier voice STREAMING + `StreamingRehydrator`** (token-boundary-safe streaming PII rehydration) → Phase 18 first task. This phase ships non-streaming cloud answers.
- **Always-on cancel-word / hands-free barge-in** → needs cleared wake-word licensing + reliable AEC (Phase 18).
- **Per-provider / dual cloud STT-vs-TTS toggles** → only if a 2nd cloud provider is added; single master toggle this phase.
- **GPU whisper / voice-priority p-queue / idle-unload / captions** → Phase 19.

</deferred>

---

*Phase: 17-voice-confirm-writes-through-the-gate*
*Context gathered: 2026-06-04*

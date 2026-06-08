# Phase 17: Voice-Confirm + Writes Through the Gate — Research

**Researched:** 2026-06-08
**Domain:** Voice intent routing, approval state machine, dual-channel confirm, cloud STT, sensitivity routing, voice settings
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Two-stage voice intent router (keyword pre-filter → per-domain generateObject). New file `src/main/voice/voice-intent-router.ts`.
- D-02: Dispatch via thin-wrapper service extraction. Only `ipc/ask.ts` needs extraction → `src/main/rag/ask-service.ts`. Three services already extracted.
- D-03: Router stops at staging a `'ready'` approval + trigger read-back. Writes only via `voiceConfirm`→`assertApproved`.
- D-04: Dual-channel = TTS read-back + visible ApprovalCard + short PTT STT turn → `voiceConfirm(db, approvalId)`. New IPC `VOICE_CONFIRM_APPROVAL`.
- D-05: Template read-back from resolved approval-row fields (deterministic string builder, not LLM). Per-kind branches.
- D-06: Confirm-utterance guard = `generateObject` + Zod `{intent: 'confirm'|'cancel'|'ambiguous'}`. On `ambiguous` → re-prompt max 2 then auto-cancel.
- D-07: HARD-GATE forced rows: renderer suppresses voice-confirm affordance. `forceExplicit` boolean already computed in `ApprovalCard`.
- D-08: Disambiguation pre-staging — person-resolver `kind:'ambiguous'` before approval row staged.
- D-09: Cancel = PTT-to-cancel + always-visible Cancel button. No always-on cancel-word.
- D-10: Barge-in while `awaiting-confirm` aborts the staged `'ready'` approval. `pendingApprovalId` ref in `useVoiceSession`.
- D-11: New `'cancelled'` approval terminal state. Add to `state.ts` union + transitions. Migration ≥137 required (CHECK constraint exists). Update `assertApproved`, expiry cron, all terminal-state enumerations.
- D-12: After cancel → idle. Toast + audio cue "Cancelled — press to try again".
- D-13: Cloud = OpenAI Whisper STT + non-streaming cloud answer (buffered `tokenizeForFrontier`/`rehydrate`). Frontier STREAMING deferred to Phase 18.
- D-14: Single consent toggle + modal disclosure. Recorded in settings KV + `action_audit_log`.
- D-15: Per-turn sensitivity routing — pre-audio coarse check + post-transcript two-stage `classify()`. Fail-safe local (`confidence < 0.6` → local).
- D-16: Voice settings = extend `voice/prefs.ts` KV. Add `voice.speed`, `voice.voiceId`, `voice.useCloud`. `VOICE_GET_PREFS`/`VOICE_SET_PREFS` IPC pair.
- D-17: Update `tests/static/voice-streaming-no-write.spec.ts` to allow `voiceConfirm` imports while keeping raw write-chokepoint ban.

### Claude's Discretion
Exact affirmative/cancel keyword vocab + the LLM confirm-classifier prompt; read-back template phrasing per kind; `VoiceSection.tsx` layout; speed select values (e.g. 0.75/1.0/1.25/1.5); re-prompt copy; the `'cancelled'` migration mechanics; the `unknown`-intent re-prompt wording.

### Deferred Ideas (OUT OF SCOPE)
- Frontier voice STREAMING + `StreamingRehydrator` → Phase 18.
- Always-on cancel-word / hands-free barge-in → Phase 18.
- Per-provider / dual cloud STT-vs-TTS toggles → only if 2nd cloud provider added.
- GPU whisper / voice-priority p-queue / idle-unload / captions → Phase 19.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VOICE-05 | Cloud STT/TTS opt-in with explicit consent gate; sensitivity-flagged turns stay on-device | D-13/D-14/D-15 — `experimental_transcribe` API verified; consent KV pattern confirmed |
| VOICE-08 | Voice preferences (voice, speed, local vs cloud) in Settings | D-16 — `voice/prefs.ts` KV pattern confirmed; `BG_GET/SET_PREFS` mirror verified |
| VOICE-09 | Voice-driven triage/scheduling/ask/drafting via same in-process services as IPC handlers | D-01/D-02 — all four service signatures confirmed; ask.ts extraction scope mapped |
| VOICE-11 | Mishear recovery: cancel or correct a mis-recognized command before it acts | D-09/D-10/D-11 — `bargeIn()` extension + new `'cancelled'` state + migration requirement confirmed |
</phase_requirements>

---

## Summary

Phase 17 is the first phase that makes voice write-capable. The research confirms all 17 locked decisions are implementable against the actual codebase, and identifies several concrete integration points that the planner must handle precisely.

The most important findings are: (1) the `approval.state` CHECK constraint in migration 134 (`voice_explicit_path.sql`) does NOT include `'cancelled'` — migration 137 is mandatory, not optional, and must use the `PRAGMA legacy_alter_table=ON` / table-rebuild pattern from migration 134; (2) `experimental_transcribe` from `ai@6` is available and `openai.transcription('whisper-1')` is confirmed in the installed `@ai-sdk/openai@3.0.64`; (3) the `ask.ts` extraction to `ask-service.ts` is a full code-level extraction with a specific inner logic boundary (routing decision + generate + frontier fallback + routing-log write); (4) the `voice-streaming-no-write.spec.ts` ratchet currently bans `voiceConfirm` from all voice modules — it must be updated to allow the new intent-router and confirm modules to import it while keeping the raw write-chokepoint ban intact; (5) the IPC handler-count invariant uses `Object.keys(CHANNELS).length` dynamically, so adding N new CHANNELS entries requires exactly N new handlers registered in `registerHandlers`.

**Primary recommendation:** Plan in this order — (1) migration 137 (`'cancelled'` state), (2) `state.ts` + `assertApproved` + consumer updates, (3) `ask-service.ts` extraction (d-02), (4) `voice-intent-router.ts` (D-01), (5) approval staging + read-back template (D-03/D-05), (6) `voiceConfirm` wiring + IPC channels (D-04), (7) cancel / barge-in extension (D-09/D-10/D-11), (8) cloud STT + sensitivity routing (D-13/D-15), (9) voice prefs IPC (D-16), (10) update ratchet (D-17).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Intent parsing (keyword pre-filter + generateObject) | API / Main process | — | CPU-bound LLM call; never crosses preload bridge (SC1 = same-in-process) |
| Approval row staging (state='ready') | API / Main process | — | SQLite write; must be in main, not renderer |
| Read-back text builder (template strings) | API / Main process | — | Reads approval row fields from SQLite; deterministic string-only |
| Dual-channel confirm (ApprovalCard visible) | Frontend / Renderer | — | UI concern; reads approval row via existing APPROVALS_LIST IPC |
| `voiceConfirm` call (ready→approved) | API / Main process | — | Must run through `transitionTo` in main; renderer invokes via VOICE_CONFIRM_APPROVAL IPC |
| Cloud STT (Whisper) | API / Main process | — | Audio bytes never go through renderer on cloud path; sensitivity gate in main |
| Sensitivity routing per-turn | API / Main process | — | `classify()` in main; never in renderer |
| Voice prefs read/write | API / Main process | — | settings KV in SQLite; renderer reads via VOICE_GET/SET_PREFS IPC |
| Confirm-utterance classifier | API / Main process | — | `generateObject` + Zod; same-process as router |
| Person disambiguation | API / Main process | — | `person-resolver.ts` reads SQLite; pre-staging |
| Cancel affordance (PTT + button) | Frontend / Renderer | API / Main process | Renderer fires IPC; main transitions approval to 'cancelled' |

---

## Standard Stack

### Core (phase-specific additions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` (Vercel AI SDK) | 6.0.x (installed) | `generateObject` for intent + confirm classifiers | Already used for sensitivity classifier, scheduling intent, drafting — established pattern |
| `ai` `experimental_transcribe` | 6.0.x (installed) | Cloud STT via OpenAI Whisper | Available in installed version — `experimental_transcribe` exported from `ai@6` |
| `@ai-sdk/openai` | 3.0.64 (installed) | `openai.transcription('whisper-1')` provider | `openai.transcription()` method confirmed available in installed version |
| `zod` | (installed) | Confirm-classifier schema `{intent: 'confirm'|'cancel'|'ambiguous'}` | Established pattern for generateObject throughout codebase |
| `better-sqlite3-multiple-ciphers` | 11.x (installed) | migration 137, approval state transitions | Established project DB layer |

### Supporting (existing, referenced by this phase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `p-queue` | 8.x (installed) | Serialize LLM calls for confirm classifier + intent router | Match existing pattern in `sensitivityClassifier.ts` and `intent.ts` |
| `pino` | 9.x (installed) | Logging | Standard project logging |

### No New Dependencies
This phase adds zero new npm packages. `experimental_transcribe` and `openai.transcription` are already in the installed versions. [VERIFIED: node_modules inspection]

---

## Architecture Patterns

### System Architecture Diagram

```
PTT press (renderer)
  │
  ▼
[STT sidecar or cloud Whisper] ──sensitivity gate──► local-only if flagged
  │ transcript
  ▼
VoiceIntentRouter.route(transcript)
  ├── keyword pre-filter → domain: schedule/draft/ask/task/unknown
  └── per-domain generateObject extraction
        │
        ├── schedule → parseIntent + proposeCalendarChange → insert approval(ready)
        ├── draft    → draftReply → insert approval(ready)
        ├── ask      → askService.ask() → stream answer (no approval)
        ├── task     → (meeting note ctx) → insert approval(ready)
        └── unknown  → TTS "I didn't catch that"
              │
              ▼ (write-capable domains only)
        person-resolver disambiguation (if ambiguous → TTS list + selection)
              │
              ▼
        Stage approval row (state='ready')
              │
              ▼
        Read-back template builder
          - email_send: "Draft to {recipients}, subject {subject}. Confirm?"
          - calendar_change: "Move {eventRef} to {date/time} in {tz}. Confirm?"
          - task_batch: "Push {N} tasks to Todoist. Confirm?"
              │
              ▼ TTS playback (micGated=true, half-duplex)
              │
              ▼ re-arm short PTT STT turn (awaiting-confirm sub-state)
              │
  ┌───────────────────────────────────┐
  │   Confirm classifier              │
  │   generateObject({intent:         │
  │     'confirm'|'cancel'|'ambiguous'│
  │   })                              │
  └───────────────────────────────────┘
        │
        ├── confirm  → voiceConfirm(db, approvalId) → ready→approved
        │              assertApproved → external write (email/calendar/Todoist)
        ├── cancel   → transitionTo(ready→cancelled) → idle + toast
        └── ambiguous → re-prompt (max 2) → auto-cancel on limit
              │
              ▼
  [visible ApprovalCard is always on-screen during awaiting-confirm]
  [user can also tap Approve or Cancel button]

Cloud path (if consented + not sensitivity-flagged):
  PCM audio → OpenAI Whisper (experimental_transcribe) → transcript
  Cloud answer: ask() with buffered tokenizeForFrontier/rehydrate (non-streaming)
```

### Recommended Project Structure (new files this phase)
```
src/main/voice/
├── voice-intent-router.ts          # D-01: keyword pre-filter + per-domain extraction
src/main/rag/
├── ask-service.ts                  # D-02: extracted from ipc/ask.ts inner logic
src/main/voice/
├── cloud-stt.ts                    # D-13: experimental_transcribe wrapper
└── voice-prefs-extended.ts         # D-16: voice.speed/voiceId/useCloud KV helpers
                                    # (or extend voice/prefs.ts directly)
src/main/db/migrations/
├── 137_approval_cancelled_state.sql # D-11: adds 'cancelled' to state CHECK
src/renderer/features/voice/
├── useVoiceConfirm.ts              # D-04/D-10: pendingApprovalId + confirm IPC
src/renderer/features/settings/
└── VoiceSection.tsx                # D-16: voice settings UI
```

### Pattern 1: ask.ts Extraction to ask-service.ts (D-02)

The planner must understand exactly what to extract. `ipc/ask.ts` has two layers:
1. The **IPC scaffolding** (handler registration, DI struct, `classifyFrontierError`) — stays in `ipc/ask.ts`
2. The **inner logic** — moves to `ask-service.ts`

**What moves to `ask-service.ts`:**
```typescript
// Source: src/main/ipc/ask.ts (verified 2026-06-08)
// Extract these four behaviors into a standalone askService(deps).ask(req) function:
//   1. router.classify({ prompt, source }) → RoutingDecision
//   2. LOCAL path: localModelFactory() → gen({model, prompt}) → result.text
//   3. FRONTIER path with LOCAL fallback: frontierModelFactory(provider) → gen → fallback
//   4. writeLog(entry) with routing-log write (writeRoutingLog + hashPrompt)
//
// The extracted function signature:
export interface AskServiceDeps {
  logger: Logger;
  router: LLMRouter;
  localModelFactory: typeof getLocalModel;
  frontierModelFactory: typeof getFrontierModel;
  gen: typeof generateText;
  dbGetter: () => Database | null;   // lazy db accessor (not db directly)
}

export async function performAsk(
  deps: AskServiceDeps,
  payload: AskRequest,
): Promise<AskResponse | IpcError>
```

The `ipc/ask.ts` handler then becomes a thin wrapper: construct deps from DI, call `performAsk(deps, req)`. The `VoiceIntentRouter` calls `performAsk` in-process directly for the ask domain — never re-crossing the preload bridge (SC1).

**Preservation requirement:** The existing `ask.spec.ts` tests must continue to pass unmodified. The extraction must preserve the routing-log write path (both LOCAL and FRONTIER cases), the frontier fallback path, and the `classifyFrontierError` helper.

### Pattern 2: `'cancelled'` State — Migration Required (D-11) [CRITICAL]

**VERIFIED finding: migration 137 is mandatory.** [VERIFIED: read migration 134]

The `approval.state` column has a CHECK constraint defined in migration `134_voice_explicit_path.sql`:
```sql
state TEXT NOT NULL CHECK (state IN (
  'pending','generating','ready','approved','rejected','snoozed','interrupted','sent',
  'sending','failed','needs-operator-decision'
))
```

`'cancelled'` is not in this list. Any `transitionTo(db, id, 'cancelled')` call will throw a SQLite constraint violation at runtime unless migration 137 rebuilds the table.

**Migration 137 MUST use the `PRAGMA legacy_alter_table=ON` + table-rebuild pattern** (same as migration 134), because SQLite does not support `ALTER TABLE ... MODIFY COLUMN`. The migration also needs `PRAGMA foreign_keys=OFF` / `PRAGMA foreign_keys=ON` around the rebuild to avoid FK constraint errors while the old table exists during INSERT.

**State machine update in `state.ts`:**
```typescript
// Add 'cancelled' to ApprovalState union
// Add transition: ready: ['approved', 'rejected', 'snoozed', 'cancelled']
// 'cancelled' is a terminal state: cancelled: []
```

**Consumers that enumerate terminal states or ALL approval states:**

| File | What to update |
|------|----------------|
| `src/main/approvals/state.ts` | Add `'cancelled'` to `ApprovalState` union + `ALLOWED` map + `APPROVAL_STATES` array |
| `src/main/approvals/gate.ts` | `assertApproved`: `state !== 'approved'` path already covers cancelled (throws `not-approved`) — no change needed, but confirm |
| `src/main/ipc/approvals.ts` | `DEFAULT_LIST_STATES` array (line 38–48) — optionally add `'cancelled'` for the approval list UI |
| `src/renderer/features/approvals/ApprovalCard.tsx` | `isTerminal` check (line 241) — optionally add `'cancelled'` |
| `src/main/db/migrations/embedded.ts` | Must be updated to match migration 137 CHECK constraint — the embedded migration suite is the canonical new-install DDL |
| `src/main/approvals/persist.ts` | `ApprovalRow` type — no change (state is typed as `ApprovalState` which will be updated) |

**There is no expiry cron for `ready` approvals** — verified by searching the codebase. The snooze→ready transition is done manually via `APPROVALS_SNOOZE`. So the only consumer of terminal-state enumeration that could be affected by `'cancelled'` is the `DEFAULT_LIST_STATES` in `ipc/approvals.ts` and the `isTerminal` check in `ApprovalCard.tsx`. [VERIFIED: grep search found no sweep/expiry cron for approval state]

### Pattern 3: voiceConfirm Wiring (D-04)

`voiceConfirm(db, approvalId)` is dormant with zero callers. It calls:
```typescript
// src/main/voice/confirm.ts (verified 2026-06-08)
export function voiceConfirm(db: Db, approvalId: string): void {
  transitionTo(db, approvalId, 'approved', { approval_path: 'voice-explicit' });
}
```

This is the `ready→approved` edge. After `voiceConfirm` runs, the caller must dispatch the external write the same way `ipc/approvals.ts` does after its `transitionTo(db, r.id, 'approved', patch)`:
- `email_send`: emit `GMAIL_SEND_APPROVED` to the renderer, OR call `sendApprovedEmail` in-process
- `calendar_change`: call `applyCalendarChange(db, approvalId, deps)` in-process
- `task_batch`: call `pushApprovedMeetingActions` in-process

**The new `VOICE_CONFIRM_APPROVAL` IPC handler** in `ipc/voice.ts` must mirror the approval dispatch logic from `ipc/approvals.ts:199–271`. The handler receives `{ approvalId }`, calls `voiceConfirm(db, approvalId)`, then reads the row kind and dispatches accordingly. This is the same orchestration that the approve IPC handler already does — it just originates from voice.

### Pattern 4: Cloud STT via `experimental_transcribe` (D-13)

```typescript
// Verified: experimental_transcribe exported from ai@6 installed version
// Verified: openai.transcription() method exists in @ai-sdk/openai@3.0.64
import { experimental_transcribe as transcribe } from 'ai';
import { openai } from '@ai-sdk/openai';

// Called from cloud-stt.ts, invoked from voice-session-manager when
// useCloud=true AND sensitivity gate passes
const result = await transcribe({
  model: openai.transcription('whisper-1'),
  audio: wavBuffer,             // Uint8Array | ArrayBuffer | Buffer
  abortSignal: signal,
});
const transcript: string = result.text;
```

**Audio format:** The local sidecar uses WAV. The OpenAI Whisper API accepts WAV, MP3, FLAC, MP4, MPEG, MPGA, M4A, OGG, OGA, WEBM. The existing PCM→WAV pipeline from the STT sidecar path can be reused — send the WAV buffer directly to `experimental_transcribe`. [CITED: ai-sdk.dev/docs/ai-sdk-core/transcription]

**25 MB limit:** Whisper-1 has a 25 MB upload limit per request. For PTT utterances (typically 1–30 seconds at 16kHz PCM→WAV), a 30-second utterance is ~960 KB — well within limit. [ASSUMED: based on OpenAI documentation; verified format/limit from OpenAI docs]

**No native streaming:** `whisper-1` does not stream; `experimental_transcribe` returns the full transcript synchronously after completion. This is consistent with the local sidecar's per-utterance model. `gpt-4o-transcribe` streams but is deferred. [CITED: ai-sdk.dev/docs/ai-sdk-core/transcription]

**No raw `openai` package needed:** `@ai-sdk/openai` is sufficient. Do NOT add `openai` npm package. [VERIFIED: node_modules inspection]

### Pattern 5: Voice Settings KV Extension (D-16)

Mirror the `BG_GET_PREFS` / `BG_SET_PREFS` IPC pair from `src/main/ipc/index.ts`. The extension adds new KV keys in the existing `settings` table — no migration needed.

```typescript
// Extend voice/prefs.ts (or add voice-prefs-extended.ts):
type VoicePrefKeyExtended =
  | 'modelReady' | 'modelPath' | 'modelState'  // existing Phase-15 keys
  | 'speed'                                       // NEW: '0.75'|'1.0'|'1.25'|'1.5'
  | 'voiceId'                                     // NEW: Kokoro voice name string
  | 'useCloud'                                    // NEW: '1'|'0'
  | 'cloudAudio.consented'                        // NEW: '1'|'0' (D-14)
  | 'cloudAudio.consentedAt';                     // NEW: ISO timestamp

export interface VoicePrefs {
  speed: number;                    // default: 1.0
  voiceId: string;                  // default: '' (use Kokoro default)
  useCloud: boolean;                // default: false
}

// IPC pattern: VOICE_GET_PREFS → returns VoicePrefs
// VOICE_SET_PREFS(payload: Partial<VoicePrefs>) → writes individual keys
```

**Key constraint:** `voice.useCloud` is read at turn-start in `voice-session-manager.startAnswer()` — synchronously (the existing `readStr(db, key)` in `voice/prefs.ts` is synchronous). The per-turn read is correct behavior for SC5.

### Pattern 6: D-17 Ratchet Update

The current ratchet in `tests/static/voice-streaming-no-write.spec.ts` bans these identifiers from ALL files under `src/main/voice/**` and `src/renderer/features/voice/**`:

```typescript
const WRITE_CHOKEPOINTS = [
  'sendApprovedEmail',
  'applyCalendarChange',
  'pushApprovedMeetingActions',
  'assertApproved',
  'voiceConfirm',           // ← currently banned from voice modules
] as const;
```

Phase 17 requires `voiceConfirm` to be called from `src/main/ipc/voice.ts` (the new `VOICE_CONFIRM_APPROVAL` handler). However, the ratchet scans `src/main/voice/**` and `src/renderer/features/voice/**` — NOT `src/main/ipc/**`. The `VOICE_CONFIRM_APPROVAL` handler lives in `ipc/voice.ts` which is outside the scanned directories.

**The minimal change:** Remove `'voiceConfirm'` from `WRITE_CHOKEPOINTS` in the ratchet. The `voice-intent-router.ts` does NOT call `voiceConfirm` directly — it only stages approvals. The actual `voiceConfirm` call happens in `ipc/voice.ts` which is outside the ratchet's scan scope.

**Alternate approach (stronger):** Add a new ratchet entry for `src/main/voice/voice-intent-router.ts` asserting it never imports write chokepoints, and update the existing ratchet to keep `voiceConfirm` banned from `src/main/voice/**` but add `ipc/voice.ts` to a new explicit-allow-list. This mirrors the existing `confirm.ts` exclusion.

**Recommended:** Remove `voiceConfirm` from `WRITE_CHOKEPOINTS` and update the test description to say "Phase 17: router stages only — voiceConfirm allowed in ipc/ but not voice/ modules" with a comment explaining the boundary. The raw write chokepoints (`sendApprovedEmail`, `applyCalendarChange`, `pushApprovedMeetingActions`, `assertApproved`) REMAIN banned from voice modules. [VERIFIED: read current ratchet file]

### Pattern 7: Confirm STT Turn Half-Duplex Sequencing (D-04/D-09)

The confirm STT turn happens AFTER read-back TTS finishes. The sequence is:

1. TTS read-back starts → `useVoiceSession.onPlaybackStart()` → `voiceState='speaking'`, `micGated=true`
2. TTS finishes → `useVoiceSession.onPlaybackEnd()` → cooldown 800ms → `voiceState='idle'`, `micGated=false`
3. Renderer sets `pendingApprovalId` ref BEFORE step 1 (set at read-back dispatch)
4. After cooldown completes, renderer re-arms PTT for the confirm turn
5. User presses PTT → `startTurn()` → `voiceState='listening'` — this is the confirm STT turn
6. STT result → confirm classifier → `voiceConfirm` or `transitionTo(cancelled)`

**Sub-state `awaiting-confirm`:** The renderer needs a new sub-state alongside `voiceState` to distinguish a confirm turn from a normal answer turn. Simplest approach: a `pendingApprovalId: string | null` ref in `useVoiceSession` (D-10). When non-null, the transcript goes to the confirm classifier instead of `VOICE_FEED_ANSWER`.

**Barge-in during read-back (D-10):** If the user presses PTT during read-back (barge-in), `bargeIn()` must also cancel the pending approval: check `pendingApprovalId`, call `voice-cancel-approval` IPC with that ID, clear `pendingApprovalId`.

### Anti-Patterns to Avoid

- **Staging a `'ready'` row without checking person-resolver first:** The disambiguate-then-stage order is mandatory. If `recipients_json` contains an ambiguous name, the read-back will say the wrong recipient. Always run `resolvePersonMentions` (or the schedule equivalent) before `insertApproval`.
- **Calling `voiceConfirm` from inside `src/main/voice/voice-intent-router.ts`:** The router's job ends at `insertApproval` + read-back trigger. `voiceConfirm` must be called from the IPC confirm handler in `ipc/voice.ts`, not the router.
- **Reusing the same `approvalId` across re-prompts:** On `ambiguous` confirm utterance → re-prompt cycle, the same approval row stays in `'ready'` state. Do NOT create a new approval row on re-prompt.
- **Using `'rejected'` for cancellation:** `'rejected'` means deliberate deny by the user in the approval UI. `'cancelled'` is the voice-path abort. Keep these distinct for audit clarity.
- **Patching `approval_path` on cancel:** The cancel transition goes `ready→cancelled` with no `approval_path` patch. The row was staged as `'explicit'` (the default) — that stays unchanged.
- **Using `generateText` for the confirm utterance classifier:** Use `generateObject` + Zod schema `{intent: z.enum(['confirm','cancel','ambiguous'])}` — same pattern as sensitivity classifier. `generateText` returns free-form text; `generateObject` gives a typed, retryable structured result.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cloud STT | Custom HTTP client to OpenAI audio endpoint | `experimental_transcribe` from `ai@6` + `openai.transcription('whisper-1')` | Already installed; handles auth, retries, audio format negotiation |
| Confirm intent classification | Regex affirmative-word list | `generateObject` + Zod `{intent: 'confirm'|'cancel'|'ambiguous'}` | Handles "yeah no", hedged confirmations, language variation; matches Phase-3/4 pattern |
| PII round-trip for cloud answers | Custom token substitution | `tokenizeForFrontier`/`rehydrate` in `src/main/llm/tokenize.ts` (+ `disposeRedactionRoundtrip` in `redaction-roundtrip.ts`) | Already implemented with counter-isolation and `disposeDraftTable` cleanup |
| Approval row staging | Raw `INSERT` SQL | `insertApproval(db, input)` from `persist.ts` | Handles UUID generation, idempotency key, null defaults, transaction wrapper |
| Read-back tz-formatting | `Intl.DateTimeFormat` hand-rolled | `Intl.DateTimeFormat(tz).format(new Date(iso))` — read `scheduling_rules.timeZone` via `loadActiveRules(db)` | Avoids date-math bugs; uses the same tz the user configured in scheduling rules |

**Key insight:** Every write-path primitive already exists in the codebase. This phase's job is wiring them into the voice path, not re-implementing them.

---

## Runtime State Inventory

Not applicable — this is a greenfield feature addition. No renames, no migrations of existing data.

---

## Common Pitfalls

### Pitfall 1: Migration 137 Missing or Using Wrong Pattern
**What goes wrong:** `transitionTo(db, id, 'cancelled')` throws `SQLITE_CONSTRAINT: CHECK constraint failed: approval` at runtime. Silent failure if try/catch swallows it — the approval stays stuck in `'ready'`.
**Why it happens:** migration 134 has a hard CHECK constraint on `state`. SQLite CHECK constraints cannot be extended with ALTER TABLE. The table must be rebuilt.
**How to avoid:** Write migration 137 FIRST (Wave 0). Use the `PRAGMA legacy_alter_table=ON` + `BEGIN` / rebuild / `DROP` / `COMMIT` / `PRAGMA legacy_alter_table=OFF` pattern verbatim from migration 134.
**Warning signs:** Test for `assertTransition('ready', 'cancelled')` throws with `invalid-transition:ready->cancelled` (from `state.ts` ALLOWED map — means state.ts was not updated); or SQLite throws on the `UPDATE`.

### Pitfall 2: ask-service.ts Extraction Breaks ask.spec.ts
**What goes wrong:** Moving inner logic from `ask.ts` breaks the existing test harness which mocks `deps.router`, `deps.getLocalModelFn`, `deps.getFrontierModelFn`, `deps.generateTextFn`.
**Why it happens:** The extracted function has a different DI boundary than the current handler.
**How to avoid:** Preserve the exact same DI injection surface — the extracted `performAsk` function must accept the same injectable dependencies as the current handler body uses. The `ipc/ask.ts` handler becomes a thin adapter that constructs these deps and calls `performAsk`. Re-run `ask.spec.ts` after extraction with zero changes to the test file.
**Warning signs:** Test imports fail or `classifyFrontierError` is not accessible.

### Pitfall 3: voiceConfirm Called Before `'cancelled'` Migration Lands
**What goes wrong:** `transitionTo(db, id, 'cancelled')` in the cancel path throws at runtime if Wave 0 didn't add migration 137 before the feature code.
**How to avoid:** Migration 137 MUST land in Wave 0. The state.ts update MUST land in the same wave. These two are coupled.

### Pitfall 4: Confirm STT Turn Sends to Wrong Handler
**What goes wrong:** The confirm STT turn transcript goes to `VOICE_FEED_ANSWER` (the normal answer path) instead of the confirm classifier, causing the intent to be treated as a new question rather than a yes/no confirm.
**Why it happens:** The renderer has no distinction between a confirm turn and a normal turn unless `pendingApprovalId` is checked before dispatching.
**How to avoid:** The renderer must check `pendingApprovalId !== null` before dispatching the final transcript. If set, send to `VOICE_CONFIRM_APPROVAL` with the transcript for classification. If not set, send to `VOICE_FEED_ANSWER` as normal.

### Pitfall 5: Read-Back Template Uses Raw Transcript
**What goes wrong:** Aria says "Send email to John Smith" when the actual resolved recipient is `john.smith@corp.com` (or worse, an ambiguous name that resolved to the wrong person).
**Why it happens:** Template builder reads from `recipients_json` field that was never populated correctly, or reads the STT transcript instead of the approval row.
**How to avoid:** The template builder MUST read ONLY from the persisted `ApprovalRow` fields (via `getApproval(db, approvalId)` after `insertApproval`). The row fields contain resolved values — `recipients_json` is a JSON array of email addresses.

### Pitfall 6: Cloud Answer Uses Streaming Path
**What goes wrong:** The cloud answer path tries to use `streamVoiceAnswer` (the Phase 16 streaming function) with a frontier model, leaking PII tokens into the stream.
**Why it happens:** `streamVoiceAnswer` is LOCAL-route only (the comment at line 518 in `answer-service.ts` says exactly this).
**How to avoid:** For cloud answers, use `ask()` from `AnswerService` (the non-streaming path that has the full `tokenizeForFrontier`/`rehydrate` round-trip). The existing `createAnswerService` already handles the FRONTIER path correctly. Phase 16 comment at line 561 explicitly says "LOCAL route only (Pitfall 8 — PII frontier streaming deferred to Phase 17)".

### Pitfall 7: Handler Count Invariant Fails
**What goes wrong:** `tests/unit/main/ipc/index.spec.ts` fails with `handlers.size` ≠ `Object.keys(CHANNELS).length`.
**Why it happens:** New CHANNELS entries added without corresponding handlers.
**How to avoid:** For every new CHANNELS entry, register exactly one handler in `registerVoiceHandlers` (or the appropriate register function). The test uses `Object.keys(CHANNELS).length` dynamically — no hardcoded count to update.

### Pitfall 8: `approval_path` Defaulting to `'explicit'` on Voiced Rows
**What goes wrong:** A voice-staged row has `approval_path='explicit'` instead of letting `voiceConfirm` stamp `'voice-explicit'`, causing the gate to pass forced rows through voice path.
**Why it happens:** `insertApproval` defaults `approval_path: 'explicit'`. The voice router should NOT override this at insert time — the path is stamped by `voiceConfirm` during the confirm transition.
**How to avoid:** Do NOT pass `approval_path: 'voice-explicit'` to `insertApproval` at staging time. Leave it at the `'explicit'` default. `voiceConfirm` stamps `'voice-explicit'` via `transitionTo(db, id, 'approved', { approval_path: 'voice-explicit' })`.

---

## Code Examples

### D-02: Extracted ask-service.ts Public Interface

```typescript
// Source: inferred from src/main/ipc/ask.ts (verified 2026-06-08)
// What to move into src/main/rag/ask-service.ts:

export interface AskServiceDeps {
  router: LLMRouter;
  localModelFactory: () => ModelLike;
  frontierModelFactory: (provider: ProviderId) => Promise<ModelLike>;
  gen: typeof generateText;
  writeLog: (entry: Omit<RoutingLogInput, 'prompt_hash'>) => void;
}

export async function performAsk(
  deps: AskServiceDeps,
  prompt: string,
  source: string | undefined,
  startedAt: number,
): Promise<{ answer: string; route: Route; reason: string; latency_ms: number } | { error: string }>
```

### D-11: state.ts with 'cancelled'

```typescript
// Source: src/main/approvals/state.ts extended per D-11
export type ApprovalState =
  | 'pending' | 'generating' | 'ready' | 'approved'
  | 'rejected' | 'snoozed' | 'interrupted' | 'sent'
  | 'sending' | 'failed' | 'needs-operator-decision'
  | 'cancelled';  // NEW: voice-path abort (distinct from rejected)

const ALLOWED: Record<ApprovalState, readonly ApprovalState[]> = {
  // ... existing entries ...
  ready: ['approved', 'rejected', 'snoozed', 'cancelled'],  // UPDATED
  cancelled: [],  // NEW terminal state
};
```

### D-13: Cloud STT Call

```typescript
// Source: verified against node_modules/@ai-sdk/openai@3.0.64 and ai@6 exports
import { experimental_transcribe as transcribe } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function cloudTranscribe(
  audioBuffer: Buffer,
  signal: AbortSignal,
): Promise<string> {
  const result = await transcribe({
    model: openai.transcription('whisper-1'),
    audio: audioBuffer,
    abortSignal: signal,
  });
  return result.text;
}
```

### D-05: Read-Back Template (email_send kind)

```typescript
// Source: derived from ApprovalRow fields in src/main/approvals/persist.ts
function buildReadBackText(row: ApprovalRow, tz: string): string {
  if (row.kind === 'email_send') {
    const recipients: string[] = row.recipients_json
      ? JSON.parse(row.recipients_json)
      : [];
    return `Draft to ${recipients.join(', ')}, subject "${row.subject ?? '(no subject)'}". Say yes to send, or cancel.`;
  }
  if (row.kind === 'calendar_change') {
    const after = row.after_json ? JSON.parse(row.after_json) : null;
    const dateStr = after?.startIso
      ? new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          weekday: 'short', month: 'short', day: 'numeric',
          hour: 'numeric', minute: '2-digit',
        }).format(new Date(after.startIso))
      : '(unknown time)';
    return `Move event to ${dateStr}. Say yes to confirm, or cancel.`;
  }
  if (row.kind === 'task_batch') {
    return `Push tasks to Todoist. Say yes to confirm, or cancel.`;
  }
  return 'Action ready. Say yes to confirm, or cancel.';
}
```

### D-15: Per-Turn Sensitivity Gate

```typescript
// Source: src/main/llm/sensitivityClassifier.ts (verified 2026-06-08)
// classify() signature: async function classify(text, queue, opts?) => Promise<SensitivityResult>
// SensitivityResult: { categories, severity, confidence, rationale }
// Never throws (Stage-3 regex fallback)

async function shouldUseCloud(
  context: string,
  queue: PQueue,
): Promise<boolean> {
  // Pre-audio coarse check on last-N thread context
  const result = await classify(context, queue);
  // Fail-safe: if classifier uncertain OR sensitivity detected, force local
  if (result.confidence < 0.6) return false;
  if (result.categories.some(c => c !== 'none')) return false;
  return true; // safe for cloud
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `experimental_transcribe` was unavailable in AI SDK 5 | `experimental_transcribe` + `openai.transcription()` available in AI SDK 6 + @ai-sdk/openai 3 | Installed versions confirmed | No new deps needed; use directly |
| Voice modules were pure read-only | Voice modules may call `voiceConfirm` via IPC | Phase 17 | Ratchet update required |

**Deprecated/outdated:**
- `streamVoiceAnswer` LOCAL-only constraint: was a Phase 16 intentional deferral for PII streaming. The FRONTIER streaming path (StreamingRehydrator) remains deferred to Phase 18.

---

## Open Questions (RESOLVED)

> All three are Claude's-discretion items per CONTEXT.md with inline recommendations below; no blocking architectural unknowns remain.

1. **Confirm classifier prompt quality**
   - What we know: `generateObject` + Zod `{intent: 'confirm'|'cancel'|'ambiguous'}` is the pattern
   - What's unclear: Exact prompt wording — especially distinguishing "yeah no" (ambiguous) from "no" (cancel)
   - Recommendation: Start with a simple binary system prompt ("The user was asked to confirm or cancel an action. Classify their response as confirm, cancel, or ambiguous if unclear.") and iterate. This is Claude's Discretion per CONTEXT.md.

2. **Speed of confirm turn with cloud STT**
   - What we know: cloud STT adds ~500–2000ms latency vs local
   - What's unclear: Whether per-turn sensitivity toggle should force local for the confirm turn even when cloud STT is enabled (confirm utterance = "yes/no" = low sensitivity, so cloud is fine)
   - Recommendation: Apply the same sensitivity gate. "Yes" / "No" will classify as low sensitivity, allowing cloud STT for the confirm turn.

3. **VoiceSection.tsx placement in Settings**
   - What we know: Settings has 4 NavSections (Status / Connections / Behaviour / Account)
   - What's unclear: Which NavSection gets VoiceSection — likely Behaviour alongside existing prefs
   - Recommendation: Place under Behaviour NavSection, after the existing preference rows.

---

## Environment Availability

Step 2.6: SKIPPED — no new external dependencies beyond what is already installed and verified.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 2.x |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `pnpm vitest run <specific-spec-path>` |
| Full suite command | `pnpm vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VOICE-09 (SC1) | `voice-intent-router.ts` dispatches to same service fns as IPC handlers | unit | `pnpm vitest run tests/unit/main/voice/voice-intent-router.spec.ts` | ❌ Wave 0 |
| VOICE-09 (SC1) | ask-service.ts extracted function passes all existing ask.spec.ts cases | unit | `pnpm vitest run tests/unit/main/ipc/ask.spec.ts` | ✅ must pass unchanged |
| VOICE-10 (D-11) | `'cancelled'` added to ApprovalState; `assertTransition('ready','cancelled')` succeeds | unit | `pnpm vitest run tests/unit/main/approvals/state.spec.ts` | ❌ Wave 0 |
| VOICE-10 (D-11) | `assertApproved` throws `not-approved` for `cancelled` rows | unit | `pnpm vitest run tests/unit/main/approvals/gate.spec.ts` | ✅ (add cancelled test case) |
| VOICE-09 (D-05) | Read-back template builder returns correct strings for each kind | unit | `pnpm vitest run tests/unit/main/voice/read-back-template.spec.ts` | ❌ Wave 0 |
| VOICE-05 (SC4) | `classify()` with confidence < 0.6 forces local | unit | `pnpm vitest run tests/unit/main/llm/sensitivityClassifier.spec.ts` | ✅ (add threshold test) |
| VOICE-11 (SC3) | `transitionTo(ready→cancelled)` succeeds after migration 137 | integration | `pnpm vitest run tests/integration/voice-confirm.spec.ts` | ❌ Wave 0 |
| VOICE-09 (SC1) | Voice→stage→confirm→`assertApproved`→write end-to-end | integration | `pnpm vitest run tests/integration/voice-write-path.spec.ts` | ❌ Wave 0 |
| VOICE-10 (D-17) | Ratchet: voice modules still cannot import raw write chokepoints | static | `pnpm vitest run tests/static/voice-streaming-no-write.spec.ts` | ✅ (update ratchet) |
| N/A | Handler count = Object.keys(CHANNELS).length | unit | `pnpm vitest run tests/unit/main/ipc/index.spec.ts` | ✅ (add new CHANNELS, register handlers) |

**Success Criteria → Validation Mapping:**

| SC | Behavior | Validated By |
|----|----------|-------------|
| SC1: same-in-process service | Router calls same fn as IPC handler (not re-crossing preload bridge) | Unit test for VoiceIntentRouter + ask-service extraction; grep ratchet confirming no `window.aria` call inside `voice-intent-router.ts` |
| SC2: read-back + dual-channel confirm | TTS reads resolved entities; ApprovalCard visible; spoken affirmative → `voiceConfirm` → write | Integration test (voice-write-path.spec.ts); human-verify: live acoustic confirm flow |
| SC3: cancel/mishear | Cancel during awaiting-confirm → row transitions to `'cancelled'`; retry works | Unit test (voice-confirm.spec.ts cancel case); integration test |
| SC4: cloud opt-in + sensitivity stays local | Sensitivity-flagged turn uses local despite cloud consent; confidence < 0.6 → local | Unit test (sensitivityClassifier threshold); human-verify: live cloud STT with OpenAI key |
| SC5: voice settings per-turn | `voice.speed` / `voice.useCloud` change honored on next turn start | Unit test reading prefs after KV write; human-verify in running app |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <changed-spec>`
- **Per wave merge:** `pnpm vitest run` (full suite)
- **Phase gate:** Full suite green + `pnpm typecheck` 0 new errors before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/main/voice/voice-intent-router.spec.ts` — covers VOICE-09 SC1 routing
- [ ] `tests/unit/main/voice/read-back-template.spec.ts` — covers D-05 template per kind
- [ ] `tests/unit/main/approvals/state.spec.ts` — covers D-11 `'cancelled'` state machine
- [ ] `tests/integration/voice-confirm.spec.ts` — covers VOICE-11 cancel path + DB integration
- [ ] `tests/integration/voice-write-path.spec.ts` — covers SC2 end-to-end voice→write
- [ ] Migration 137 must land before any test that calls `transitionTo(id, 'cancelled')`

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — voice uses same auth gate as all other IPC |
| V3 Session Management | no | n/a |
| V4 Access Control | yes | `assertApproved` gate + HARD GATE `voice-forbidden-forced` branch |
| V5 Input Validation | yes | `zod` schemas for confirm classifier intent + `generateObject`; 4096-char question cap (inherited from `ask()`) |
| V6 Cryptography | no | n/a — no new crypto; cloud audio sent over TLS by `@ai-sdk/openai` |

### Known Threat Patterns for Voice Write Path

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Voice spoofing (attacker speaks confirm into mic) | Spoofing | PTT-first + half-duplex mic gate; HARD GATE for forced/high-severity rows; on-screen Cancel button as independent channel |
| PII leaking to cloud STT | Info Disclosure | Per-turn sensitivity gate (`classify()` pre-audio); `confidence < 0.6 → forced local`; `voice.cloudAudio.consented` required |
| Hedged utterance bypassing confirm | Tampering | `generateObject` classify `ambiguous` → re-prompt; auto-cancel after 2 re-prompts |
| Forced-row approval via voice | Elevation of Privilege | `assertApproved` gate throws `voice-forbidden-forced` for `isForced && approval_path === 'voice-explicit'` (verified in gate.ts) |
| Prompt injection via transcript | Tampering | Confirm classifier receives raw STT text — only classifies `confirm/cancel/ambiguous`; transcript is not used as a prompt suffix for the write operation |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | WAV audio from the local sidecar PCM pipeline can be passed directly as `Buffer` to `experimental_transcribe` without format conversion | Code Examples / Cloud STT | Low — OpenAI accepts WAV; if format incompatible, add brief conversion step |
| A2 | OpenAI Whisper 30-second PTT utterances stay well under the 25 MB limit | Common Pitfalls | Negligible — a 30s 16kHz 16-bit mono WAV is ~960 KB |
| A3 | The `action_audit_log` referenced in D-14 for the consent audit row is the Phase-8 `action_audit_log` VIEW | D-14 | Medium — if the VIEW does not accept direct INSERTs (it likely selects from approval table), the consent audit must be a direct `approval` row with `kind='voice_cloud_consent'` OR use the `settings` KV only. CONTEXT.md says "action_audit_log row (action='voice_cloud_consent', approval_path='explicit')" — needs confirmation against the actual VIEW/table DDL before implementing. |

**Note on A3:** The `action_audit_log` is defined in migration 128/129 as a VIEW over `action_audit_log` table or directly as a table. The planner should verify this before writing the consent audit task.

---

## Sources

### Primary (HIGH confidence)
- `src/main/voice/confirm.ts` — voiceConfirm signature + behavior (read 2026-06-08)
- `src/main/approvals/state.ts` — ApprovalState union + ALLOWED transitions (read 2026-06-08)
- `src/main/approvals/gate.ts` — assertApproved logic + HARD GATE branch (read 2026-06-08)
- `src/main/approvals/persist.ts` — ApprovalRow shape, insertApproval, transitionTo (read 2026-06-08)
- `src/main/ipc/ask.ts` — exact inner logic to extract for D-02 (read 2026-06-08)
- `src/main/db/migrations/134_voice_explicit_path.sql` — CHECK constraint on state column (read 2026-06-08)
- `src/main/llm/sensitivityClassifier.ts` — classify() signature + never-throws guarantee (read 2026-06-08)
- `src/main/llm/tokenize.ts` — tokenizeForFrontier/rehydrate API (read 2026-06-08)
- `src/main/rag/answer-service.ts` — streamVoiceAnswer LOCAL-only + ask() frontier path (read 2026-06-08)
- `src/main/voice/voice-session-manager.ts` — VoiceSessionManager interface (read 2026-06-08)
- `src/renderer/features/voice/useVoiceSession.ts` — bargeIn(), VoiceSessionState, VoiceSessionActions (read 2026-06-08)
- `src/main/voice/prefs.ts` — settings KV pattern + KEY_PREFIX (read 2026-06-08)
- `src/main/background/prefs.ts` — BG_GET/SET_PREFS mirror pattern (read 2026-06-08)
- `src/shared/ipc-contract.ts` — CHANNELS object (dynamic count verified) (read 2026-06-08)
- `tests/static/voice-streaming-no-write.spec.ts` — current ratchet WRITE_CHOKEPOINTS list (read 2026-06-08)
- `tests/unit/main/ipc/index.spec.ts` — handler count invariant uses Object.keys(CHANNELS).length (read 2026-06-08)
- `node_modules/@ai-sdk/openai` — version 3.0.64; `openai.transcription()` method verified present (node -e inspection 2026-06-08)
- `node_modules/ai` — `experimental_transcribe` exported (node -e inspection 2026-06-08)
- `src/main/rag/person-resolver.ts` — ResolveOutcome `kind:'ambiguous'` shape (read 2026-06-08)
- `src/renderer/features/approvals/ApprovalCard.tsx` — `forceExplicit` computation (read 2026-06-08)
- `src/main/ipc/approvals.ts` — approve dispatch pattern + DEFAULT_LIST_STATES (read 2026-06-08)
- `src/shared/scheduling-rules.ts` — `timeZone` field in Rules type (read 2026-06-08)

### Secondary (MEDIUM confidence)
- [ai-sdk.dev/docs/ai-sdk-core/transcription](https://ai-sdk.dev/docs/ai-sdk-core/transcription) — `experimental_transcribe` API, OpenAI Whisper-1 usage, return type (fetched 2026-06-08)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all packages verified in node_modules
- Architecture: HIGH — all integration points read from actual source files
- Migration requirement (D-11): HIGH — CHECK constraint read from actual migration SQL
- Cloud STT API: HIGH — verified against installed package exports
- Pitfalls: HIGH — derived from reading actual code, not assumptions
- ratchet update: HIGH — read actual ratchet file; derived minimal change

**Research date:** 2026-06-08
**Valid until:** 2026-07-08 (stable stack — no fast-moving deps)

# Phase 17: Voice-Confirm + Writes Through the Gate — Pattern Map

**Mapped:** 2026-06-08
**Files analyzed:** 15 new/modified files
**Analogs found:** 15 / 15

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/main/db/migrations/137_approval_cancelled_state.sql` | migration | CRUD | `src/main/db/migrations/134_voice_explicit_path.sql` | exact |
| `src/main/approvals/state.ts` | model | CRUD | self (modify) | exact |
| `src/main/rag/ask-service.ts` | service | request-response | `src/main/ipc/ask.ts` (extract from) | exact |
| `src/main/ipc/ask.ts` | handler (thin wrapper after extraction) | request-response | self (modify) | exact |
| `src/main/voice/voice-intent-router.ts` | service | request-response | `src/main/scheduling/intent.ts` + `src/main/ipc/approvals.ts` | role-match |
| `src/main/voice/cloud-stt.ts` | service | request-response | `src/main/rag/answer-service.ts` (cloud path shape) | partial-match |
| `src/main/voice/prefs.ts` | service (extend) | CRUD | self + `src/main/background/prefs.ts` | exact |
| `src/main/ipc/voice.ts` | handler (extend) | request-response | self (extend) + `src/main/ipc/background.ts` | exact |
| `src/shared/ipc-contract.ts` | contract (extend) | n/a | self (extend) | exact |
| `src/preload/index.ts` | bridge (extend) | n/a | self (extend) | exact |
| `src/renderer/features/voice/useVoiceSession.ts` | hook (extend) | event-driven | self (extend) | exact |
| `src/renderer/features/settings/VoiceSection.tsx` | component | request-response | `src/renderer/features/settings/BehaviourSection.tsx` | exact |
| `src/renderer/features/approvals/ApprovalCard.tsx` | component (extend) | CRUD | self (extend) | exact |
| `tests/static/voice-streaming-no-write.spec.ts` | test (update) | n/a | self (update) | exact |
| `src/main/ipc/approvals.ts` | handler (update) | CRUD | self (update) | exact |

---

## Pattern Assignments

### `src/main/db/migrations/137_approval_cancelled_state.sql` (migration, CRUD)

**Analog:** `src/main/db/migrations/134_voice_explicit_path.sql`

**Why:** Migration 134 is the ONLY prior migration that rebuilt the `approval` table via the `PRAGMA legacy_alter_table=ON` + table-rebuild pattern. Migration 137 must use the identical structure because SQLite cannot ALTER a CHECK constraint — it must rebuild the table. RESEARCH confirmed the state CHECK constraint in migration 134 does NOT include `'cancelled'`.

**CRITICAL: Complete table-rebuild pattern** (`134_voice_explicit_path.sql` lines 1–89, verbatim template):

```sql
PRAGMA foreign_keys=OFF;
-- legacy_alter_table=ON makes RENAME behave as in SQLite < 3.25: it does NOT
-- rewrite references to `approval` inside OTHER objects (child-table foreign
-- keys, views, triggers). Without this, RENAME approval -> approval_old silently
-- repoints send_log / calendar_action_log FKs and action_audit_log view at
-- approval_old, which we then DROP — leaving dangling references.
PRAGMA legacy_alter_table=ON;
BEGIN;

ALTER TABLE approval RENAME TO approval_old;

CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('email_send','calendar_change','task_batch')),
  state TEXT NOT NULL CHECK (state IN (
    'pending','generating','ready','approved','rejected','snoozed','interrupted','sent',
    'sending','failed','needs-operator-decision',
    'cancelled'   -- NEW: Phase 17 D-11 voice-path abort
  )),
  -- ... all other columns verbatim from migration 134 ...
  approval_path TEXT NOT NULL DEFAULT 'explicit' CHECK (approval_path IN ('explicit','silent','voice-explicit')),
  -- ... remaining columns unchanged ...
);

INSERT INTO approval (...) SELECT ... FROM approval_old;
DROP TABLE approval_old;

-- Recreate all indexes (verbatim from migration 134):
CREATE INDEX IF NOT EXISTS idx_approval_state ON approval(state);
CREATE INDEX IF NOT EXISTS idx_approval_kind_state ON approval(kind, state);
CREATE INDEX IF NOT EXISTS idx_approval_updated_at ON approval(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_approval_provider_account ON approval(provider_key, account_id);
CREATE INDEX IF NOT EXISTS idx_approval_meeting_note ON approval(meeting_note_id);

COMMIT;
PRAGMA legacy_alter_table=OFF;
PRAGMA foreign_keys=ON;
```

**Column list to copy from migration 134 lines 14–55 verbatim** — the full 37-column CREATE TABLE. The only diff from migration 134 is adding `'cancelled'` to the state CHECK constraint.

**Also update:** `src/main/db/migrations/embedded.ts` must be updated to include the new state value in the embedded DDL (canonical new-install schema).

---

### `src/main/approvals/state.ts` (model, CRUD — modify)

**Analog:** self

**Current file** (`src/main/approvals/state.ts` lines 12–45):

```typescript
export type ApprovalState =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'approved'
  | 'rejected'
  | 'snoozed'
  | 'interrupted'
  | 'sent'
  | 'sending'
  | 'failed'
  | 'needs-operator-decision';

const ALLOWED: Record<ApprovalState, readonly ApprovalState[]> = {
  pending: ['generating'],
  generating: ['ready', 'interrupted'],
  ready: ['approved', 'rejected', 'snoozed'],   // ← add 'cancelled' here
  approved: ['sent', 'sending'],
  rejected: [],
  snoozed: ['ready'],
  interrupted: ['generating'],
  sent: [],
  sending: ['sent', 'failed', 'needs-operator-decision'],
  failed: ['needs-operator-decision'],
  'needs-operator-decision': [],
};

export const APPROVAL_STATES: readonly ApprovalState[] = Object.keys(ALLOWED) as ApprovalState[];
```

**Required changes (D-11):**
1. Add `| 'cancelled'` to `ApprovalState` union (after `'needs-operator-decision'`)
2. Change `ready` entry: `ready: ['approved', 'rejected', 'snoozed', 'cancelled']`
3. Add terminal entry: `cancelled: []`
4. `APPROVAL_STATES` updates automatically via `Object.keys(ALLOWED)`

---

### `src/main/rag/ask-service.ts` (service, request-response — new, extracted from ipc/ask.ts)

**Analog:** `src/main/ipc/ask.ts` (lines 14–247 — the inner logic to extract)

**Why:** D-02 requires extracting the inner routing logic so `VoiceIntentRouter` can call it in-process without re-crossing the preload bridge. The `ipc/ask.ts` handler becomes a thin wrapper.

**Exact inner logic to extract** (from `src/main/ipc/ask.ts` — copy these verbatim into the service):

**Imports pattern** (lines 14–46):
```typescript
import { generateText } from 'ai';
import { LLMRouter, NoLlmProviderError, type RoutingDecision } from '../llm/router';
import {
  getLocalModel,
  getFrontierModel,
  OllamaUnavailableError,
  FrontierUnavailableError,
  DEFAULT_LOCAL_MODEL,
} from '../llm/providers';
import {
  writeRoutingLog,
  hashPrompt,
  type RoutingLogInput,
} from '../llm/routingLog';
import type { Route } from '../../shared/ipc-contract';
```

**DI surface to preserve** (from `ipc/ask.ts` lines 48–59):
```typescript
export interface AskDeps {
  logger: Logger;
  dbHolder: DbHolder;
  router?: LLMRouter;
  getLocalModelFn?: typeof getLocalModel;
  getFrontierModelFn?: typeof getFrontierModel;
  generateTextFn?: typeof generateText;
}
```

**The `classifyFrontierError` helper** (lines 61–77) must also move to `ask-service.ts` since it is private to the inner logic — OR be re-exported from there so `ipc/ask.ts` can re-import it.

**LOCAL path pattern** (lines 138–178) — extract verbatim:
```typescript
// --- LOCAL path ---
if (decision.route === 'LOCAL') {
  try {
    const model = localModelFactory();
    const result = await gen({ model: model as Parameters<typeof gen>[0]['model'], prompt });
    const latency_ms = Math.round(performance.now() - startedAt);
    writeLog({
      ts: new Date().toISOString(),
      route: 'LOCAL',
      reason: decision.reason,
      source: String(source ?? ''),
      model: decision.model || DEFAULT_LOCAL_MODEL,
      latency_ms,
      ok: 1,
    });
    return { answer: result.text, route: 'LOCAL', reason: decision.reason, latency_ms };
  } catch (e) { /* ... writeLog ok:0, return { error: reason } */ }
}
```

**FRONTIER path with LOCAL fallback** (lines 180–244) — extract verbatim, preserving the two-level try/catch fallback.

**`writeLog` closure** (lines 129–136) — the closure captures `db`, `promptHashValue`, and `logger`. In `ask-service.ts`, the extracted function receives `dbGetter: () => Database | null` so the lazy db accessor pattern is preserved:
```typescript
const db = dbGetter();
const writeLog = (entry: Omit<RoutingLogInput, 'prompt_hash'>): void => {
  if (!db) return;
  try {
    writeRoutingLog(db, { ...entry, prompt_hash: promptHashValue });
  } catch (e) {
    logger.warn({ event: 'ask.routing-log.write-failed', err: (e as Error).message });
  }
};
```

**Public interface for `ask-service.ts`:**
```typescript
export async function performAsk(
  deps: AskServiceDeps,
  prompt: string,
  source: string | undefined,
  startedAt: number,
): Promise<{ answer: string; route: Route; reason: string; latency_ms: number } | { error: string }>
```

**After extraction, `ipc/ask.ts` handler body becomes:**
```typescript
ipcMain.handle(CHANNELS.ASK_ARIA, async (_event, payload: unknown) => {
  // entitlement gate (stays in handler, not in service)
  const _db_for_gate = dbHolder.db;
  if (_db_for_gate) { /* assertEntitled ... */ }

  const req = (payload ?? {}) as Partial<AskRequest>;
  const prompt = typeof req.prompt === 'string' ? req.prompt : '';
  const source = (req.source ?? undefined) as AskRequest['source'] | undefined;
  const startedAt = performance.now();

  return performAsk(
    { logger, router, localModelFactory, frontierModelFactory, gen, dbGetter: () => dbHolder.db },
    prompt,
    source,
    startedAt,
  );
});
```

**Preservation invariant:** `tests/unit/main/ipc/ask.spec.ts` must pass unmodified. The test mocks `deps.router`, `deps.getLocalModelFn`, `deps.getFrontierModelFn`, `deps.generateTextFn` — these must remain at the SAME injection boundary in the extracted function.

---

### `src/main/voice/voice-intent-router.ts` (service, request-response — new)

**Analog 1 (intent parsing pattern):** `src/main/scheduling/intent.ts`
**Analog 2 (dispatch-to-service pattern):** `src/main/ipc/approvals.ts` (lines 199–280)

**Why:** The router does two things: (1) structured intent extraction with `generateObject` + Zod — identical to `parseIntent`; (2) calls the same service functions that the IPC handlers call — identical shape to how `ipc/approvals.ts` calls `applyCalendarChange`, `getApproval`, etc.

**generateObject + Zod pattern** (from `src/main/scheduling/intent.ts` lines 17–45):
```typescript
import { z } from 'zod';
import { generateObject } from 'ai';
import type PQueueImport from 'p-queue';

// Domain extraction schema (one per domain):
export const IntentSchema = z.object({
  action: z.enum(['move', 'create', 'find-time', 'cancel-unsupported']),
  // ...
});

type PQueueLike = InstanceType<typeof PQueueImport>;

export interface ParseIntentDeps {
  model?: ModelLike;
  generateObjectFn?: typeof generateObject;
  queue?: PQueueLike | { add: <T>(fn: () => Promise<T>) => Promise<T> };
  routed?: 'local' | 'frontier';
}
```

**parseIntent call pattern** (from `src/main/scheduling/intent.ts` lines 119+) — the schedule domain uses this DIRECTLY. Router re-uses it without modification per D-01:
```typescript
// For 'schedule' domain in router:
import { parseIntent } from '../scheduling/intent';
const intent = await parseIntent(nl, parseDeps);
// → then proposeCalendarChange(db, intent, deps)
```

**Service dispatch pattern after staging** (from `src/main/ipc/approvals.ts` lines 199–238):
```typescript
// After transitionTo(db, r.id, 'approved', patch):
const row = getApproval(db, r.id);
if (row && row.kind === 'calendar_change') {
  await applyCalendarChange(db, r.id, applyDeps);
}
```

**Key anti-patterns to avoid:**
- Router MUST NOT call `voiceConfirm` — it only calls `insertApproval` + triggers read-back (D-03)
- Router MUST NOT import `assertApproved`, `sendApprovedEmail`, `applyCalendarChange`, or `pushApprovedMeetingActions` (write chokepoints)

**DI structure for the router:**
```typescript
export interface VoiceIntentRouterDeps {
  db: Db;
  logger: Logger;
  queue: PQueueLike;              // for LLM calls (same concurrency=1 pattern)
  // Service functions — same fns the IPC handlers call:
  draftReplyFn?: typeof draftReply;
  proposeCalendarChangeFn?: typeof proposeCalendarChange;
  parseIntentFn?: typeof parseIntent;
  summarizeThreadFn?: typeof summarizeThread;
  performAskFn?: typeof performAsk;           // D-02: extracted from ask.ts
  resolvePersonMentionsFn?: typeof resolvePersonMentions;
  insertApprovalFn?: typeof insertApproval;
  getApprovalFn?: typeof getApproval;
}
```

---

### `src/main/voice/cloud-stt.ts` (service, request-response — new)

**Analog:** `src/main/rag/answer-service.ts` (cloud path shape, buffered non-streaming)

**Why:** This is a new standalone async function with no existing direct analog, but the buffered-call shape matches `ask()` in answer-service — one-shot LLM call, returns a typed result, db-null safe, never throws (catch + return error).

**Cloud STT call pattern** (from RESEARCH D-13 — verified against installed `@ai-sdk/openai@3.0.64`):
```typescript
import { experimental_transcribe as transcribe } from 'ai';
import { openai } from '@ai-sdk/openai';

export async function cloudTranscribe(
  audioBuffer: Buffer,
  signal: AbortSignal,
): Promise<{ text: string } | { error: string }> {
  try {
    const result = await transcribe({
      model: openai.transcription('whisper-1'),
      audio: audioBuffer,
      abortSignal: signal,
    });
    return { text: result.text };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
```

**Sensitivity gate pattern** (from RESEARCH D-15, mirroring `src/main/llm/sensitivityClassifier.ts`):

`classify()` signature (from `src/main/llm/sensitivityClassifier.ts` lines 25–43):
```typescript
// SensitivityResult type:
export const SensitivitySchema = z.object({
  categories: z.array(z.enum(['financial', 'legal', 'hr', 'pii', 'urgent', 'none'])).min(1),
  severity: z.enum(['low', 'med', 'high']),
  confidence: z.number().min(0).max(1),
  rationale: z.string().max(200),
});
export type SensitivityResult = z.infer<typeof SensitivitySchema>;

// classify() never throws (Stage-3 regex fallback):
// export async function classify(text: string, queue: PQueueLike, opts?: ClassifyOptions): Promise<SensitivityResult>
```

**Fail-safe gate:**
```typescript
// D-15: pre-audio gate
const sensitivity = await classify(context, queue);
const allowCloud = sensitivity.confidence >= 0.6 &&
                   sensitivity.categories.every(c => c === 'none');
// If allowCloud === false → use local STT regardless of consent
```

---

### `src/main/voice/prefs.ts` (service, CRUD — extend)

**Analog:** self (Phase 15 KV shape) + `src/main/background/prefs.ts` (full read/write pattern)

**Current KV shape** (`src/main/voice/prefs.ts` lines 19–21):
```typescript
const KEY_PREFIX = 'voice.';
type VoicePrefKey = 'modelReady' | 'modelPath' | 'modelState';
```

**Extend to add D-16 keys** (mirror `background/prefs.ts` pattern exactly):
```typescript
type VoicePrefKey =
  | 'modelReady' | 'modelPath' | 'modelState'  // Phase 15 (unchanged)
  | 'speed'                                      // NEW: '0.75'|'1.0'|'1.25'|'1.5'
  | 'voiceId'                                    // NEW: Kokoro voice name
  | 'useCloud'                                   // NEW: '1'|'0'
  | 'cloudAudio.consented'                       // NEW: '1'|'0' (D-14)
  | 'cloudAudio.consentedAt';                    // NEW: ISO timestamp
```

**Read/write pattern from `background/prefs.ts`** (lines 77–110):
```typescript
// readStr pattern (already exists in voice/prefs.ts lines 34–43):
function readStr(db: Db, key: VoicePrefKey): string | undefined {
  try {
    const row = db.prepare('SELECT v FROM settings WHERE k = ?').get(fullKey(key)) as { v?: string } | undefined;
    return row?.v;
  } catch { return undefined; }
}

// writeStr pattern (already exists in voice/prefs.ts lines 45–50):
function writeStr(db: Db, key: VoicePrefKey, value: string): void {
  db.prepare(
    `INSERT INTO settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
  ).run(fullKey(key), value);
}

// New typed getters/setters mirroring background/prefs.ts getBackgroundPrefs():
export interface VoicePrefs {
  speed: number;      // default: 1.0
  voiceId: string;   // default: ''
  useCloud: boolean; // default: false
}

export function getVoicePrefs(db: Db | null): VoicePrefs {
  if (!db) return VOICE_PREF_DEFAULTS;
  // ... read each key, parse, return typed struct
}

export function writeVoicePref(db: Db | null, key: VoicePrefKey, value: string): void {
  if (!db) throw new Error('writeVoicePref: db is null (vault sealed)');
  writeStr(db, key, value);
}
```

---

### `src/main/ipc/voice.ts` (handler, extend)

**Analog:** self (Phase 15/16 handlers) + `src/main/ipc/background.ts` (BG_GET/SET_PREFS pattern)

**New channels to add to `registerVoiceHandlers`:**

**VOICE_CONFIRM_APPROVAL — approval confirm + write dispatch** (mirrors `APPROVALS_APPROVE` handler from `ipc/approvals.ts` lines 175–280):
```typescript
ipcMain.handle(CHANNELS.VOICE_CONFIRM_APPROVAL, async (_e, payload: unknown) => {
  const db = deps.dbHolder.db;
  if (!db) return { error: 'DB_NOT_OPEN' };
  const req = (payload ?? {}) as { approvalId?: string };
  if (!req.approvalId) return { error: 'APPROVAL_ID_REQUIRED' };
  try {
    // 1. voiceConfirm stamps ready→approved with approval_path='voice-explicit'
    voiceConfirm(db, req.approvalId);

    // 2. Dispatch write by kind — mirrors ipc/approvals.ts lines 210–238
    const row = getApproval(db, req.approvalId);
    if (row && row.kind === 'calendar_change') {
      await applyCalendarChange(db, req.approvalId, deps.applyCalendarChangeDeps ?? {});
    }
    // email_send: renderer fires GMAIL_SEND_APPROVED separately (same as ApprovalsScreen)
    // task_batch: call pushApprovedMeetingActions in-process
    return { ok: true };
  } catch (err) {
    logger.warn({ scope: 'voice.confirmApproval', err: (err as Error).message });
    return { error: (err as Error).message };
  }
});
```

**VOICE_CANCEL_APPROVAL — abort ready→cancelled:**
```typescript
ipcMain.handle(CHANNELS.VOICE_CANCEL_APPROVAL, async (_e, payload: unknown) => {
  const db = deps.dbHolder.db;
  if (!db) return { error: 'DB_NOT_OPEN' };
  const req = (payload ?? {}) as { approvalId?: string };
  if (!req.approvalId) return { error: 'APPROVAL_ID_REQUIRED' };
  try {
    transitionTo(db, req.approvalId, 'cancelled');
    return { ok: true };
  } catch (err) {
    return { error: (err as Error).message };
  }
});
```

**VOICE_GET_PREFS / VOICE_SET_PREFS** (mirror `background.ts` BG_GET/SET pattern exactly, lines 42–88):
```typescript
ipcMain.handle(CHANNELS.VOICE_GET_PREFS, (): VoicePrefsDto => {
  return getVoicePrefs(deps.dbHolder.db);
});

ipcMain.handle(CHANNELS.VOICE_SET_PREFS, async (_event, payload: unknown) => {
  const db = deps.dbHolder.db;
  if (!db) return { error: 'db-locked' };
  const parsed = VoicePrefsPatchSchema.safeParse(payload);   // z.object({...}).strict()
  if (!parsed.success) return { error: 'invalid-payload' };
  // write each key via writeVoicePref(db, ...)
  return getVoicePrefs(db);
});
```

**VoiceHandlersDeps additions for Phase 17:**
```typescript
export interface VoiceHandlersDeps {
  // ... existing Phase 15/16 fields ...
  applyCalendarChangeDeps?: ApplyCalendarChangeDeps;  // NEW: for calendar write dispatch
}
```

---

### `src/shared/ipc-contract.ts` (contract, extend)

**Analog:** self (Phase 16 additions pattern — lines 192–200)

**New CHANNELS entries to add** (follow Phase 16 pattern with comment block):
```typescript
// Phase 17 — Voice-Confirm + Writes Through the Gate (17-01)
VOICE_CONFIRM_APPROVAL: 'aria:voice:confirm-approval',   // D-04: ready→approved
VOICE_CANCEL_APPROVAL: 'aria:voice:cancel-approval',     // D-09/D-11: ready→cancelled
VOICE_GET_PREFS: 'aria:voice:get-prefs',                 // D-16: read voice prefs
VOICE_SET_PREFS: 'aria:voice:set-prefs',                 // D-16: write voice prefs
```

**New CHANNEL_METHODS entries** (follow Phase 16 pattern — lines 1511–1516):
```typescript
VOICE_CONFIRM_APPROVAL: 'voiceConfirmApproval',
VOICE_CANCEL_APPROVAL: 'voiceCancelApproval',
VOICE_GET_PREFS: 'voiceGetPrefs',
VOICE_SET_PREFS: 'voiceSetPrefs',
```

**New AriaApi method signatures** (follow Phase 16 pattern — lines 1085–1093):
```typescript
voiceConfirmApproval(req: { approvalId: string }): Promise<{ ok: true } | { error: string }>;
voiceCancelApproval(req: { approvalId: string }): Promise<{ ok: true } | { error: string }>;
voiceGetPrefs(): Promise<VoicePrefsDto>;
voiceSetPrefs(patch: Partial<VoicePrefsPatchDto>): Promise<VoicePrefsDto | { error: string }>;
```

**Handler-count invariant:** `tests/unit/main/ipc/index.spec.ts` line 76:
```typescript
expect(handlers.size).toBe(Object.keys(CHANNELS).length);
```
Adding 4 CHANNELS entries requires exactly 4 new handlers registered in `registerVoiceHandlers`. The test uses `Object.keys(CHANNELS).length` dynamically — no hardcoded count to update.

---

### `src/preload/index.ts` (bridge, extend)

**Analog:** self (Phase 16 additions — lines 75–84)

All 4 new Phase 17 channels (`VOICE_CONFIRM_APPROVAL`, `VOICE_CANCEL_APPROVAL`, `VOICE_GET_PREFS`, `VOICE_SET_PREFS`) are invoke-direction channels (renderer → main) — they are auto-mapped by the existing `buildApi()` loop via `CHANNEL_METHODS`. **No manual override needed** — same as `VOICE_ABORT`, `VOICE_FEED_ANSWER`, `VOICE_LATENCY_MARK` in Phase 16.

Push channels (if any Phase 17 notifications are added from main → renderer) would follow the pattern at lines 54–83:
```typescript
(api as unknown as Record<string, ((cb: (d: unknown) => void) => () => void)>)
  .onVoiceTtsChunk = (cb: (d: unknown) => void) => {
  const handler = (_e: unknown, d: unknown) => cb(d);
  ipcRenderer.on(CHANNELS.VOICE_TTS_CHUNK, handler);
  return () => ipcRenderer.removeListener(CHANNELS.VOICE_TTS_CHUNK, handler);
};
```

---

### `src/renderer/features/voice/useVoiceSession.ts` (hook, event-driven — extend)

**Analog:** self (Phase 16 bargeIn + pendingApprovalId extension)

**Current `VoiceSessionActions`** (from `useVoiceSession.ts` lines 64–):
```typescript
export interface VoiceSessionActions {
  startTurn(): boolean;
  stopTurn(): void;
  setVadMode(mode: 'hold' | 'toggle'): void;
  setTranscript(text: string, final: boolean): void;
  endTurn(): void;
  onPlaybackStart(): void;
  onPlaybackEnd(): void;
  bargeIn(): void;   // Phase 16 D-01
  pause(): void;
  resume(): void;
}
```

**Add to `VoiceSessionState`** (D-10 pendingApprovalId):
```typescript
export interface VoiceSessionState {
  // ... existing fields ...
  pendingApprovalId: string | null;   // NEW: non-null = awaiting-confirm sub-state
}
```

**bargeIn() extension** (D-10 — barge-in while awaiting-confirm must cancel the approval):

Current `bargeIn()` fires `voiceAbort` IPC. Phase 17 extends it to also check `pendingApprovalId`:
```typescript
// In bargeIn() action:
if (state.pendingApprovalId) {
  window.aria.voiceCancelApproval({ approvalId: state.pendingApprovalId });
  // fire-and-forget; clear pendingApprovalId immediately
  setState(s => ({ ...s, pendingApprovalId: null }));
}
// then existing voiceAbort logic
```

**Final-transcript dispatch** (D-04 Pitfall 4 — confirm turn vs normal turn):
```typescript
// In setTranscript(text, final=true):
if (state.pendingApprovalId !== null) {
  // Confirm turn: send to confirm classifier via VOICE_CONFIRM_APPROVAL
  // (pass transcript for confirm classification, NOT to VOICE_FEED_ANSWER)
  window.aria.voiceConfirmApproval({ approvalId: state.pendingApprovalId, transcript: text });
} else {
  // Normal answer turn: existing VOICE_FEED_ANSWER path
  window.aria.voiceFeedAnswer({ sessionId, question: text });
}
```

---

### `src/renderer/features/settings/VoiceSection.tsx` (component, request-response — new)

**Analog:** `src/renderer/features/settings/BehaviourSection.tsx` (exact structural match)

**Why:** `BehaviourSection.tsx` is a Settings panel backed by a GET/SET IPC pair, using editorial `Checkbox` primitives. `VoiceSection.tsx` is the same pattern with different prefs.

**Complete structural pattern** (`BehaviourSection.tsx` lines 1–50):
```typescript
import type * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { CHANNELS, type BackgroundPrefsDto, type BackgroundPrefsPatchDto, type IpcError } from '../../../shared/ipc-contract';
import { Checkbox } from '../../components/editorial/Checkbox';

// Local view type + defaults
interface BehaviourPrefsView { autoLaunch: boolean; closeToTray: boolean; notificationsEnabled: boolean; }
const DEFAULT_VIEW: BehaviourPrefsView = { autoLaunch: false, closeToTray: true, notificationsEnabled: true };

// Type guard for DTO
function isPrefsDto(x: unknown): x is BackgroundPrefsDto { ... }

// IPC invoke helper (mirrors CHANNEL camelCase method)
function invokeBg<T>(channel: string, payload?: unknown): Promise<T | IpcError> {
  const aria = window.aria as unknown as Record<string, (req?: unknown) => Promise<T | IpcError>>;
  const method = channel === CHANNELS.BG_GET_PREFS ? 'backgroundGetPrefs' : 'backgroundSetPrefs';
  return aria[method](payload);
}

export function BehaviourSection(): JSX.Element {
  const [view, setView] = useState<BehaviourPrefsView>(DEFAULT_VIEW);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // useEffect load on mount + onChange handlers + Checkbox rows
}
```

**VoiceSection mirrors this exactly** with:
- `VoicePrefsView` ≈ `{ speed: number; voiceId: string; useCloud: boolean }`
- `CHANNELS.VOICE_GET_PREFS` / `CHANNELS.VOICE_SET_PREFS` instead of BG equivalents
- `Checkbox` for `useCloud`; a select/radio for `speed` (0.75/1.0/1.25/1.5)
- Cloud voice list gated behind `useCloud && cloudAudio.consented`
- Cloud consent modal disclosure (D-14) — separate modal state triggered by first `useCloud` toggle

---

### `src/renderer/features/approvals/ApprovalCard.tsx` (component, CRUD — extend)

**Analog:** self

**`isTerminal` check** (line 241 — add `'cancelled'`):
```typescript
// Current:
const isTerminal = row.state === 'sent' || row.state === 'failed';

// Phase 17:
const isTerminal = row.state === 'sent' || row.state === 'failed' || row.state === 'cancelled';
```

**`forceExplicit` chip / voice-confirm suppression** (D-07 — lines 247–249):
```typescript
const forceExplicit =
  row.severity === 'high' ||
  categories.some((c) => FORCED_CATEGORIES.has(c));

// D-07: when forceExplicit=true, renderer MUST suppress the voice-confirm affordance.
// The forceExplicit boolean already drives the 'explicit-required' chip (lines 393–399):
{forceExplicit && (
  <span className="chip chip-mono" style={{ color: 'var(--gold)' }}>
    explicit-required
  </span>
)}
// Phase 17: also pass forceExplicit to any VoiceConfirmButton — disables it when true.
```

---

### `tests/static/voice-streaming-no-write.spec.ts` (test, update — D-17)

**Analog:** self

**Current `WRITE_CHOKEPOINTS`** (lines 60–66):
```typescript
const WRITE_CHOKEPOINTS = [
  'sendApprovedEmail',
  'applyCalendarChange',
  'pushApprovedMeetingActions',
  'assertApproved',
  'voiceConfirm',           // ← REMOVE this entry (D-17)
] as const;
```

**Required change:** Remove `'voiceConfirm'` from `WRITE_CHOKEPOINTS`.

**Rationale** (from RESEARCH Pattern 6): `voiceConfirm` is called from `src/main/ipc/voice.ts` (the new `VOICE_CONFIRM_APPROVAL` handler), which is OUTSIDE the ratchet's scan scope (`src/main/voice/**` and `src/renderer/features/voice/**`). The raw write chokepoints (`sendApprovedEmail`, `applyCalendarChange`, `pushApprovedMeetingActions`, `assertApproved`) REMAIN banned from voice modules.

**Update test description** (line 68):
```typescript
describe('Phase 17 voice modules are read-only except via voiceConfirm (D-13/D-17)', () => {
  it('no file under src/main/voice/** or src/renderer/features/voice/** directly calls raw write chokepoints', () => {
```

**The `confirm.ts` exclusion** (lines 83–85) remains unchanged — it excludes the file that IS the chokepoint implementation.

---

### `src/main/ipc/approvals.ts` (handler, CRUD — update, D-11)

**Analog:** self

**`DEFAULT_LIST_STATES` update** (lines 38–48 — optionally add `'cancelled'` for audit visibility):
```typescript
const DEFAULT_LIST_STATES: ApprovalUiState[] = [
  'pending',
  'generating',
  'ready',
  'approved',
  'sending',
  'failed',
  'needs-operator-decision',
  'interrupted',
  'snoozed',
  'cancelled',   // NEW: Phase 17 D-11 — show cancelled rows in approval list for audit
];
```

---

## Shared Patterns

### Authentication / Gate
**Source:** `src/main/approvals/gate.ts` (lines 42–112)
**Apply to:** `ipc/voice.ts` VOICE_CONFIRM_APPROVAL handler
```typescript
// assertApproved is called AFTER voiceConfirm stamps 'approved'.
// It throws ApprovalGateError('voice-forbidden-forced') for isForced rows.
// The handler does NOT need to call assertApproved explicitly — assertApproved
// is called by the write chokepoints (sendApprovedEmail, applyCalendarChange,
// pushApprovedMeetingActions) themselves. The chain is:
// voiceConfirm(ready→approved) → write dispatch → assertApproved inside chokepoint.
```

### DB-null guard pattern
**Source:** `src/main/ipc/approvals.ts` (line 50–52) + `src/main/ipc/voice.ts` (lines 146–154)
**Apply to:** All new IPC handlers in `ipc/voice.ts`
```typescript
function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}
// Usage:
const db = deps.dbHolder.db;
if (!db) return notReady();
```

### Settings KV read/write
**Source:** `src/main/voice/prefs.ts` (lines 34–50) + `src/main/background/prefs.ts` (lines 77–110)
**Apply to:** `voice/prefs.ts` new keys + `ipc/voice.ts` VOICE_GET/SET_PREFS handlers
```typescript
// Synchronous read (safe pre-unlock — returns undefined if db null or row missing):
function readStr(db: Db, key: VoicePrefKey): string | undefined { ... }

// Write with upsert:
function writeStr(db: Db, key: VoicePrefKey, value: string): void {
  db.prepare(
    `INSERT INTO settings (k, v) VALUES (?, ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
  ).run(fullKey(key), value);
}
```

### generateObject + Zod pattern (intent + confirm classifier)
**Source:** `src/main/scheduling/intent.ts` (lines 17–45) + `src/main/llm/sensitivityClassifier.ts` (lines 19–54)
**Apply to:** `voice-intent-router.ts` domain extraction + confirm-utterance classifier
```typescript
import { z } from 'zod';
import { generateObject } from 'ai';

// Confirm classifier schema (D-06):
const ConfirmIntentSchema = z.object({
  intent: z.enum(['confirm', 'cancel', 'ambiguous']),
});

// Call pattern (same as sensitivityClassifier):
const { object } = await generateObject({
  model: getLocalModel(),
  schema: ConfirmIntentSchema,
  prompt: confirmPrompt,
  maxRetries: 2,
});
```

### Error handling envelope
**Source:** `src/main/ipc/voice.ts` (lines 130–139) + `src/main/ipc/approvals.ts` (lines 270–279)
**Apply to:** All new IPC handlers
```typescript
try {
  // ... handler body ...
  return { ok: true };
} catch (err) {
  logger.warn({ scope: 'voice.xxx', err: (err as Error).message }, 'handler threw');
  return { error: (err as Error).message };
}
```

### PII tokenize/rehydrate (non-streaming cloud answer, D-13)
**Source:** `src/main/llm/tokenize.ts` (lines 46–60) + `src/main/llm/redaction-roundtrip.ts`
**Apply to:** Cloud answer path inside `voice-session-manager.ts` (non-streaming)
```typescript
import { tokenizeForFrontier, rehydrate, disposeRedactionRoundtrip } from '../llm/redaction-roundtrip';

// Usage (buffered round-trip — NOT in streaming context):
const { prompt: redacted, table } = tokenizeForFrontier(sessionId, rawPrompt);
const result = await generateText({ model: frontierModel, prompt: redacted });
const answer = rehydrate(sessionId, result.text);
disposeRedactionRoundtrip(sessionId);  // cleanup
```

### approval_path = 'voice-explicit' stamp timing
**Source:** `src/main/voice/confirm.ts` (line 40) + RESEARCH Pitfall 8
**Apply to:** All voice staging code in `voice-intent-router.ts`
```typescript
// DO NOT set approval_path at insertApproval time.
// insertApproval defaults to approval_path='explicit' — leave it.
// voiceConfirm stamps 'voice-explicit' via transitionTo(db, id, 'approved', { approval_path: 'voice-explicit' }).
// This is correct by construction.
```

---

## Consent Audit Pattern (D-14) — VERIFIED OPEN QUESTION RESOLVED

**Source:** `src/main/db/migrations/129_phase8_recap.sql`

`action_audit_log` is a **VIEW** (not a table), defined as:
```sql
CREATE VIEW action_audit_log AS
  -- Arm 1: Email sends (Phase 3 send_log + Phase 5 Outlook send)
  SELECT 'email_send' AS kind, ...
```

**Impact on D-14:** Direct INSERT into `action_audit_log` will fail at runtime. The consent audit **MUST** use settings KV only:
- `voice.cloudAudio.consented = '1'`
- `voice.cloudAudio.consentedAt = ISO timestamp`

CONTEXT.md D-14 says "action_audit_log row (action='voice_cloud_consent', approval_path='explicit')" — this is NOT implementable as written. The planner must accept settings-KV-only consent audit and document this correction.

---

## No Analog Found

No files in Phase 17 are truly without analog. The closest cases:

| File | Role | Data Flow | Note |
|---|---|---|---|
| `src/main/voice/cloud-stt.ts` | service | request-response | No prior cloud STT wrapper exists; closest analog is `answer-service.ts` non-streaming ask() shape |

---

## Metadata

**Analog search scope:** `src/main/voice/`, `src/main/ipc/`, `src/main/approvals/`, `src/main/rag/`, `src/main/llm/`, `src/main/scheduling/`, `src/main/background/`, `src/renderer/features/voice/`, `src/renderer/features/settings/`, `src/shared/`, `src/preload/`, `tests/static/`, `src/main/db/migrations/`
**Files scanned:** ~25 key files (full reads) + targeted grep searches
**Pattern extraction date:** 2026-06-08

### Key facts confirmed by reading actual source:
1. Migration 134 CHECK constraint does NOT include `'cancelled'` → migration 137 mandatory
2. `action_audit_log` is a VIEW (not table) → consent audit = settings KV only (D-14 correction required)
3. `WRITE_CHOKEPOINTS` in `voice-streaming-no-write.spec.ts` currently bans `voiceConfirm` from voice modules → remove it (D-17)
4. Handler count test (`index.spec.ts` line 76) uses `Object.keys(CHANNELS).length` dynamically → adding N CHANNELS entries requires exactly N new handlers
5. `state.ts` `ready` transition currently allows only `['approved', 'rejected', 'snoozed']` → must add `'cancelled'`
6. `ApprovalCard.tsx` `isTerminal` check on line 241 covers only `'sent'|'failed'` → must add `'cancelled'`
7. `preload/index.ts` auto-maps all invoke-direction channels via `buildApi()` loop → no manual override needed for 4 new Phase 17 invoke channels
8. `ask.ts` DI interface (`AskDeps`) is the exact injection boundary to preserve in `ask-service.ts` extraction

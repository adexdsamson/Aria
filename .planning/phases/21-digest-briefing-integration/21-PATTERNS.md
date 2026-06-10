# Phase 21: Digest + Briefing Integration - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 10 (3 new, 7 modified)
**Analogs found:** 10 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/main/whatsapp/digest-cron.ts` | service/cron | event-driven + batch | `src/main/whatsapp/retention.ts` | exact |
| `src/main/ipc/briefing.ts` | controller | request-response + CRUD | `src/main/ipc/briefing.ts` lines 223–244 (self-enrichment seam) | exact |
| `src/main/lifecycle/pendingCatchup.ts` | utility | — | self (union extension only) | exact |
| `src/main/index.ts` | config/bootstrap | — | `src/main/index.ts` lines 617–623 + 869–882 | exact |
| `src/main/lifecycle/powerMonitor.ts` | middleware | event-driven | `src/main/lifecycle/powerMonitor.ts` (registerLifecycleCallbacks) | exact |
| `src/shared/ipc-contract.ts` | model/contract | — | `src/shared/ipc-contract.ts` lines 535–557 (BriefingPayload.thisWeekInsights) + 1743–1748 | exact |
| `src/renderer/features/briefing/BriefingScreen.tsx` | component | request-response | `src/renderer/features/briefing/BriefingScreen.tsx` lines 661–725 | exact |
| `src/renderer/features/briefing/GenerateNowAffordance.tsx` | component | request-response | self (retry affordance referenced as-is) | exact |
| `tests/unit/main/whatsapp/digest-cron.spec.ts` | test | — | `tests/unit/main/whatsapp/whatsapp-retention.spec.ts` | exact |
| `tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` | test | — | `tests/unit/main/ipc/briefing-regenerate.spec.ts` | role-match |
| `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` | test | — | self (extend existing `makePayload`/`installAria` pattern) | exact |

---

## Pattern Assignments

### `src/main/whatsapp/digest-cron.ts` (service/cron, event-driven + batch)

**Analog:** `src/main/whatsapp/retention.ts`

**Imports pattern** (lines 18–24):
```typescript
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import nodeCron, { type ScheduledTask } from 'node-cron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import type { DbHolder } from '../ipc/onboarding';
import { pendingCatchup } from '../lifecycle/pendingCatchup';
import { trayBus } from '../tray/index';
```

**CRON_KEY const pattern** (line 90 in retention.ts):
```typescript
const CRON_KEY = 'whatsapp-retention-sweep';
```
Digest cron replaces with:
```typescript
const CRON_KEY = 'whatsapp-digest'; // must match CatchupChannel union value
```

**Deps + Handle interfaces pattern** (lines 92–111):
```typescript
export interface WhatsAppRetentionDeps {
  db: Db;
  logger: Pick<Logger, 'info' | 'warn' | 'debug' | 'error'>;
  /** Override cron expression for tests. Defaults to '30 3 * * *'. */
  cron?: string;
  scheduler: SchedulerHandle | null;
  /** Seal-guard hook (mirrors sweep-cron.ts BG-04 pattern). */
  dbHolder: Pick<DbHolder, 'db'> | null;
}

export interface WhatsAppRetentionHandle {
  stop(): void;
  /** Run the sweep immediately (useful for tests and bootPoll catchup). */
  runNow(): number;
}
```
Digest cron extends this with LLM test-seam injections on `Deps` and makes `runNow()` return `Promise<void>` (async, not sync number).

**Seal-guard + factory pattern** (lines 140–170) — the single most critical block to mirror verbatim:
```typescript
export function startWhatsAppRetention(deps: WhatsAppRetentionDeps): WhatsAppRetentionHandle {
  const { db, logger } = deps;
  const cronExpr = deps.cron ?? '30 3 * * *';

  const task: ScheduledTask = nodeCron.schedule(cronExpr, () => {
    // Seal-guard (mirrors sweep-cron.ts 67-77 BG-04 pattern).
    const dbRef = deps.dbHolder?.db;
    if (deps.dbHolder && !dbRef) {
      pendingCatchup.add(CRON_KEY);   // line 148
      trayBus.setBadge();             // line 149
      return;
    }
    runSweep(db, logger);             // swap for: void runDigest(deps)
  });

  // Register with scheduler.cronRegistry so the no-bare-cron-schedule ratchet
  // passes and powerMonitor suspend/resume can find the task.
  if (deps.scheduler) {
    deps.scheduler.cronRegistry.set(CRON_KEY, task);
  }

  return {
    stop() {
      task.stop();
      if (deps.scheduler) deps.scheduler.cronRegistry.delete(CRON_KEY);
    },
    runNow() {
      return runSweep(db, logger);    // swap for: return runDigest(deps)
    },
  };
}
```
Digest cron default expr: `'0 5 * * *'` (05:00 slot is free — verified via grep of all DEFAULT_EXPR patterns).

**generateText call-site pattern** (from `src/main/ipc/ask.ts` lines 47–66):
```typescript
// Injectable test seams — mirror this pattern exactly:
const localModelFactory = deps.getLocalModelFn ?? getLocalModel;
const gen = deps.generateTextFn ?? generateText;

// Inside runDigest per-group loop (try/catch MUST wrap generateText, not getLocalModel):
const localModel = localModelFactory();
try {
  const { text } = await gen({
    model: localModel as Parameters<typeof gen>[0]['model'],
    system: DIGEST_SYSTEM_PROMPT,
    prompt: buildGroupPrompt(messages, userDisplayName, meJidLocalPart),
    temperature: 0,
  });
  // write successful row: INSERT OR REPLACE ... (summary_text=text)
} catch (err) {
  // Ollama down — write row with summary_text=NULL to record the attempt
  logger.warn({ scope: 'whatsapp-digest', jid, err: (err as Error).message }, '...');
  // INSERT OR REPLACE INTO whatsapp_group_digest (jid, date, summary_text=NULL, ...)
}
```
**Critical:** `getLocalModel()` does NOT fail when Ollama is offline — the error fires inside `await generateText(...)`. The try/catch wraps the `await gen(...)` call, not the `localModelFactory()` call.

**`INSERT OR REPLACE` pattern** (required for retry-on-NULL, see pitfall 3):
```typescript
db.prepare(`
  INSERT OR REPLACE INTO whatsapp_group_digest
    (jid, date, summary_text, generated_at, model_id)
  VALUES (?, ?, ?, ?, ?)
`).run(jid, date, summaryText ?? null, summaryText ? Date.now() : null, modelId ?? null);
```
Do NOT use `INSERT OR IGNORE` — it silently skips retry when a NULL row exists.

---

### `src/main/ipc/briefing.ts` — `readWhatsAppDigests` helper + `row.whatsApp` enrichment (controller, request-response)

**Analog:** `src/main/ipc/briefing.ts` lines 223–244 (self-enrichment seam)

**Enrichment block pattern to extend** (lines 223–244, confirmed verbatim):
```typescript
// Plan 08-01 — enrich with "This week" insights.
try {
  const weekYmd = weekStartYmdFor(new Date(), tz);
  const ins = readLatestInsights(db, weekYmd);
  if (ins.state === 'unlocked') {
    row.thisWeekInsights = {
      state: 'unlocked',
      rows: ins.rows.map((r) => ({ id: r.id, kind: r.kind, sentences: r.sentences })),
    };
  } else if (ins.state === 'locked') {
    row.thisWeekInsights = {
      state: 'locked',
      daysRemaining: ins.daysRemaining,
      blockedKinds: ins.blockedKinds,
    };
  } // 'empty-unlocked' → leave undefined (section omitted)
} catch (err) {
  logger.warn(
    { scope: 'briefing-today-insights', err: (err as Error).message },
    'failed to enrich briefing with insights',
  );
}
return row;   // ← Phase 21 inserts its block BEFORE this return
```

**New enrichment block to insert after the insights block, before `return row`:**
```typescript
// Phase 21 — enrich with WhatsApp group digests (D-11).
// // read-only, no model — annotated per D-13 to keep ratchet boundary crisp.
try {
  const wa = readWhatsAppDigests(db, date, logger);
  if (wa !== undefined) row.whatsApp = wa;
  // D-07.3 async fallback: if no digest rows for today, trigger generation
  // fire-and-forget — NEVER await here; never propagate Ollama errors into briefing.
  // void triggerDigestIfMissing(db, date, deps);
} catch (err) {
  logger.warn(
    { scope: 'briefing-today-whatsapp', err: (err as Error).message },
    'failed to enrich briefing with whatsapp digests',
  );
}
return row;
```

**`readLatestInsights` import pattern** (line 41 in briefing.ts) — the helper import to mirror:
```typescript
import { readLatestInsights } from './insights';
```
Phase 21 adds `readWhatsAppDigests` as a module-local function in `briefing.ts` itself (D-13), not as a cross-module import. Annotate: `// read-only, no model`.

---

### `src/main/lifecycle/pendingCatchup.ts` (utility, union extension)

**Analog:** self — extend line 21

**Current `CatchupChannel` union** (lines 12–21, confirmed verbatim):
```typescript
export type CatchupChannel =
  | 'briefing'
  | 'insights'
  | 'recap'
  | 'learning'
  | 'entitlement'
  | 'gmail-sync'
  | 'calendar-sync'
  | 'knowledge-folder-sweep'
  | 'whatsapp-retention-sweep';
```
Phase 21 appends `| 'whatsapp-digest'` as the last member. This must be the **Wave 0 first task** — TypeScript will refuse to compile `pendingCatchup.add('whatsapp-digest')` until this union is extended.

---

### `src/main/index.ts` — bootstrap + `runChannelOnce` + module-scope handle (config/bootstrap)

**Analog:** `src/main/index.ts` lines 617–623, 869–882, and ~line 590

**Import pattern** (line 82 — existing `startWhatsAppRetention` import to extend):
```typescript
import { startWhatsAppRetention } from './whatsapp/retention';
// Phase 21 adds:
import { startWhatsAppDigest } from './whatsapp/digest-cron';
```

**Module-scope handle variable** (near line 590 — mirror `whatsAppManager`):
```typescript
// Existing (implicit in context, whatsAppManager declared module-scope):
const waDb = dbHolder.db!;
whatsAppManager = new WhatsAppSessionManager({ ... });

// Phase 21 adds adjacent module-scope let:
let _digestHandle: import('./whatsapp/digest-cron').WhatsAppDigestHandle | null = null;
```

**Bootstrap block** (lines 617–623 — confirmed verbatim, insert immediately after line 623):
```typescript
// Existing:
startWhatsAppRetention({
  db: waDb,
  logger,
  scheduler,
  dbHolder,
});
// Phase 21 inserts immediately after:
_digestHandle = startWhatsAppDigest({
  db: waDb,
  logger,
  scheduler,
  dbHolder,
});
```

**`runChannelOnce` stub** (lines 869–882, confirmed verbatim — this is a NO-OP for all channels):
```typescript
async function runChannelOnce(
  chan: CatchupChannel,
  _db: import('./db/connect').Db,
  logger: import('pino').Logger,
): Promise<void> {
  logger.info({ scope: 'catchup', channel: chan }, 'catchup run starting');
  // V1: ... no-op ... await Promise.resolve();
  await Promise.resolve();
  logger.info({ scope: 'catchup', channel: chan }, 'catchup run complete');
}
```
Phase 21 replaces `await Promise.resolve()` with a real switch:
```typescript
switch (chan) {
  case 'whatsapp-digest':
    if (_digestHandle) await _digestHandle.runNow();
    break;
  default:
    await Promise.resolve();
}
```

**Unlock drain** (lines 741–766 — no changes needed, the drain already iterates channels and calls `runChannelOnce`):
```typescript
registerOnUnlock(async (db) => {
  const channels = pendingCatchup.drain();
  if (channels.length === 0) {
    _trayHandle?.clearBadge();
    return;
  }
  for (const chan of channels) {
    try {
      await runChannelOnce(chan, db, logger);  // ← real dispatch added here
    } catch (err) { ... }
  }
  _trayHandle?.clearBadge();
  ...
});
```

---

### `src/main/lifecycle/powerMonitor.ts` — D-07.2 missed-tick resume hook (middleware, event-driven)

**Analog:** `src/main/lifecycle/powerMonitor.ts` — `registerLifecycleCallbacks` (lines 32–45, confirmed verbatim)

**`registerLifecycleCallbacks` signature** (lines 22–45):
```typescript
export interface LifecycleCallbacks {
  onSuspend?: () => void;
  onResume?: () => void;
}

export function registerLifecycleCallbacks(cbs: LifecycleCallbacks): () => void {
  if (cbs.onSuspend) onSuspendCallbacks.push(cbs.onSuspend);
  if (cbs.onResume) onResumeCallbacks.push(cbs.onResume);
  return () => {
    // ... splice out callbacks on unregister
  };
}
```

**Phase 21 usage** (call from `index.ts` after `_digestHandle` is assigned):
```typescript
registerLifecycleCallbacks({
  onResume: () => {
    // D-07.2: missed-tick check on wake-from-sleep.
    // Only fires if digest wasn't already run today.
    if (!_digestHandle) return;
    const db = dbHolder.db;
    if (!db) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const row = db.prepare(
        `SELECT MAX(date) AS maxDate FROM whatsapp_group_digest`
      ).get() as { maxDate: string | null } | undefined;
      if (!row?.maxDate || row.maxDate < today) {
        void _digestHandle.runNow();
      }
    } catch {
      /* best-effort — never block resume */
    }
  },
});
```

---

### `src/shared/ipc-contract.ts` — `BriefingPayload.whatsApp` + `WhatsAppGroupSummaryDto` (model/contract)

**Analog:** `src/shared/ipc-contract.ts` lines 535–557 + 1743–1748

**`BriefingPayload.thisWeekInsights` field declaration** (lines 548–557, confirmed verbatim):
```typescript
/**
 * Plan 08-01 — "This week" insights section. Populated by the BRIEFING_TODAY
 * read path (NOT by runBriefing). One of:
 *   - { state: 'unlocked', rows: [...] } — up to 3 insight rows for current week
 *   - { state: 'locked', daysRemaining, blockedKinds } — 14d gate not yet met
 *   - undefined — empty-unlocked (between cron fires; section omitted)
 */
thisWeekInsights?:
  | { state: 'unlocked'; rows: BriefingInsightRow[] }
  | { state: 'locked'; daysRemaining: number; blockedKinds: InsightKindDto[] };
```

**New field to add immediately after `thisWeekInsights`** (after line 557, inside `BriefingPayload`):
```typescript
/**
 * Phase 21 — WhatsApp group digest section. Populated by the BRIEFING_TODAY
 * read path (NOT by runBriefing — frontier isolation D-11). One of:
 *   - { state: 'ready'; groups: WhatsAppGroupSummaryDto[]; connection? } — digest available
 *   - { state: 'unavailable'; reason: 'model-offline'; connection? } — Ollama was down
 *   - undefined — not linked, zero tracked groups, or all groups sub-threshold
 */
whatsApp?:
  | { state: 'ready'; groups: WhatsAppGroupSummaryDto[]; connection?: 'degraded' | 'needs-auth' }
  | { state: 'unavailable'; reason: 'model-offline'; connection?: 'degraded' | 'needs-auth' };
```

**`WhatsAppStatusDto` enum** (lines 1743–1748, confirmed verbatim — the status values to reuse):
```typescript
export const WhatsAppStatusDto = _z_wa.object({
  status: _z_wa.enum(['ok', 'degraded', 'needs-auth', 'disconnected']),
  accountId: _z_wa.string().nullable(),
  displayNumber: _z_wa.string().nullable(),
});
```
The `connection?` field on `whatsApp` uses the `'degraded' | 'needs-auth'` subset of this enum. Read from `provider_account.status` DB column directly (not via IPC); `provider_account` CHECK constraint uses the same values.

**`WhatsAppGroupSummaryDto` new interface to add** (near `WhatsAppStatusDto` region or adjacent to `BriefingInsightRow`):
```typescript
/** Per-group inner sub-state inside BriefingPayload.whatsApp.groups (D-09). */
export interface WhatsAppGroupSummaryDto {
  jid: string;
  displayName: string;
  state:
    | 'summarized'    // digest row exists with non-NULL summary_text
    | 'no-activity'   // no digest row for today (sub-threshold or not yet run)
    | 'failed';       // digest row exists but summary_text = NULL (Ollama failed per-group)
  summaryText?: string; // present only when state = 'summarized'
}
```

---

### `src/renderer/features/briefing/BriefingScreen.tsx` — WhatsApp section render switch (component, request-response)

**Analog:** `src/renderer/features/briefing/BriefingScreen.tsx` lines 661–725

**`thisWeekInsights` render switch to mirror** (lines 661–725, confirmed verbatim):
```tsx
{payload.thisWeekInsights?.state === 'locked' && (
  <section data-testid="briefing-insights-locked" data-aria-cascade="4" style={{ marginBottom: 28 }}>
    <SectionHead>This week</SectionHead>
    <p style={{ fontSize: 13.5, color: 'var(--gray)', fontStyle: 'italic', margin: 0 }}>
      Insights unlock in <strong>{payload.thisWeekInsights.daysRemaining}</strong>{' '}
      day{payload.thisWeekInsights.daysRemaining === 1 ? '' : 's'}.
    </p>
  </section>
)}

{payload.thisWeekInsights?.state === 'unlocked' &&
  payload.thisWeekInsights.rows.length > 0 && (
    <section data-testid="briefing-insights" data-aria-cascade="4" style={{ marginBottom: 36 }}>
      <SectionHead>This week</SectionHead>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {payload.thisWeekInsights.rows.slice(0, 3).map((r) => (
          <li key={r.id} data-testid={`briefing-insight-${r.kind}`} ...>
            ...
          </li>
        ))}
      </ul>
    </section>
  )}
```

**WhatsApp section pattern to follow** (pure switch over the union, insert after the `thisWeekInsights` block around line 725):
```tsx
{/* Phase 21 — WhatsApp group digest section */}
{payload.whatsApp?.state === 'unavailable' && (
  <section data-testid="briefing-whatsapp-unavailable" style={{ marginBottom: 28 }}>
    <SectionHead>WhatsApp</SectionHead>
    <p style={{ fontSize: 13.5, color: 'var(--gray)', fontStyle: 'italic', margin: 0 }}>
      Digest unavailable — the local model was offline this morning. Aria will retry tonight.
    </p>
    {/* D-10 Generate-now retry affordance — mirrors RecapScreen pattern */}
    {/* Calls a NEW WHATSAPP_GENERATE_DIGEST_NOW IPC, NOT briefingGenerateNow */}
    <DigestGenerateNowAffordance connection={payload.whatsApp.connection} />
  </section>
)}
{payload.whatsApp?.state === 'ready' && payload.whatsApp.groups.length > 0 && (
  <section data-testid="briefing-whatsapp" style={{ marginBottom: 36 }}>
    <SectionHead>WhatsApp</SectionHead>
    {payload.whatsApp.groups.map((g) => (
      <WhatsAppGroupSection key={g.jid} group={g} />
    ))}
  </section>
)}
```

**`GenerateNowAffordance` retry button pattern** (`src/renderer/features/briefing/GenerateNowAffordance.tsx` lines 26–44):
```typescript
export function GenerateNowAffordance({ onDone }: { onDone: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onClick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = (await window.aria.briefingGenerateNow()) as { ok?: boolean; error?: string; };
      if (result?.ok) { onDone(); } else { setError(result?.error ?? 'unknown'); }
    } finally {
      setBusy(false);
    }
  }
  // ...
}
```
**CRITICAL:** The WhatsApp retry affordance must call a **new IPC channel** (e.g. `window.aria.whatsAppGenerateDigestNow()`) — it must NOT call `briefingGenerateNow()`, which regenerates the entire briefing. The structure of the component is identical to `GenerateNowAffordance` with only the IPC call swapped.

---

### `tests/unit/main/whatsapp/digest-cron.spec.ts` (test)

**Analog:** `tests/unit/main/whatsapp/whatsapp-retention.spec.ts`

**In-memory DB + migration setup pattern** (lines 79–91):
```typescript
describe('...', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-retention');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });

    // Seed a tracked group:
    db.prepare(
      `INSERT INTO whatsapp_group (jid, display_name, member_count, tracked) VALUES (?, ?, ?, ?)`
    ).run('test-group@g.us', 'Test Group', 3, 1);
  });
```

**Logger mock pattern** (line 109):
```typescript
const loggerMock = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
};
```

**`vi.fn()` mock-seam pattern for LLM injection** (from `ask.spec.ts` and retention spec pattern):
```typescript
const mockGenerateText = vi.fn().mockResolvedValue({ text: '### KEY POINTS\n- Point A\n### DECISIONS\n(nothing to report)\n### OPEN QUESTIONS\n(nothing to report)\n### MENTIONS\n(nothing to report)' });
const mockGetLocalModel = vi.fn().mockReturnValue({});

const handle = startWhatsAppDigest({
  db,
  logger: loggerMock as never,
  scheduler: null as never,
  dbHolder: null as never,
  generateTextFn: mockGenerateText,
  getLocalModelFn: mockGetLocalModel,
});
```

**Key test cases to cover:**
- `runNow()` writes a `whatsapp_group_digest` row with non-NULL `summary_text` (WA-08/D-06)
- `generateText` throws → row written with `summary_text=NULL` (WA-10/Pitfall 2)
- Re-running `runNow()` on a NULL row overwrites it (D-06/Pitfall 3 — `INSERT OR REPLACE`)
- `dbHolder.db === null` at cron tick → `pendingCatchup.has('whatsapp-digest')` is true (D-07.1)
- Partial failure: first group succeeds, second group's `generateText` throws → first row non-NULL, second row NULL (D-09)

---

### `tests/unit/main/ipc/briefing-whatsapp-enrichment.spec.ts` (test)

**Analog:** `tests/unit/main/ipc/briefing-regenerate.spec.ts`

**`makeStubIpcMain` pattern** (lines 24–37):
```typescript
function makeStubIpcMain() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle: (channel: string, h: Handler) => handlers.set(channel, h),
      removeHandler: (channel: string) => handlers.delete(channel),
    },
    invoke: (channel: string, payload?: unknown) => {
      const h = handlers.get(channel);
      if (!h) throw new Error(`no handler for ${channel}`);
      return h({}, payload);
    },
  };
}
```

**`setupModules` / `vi.doMock('electron', ...)` pattern** (lines 39–66 — avoids importing Electron in Vitest):
```typescript
async function setupModules(dataDir: string) {
  vi.resetModules();
  vi.doMock('electron', () => ({
    app: {
      isReady: () => true,
      whenReady: () => Promise.resolve(),
      getPath: () => dataDir,
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, ''),
      getSelectedStorageBackend: () => 'keychain',
    },
  }));
  const briefingIpc = await import('../../../../src/main/ipc/briefing');
  const { CHANNELS } = await import('../../../../src/shared/ipc-contract');
  return { briefingIpc, CHANNELS };
}
```

**Key test cases to cover** (WA-08/WA-10/D-10 state matrix):
- No `provider_account` row → `payload.whatsApp` is `undefined`
- `provider_account` exists, zero tracked groups → `undefined`
- Tracked group, digest row with `summary_text='...'` → `state: 'ready'`, `groups[0].state='summarized'`
- Tracked group, digest row with `summary_text=NULL` → `state: 'unavailable'`, `reason: 'model-offline'`
- Tracked group, no digest row for today → `state: 'unavailable'`
- `provider_account.status='degraded'` → `connection: 'degraded'` on the union arm
- `BRIEFING_TODAY` never throws even when `readWhatsAppDigests` throws (D-07.3 resilience)

---

### `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx` (extend existing file)

**Analog:** self — use existing `makePayload` + `installAria` helpers (lines 24–64, confirmed verbatim)

**`makePayload` override pattern** (lines 38–64):
```typescript
function makePayload(over: Partial<BriefingPayload> = {}): BriefingPayload {
  return {
    date: '2026-05-20',
    generatedAt: '2026-05-20T07:00:00.000Z',
    tz: 'UTC',
    calendar: [...],
    email: [...],
    news: [...],
    errors: {},
    route: 'FRONTIER',
    reason: 'generic-source-frontier-active',
    model: 'claude-sonnet-4-5',
    ...over,  // ← spread override here — whatsApp field added via over
  };
}
```

**Test cases to add** (extend existing `describe('BriefingScreen', ...)` block):
```typescript
it('Phase 21 — whatsApp.state=ready → renders briefing-whatsapp section', async () => {
  installAria(makePayload({
    whatsApp: {
      state: 'ready',
      groups: [{ jid: 'g1@g.us', displayName: 'Team Leads', state: 'summarized', summaryText: '### KEY POINTS\n- Shipped v1' }],
    },
  }));
  render(<BriefingScreen />);
  expect(await screen.findByTestId('briefing-whatsapp')).toBeTruthy();
});

it('Phase 21 — whatsApp.state=unavailable → renders unavailable note + retry button', async () => {
  installAria(makePayload({
    whatsApp: { state: 'unavailable', reason: 'model-offline' },
  }));
  render(<BriefingScreen />);
  expect(await screen.findByTestId('briefing-whatsapp-unavailable')).toBeTruthy();
  // assert retry button exists (data-testid to be defined by planner)
});

it('Phase 21 — whatsApp=undefined → WhatsApp section absent', async () => {
  installAria(makePayload()); // no whatsApp field
  render(<BriefingScreen />);
  await screen.findByTestId('briefing-section-calendar');
  expect(screen.queryByTestId('briefing-whatsapp')).toBeNull();
  expect(screen.queryByTestId('briefing-whatsapp-unavailable')).toBeNull();
});
```

---

## Shared Patterns

### Seal-Guard + pendingCatchup
**Source:** `src/main/whatsapp/retention.ts` lines 144–153
**Apply to:** `src/main/whatsapp/digest-cron.ts` (cron callback body)
```typescript
const task: ScheduledTask = nodeCron.schedule(cronExpr, () => {
  const dbRef = deps.dbHolder?.db;
  if (deps.dbHolder && !dbRef) {
    pendingCatchup.add(CRON_KEY);  // CRON_KEY = 'whatsapp-digest'
    trayBus.setBadge();
    return;
  }
  void runDigest(deps);  // fire-and-forget; errors logged inside runDigest
});
```

### Degraded-Payload / Never-Throw Resilience
**Source:** `src/main/briefing/generate.ts` lines 544–574
**Apply to:** `readWhatsAppDigests` helper in `briefing.ts`, per-group error catch in `digest-cron.ts`

The pattern: wrap every fallible operation in try/catch → return a degraded data state, never re-throw to caller. Errors become `state: 'unavailable'` or NULL `summary_text` rows, not exceptions.

```typescript
// generate.ts lines 544-574 — model-acquire failure shape:
} catch (err) {
  logger.warn({ scope: 'briefing', err: describeErr(err) }, 'model factory failed');
  const reason = `${decision.reason} | model-acquire-failed:${describeErr(err)}`;
  const degraded = degradedPayload({ ... });
  safeUpsert(db, logger, degraded, decision, 0, 0);
  return degraded;  // ← always returns, never throws
}
```

### Injectable Test Seams (LLM functions)
**Source:** `src/main/ipc/ask.ts` lines 47–66
**Apply to:** `src/main/whatsapp/digest-cron.ts` `WhatsAppDigestDeps` interface
```typescript
// Pattern: optional overrides on Deps interface + ?? fallback at use-site
const localModelFactory = deps.getLocalModelFn ?? getLocalModel;
const gen = deps.generateTextFn ?? generateText;
```

### Discriminated-Union Section State
**Source:** `src/shared/ipc-contract.ts` lines 548–557 (`thisWeekInsights`)
**Apply to:** `BriefingPayload.whatsApp` new field + renderer switch
```typescript
// Convention: optional field, undefined = omit section entirely
// State arms are explicit discriminated unions, NOT nullable plain objects
thisWeekInsights?:
  | { state: 'unlocked'; rows: BriefingInsightRow[] }
  | { state: 'locked'; daysRemaining: number; blockedKinds: InsightKindDto[] };
```

### Briefing IPC Try/Catch Enrichment
**Source:** `src/main/ipc/briefing.ts` lines 239–244
**Apply to:** Every new enrichment block in `BRIEFING_TODAY` handler
```typescript
} catch (err) {
  logger.warn(
    { scope: 'briefing-today-<subsystem>', err: (err as Error).message },
    'failed to enrich briefing with <subsystem>',
  );
}
// no re-throw — enrichment failure degrades gracefully, briefing still returns
```

### cronRegistry Registration (no-bare-cron ratchet)
**Source:** `src/main/whatsapp/retention.ts` lines 156–159
**Apply to:** `src/main/whatsapp/digest-cron.ts` factory function
```typescript
if (deps.scheduler) {
  deps.scheduler.cronRegistry.set(CRON_KEY, task);
}
// And in stop():
if (deps.scheduler) deps.scheduler.cronRegistry.delete(CRON_KEY);
```

---

## No Analog Found

All files have close matches. No entries.

---

## Critical Warnings for Planner

1. **`runChannelOnce` is a documented no-op stub** (lines 869–882). Phase 21 MUST add a real `case 'whatsapp-digest':` branch. Without it, the unlock drain logs "starting/complete" but the digest never actually runs. The `_digestHandle` module-scope variable must be in scope for the switch.

2. **No-frontier ratchet boundary:** `digest-cron.ts` must live under `src/main/whatsapp/`. The existing ratchet at `tests/unit/main/whatsapp/no-frontier.ratchet.spec.ts` scans `src/main/whatsapp/**` — placement anywhere else silently removes frontier enforcement.

3. **`CatchupChannel` union must be extended before `digest-cron.ts` is written.** Sequence: extend `pendingCatchup.ts` union first (Wave 0 task 1), then write `digest-cron.ts`. Otherwise TypeScript will refuse to compile `pendingCatchup.add('whatsapp-digest')`.

4. **`INSERT OR REPLACE`, not `INSERT OR IGNORE`.** A prior failed run leaves a row with `summary_text=NULL`. `INSERT OR IGNORE` silently skips the retry, keeping the NULL row. The retry affordance (D-10) requires `INSERT OR REPLACE` to overwrite the failed row.

5. **The WhatsApp retry button must call a new IPC channel**, not `briefingGenerateNow()`. `GenerateNowAffordance` calls `window.aria.briefingGenerateNow()` which regenerates the entire briefing. The WhatsApp retry must call only the digest generation IPC (e.g. `window.aria.whatsAppGenerateDigestNow()`).

6. **`sent_at` is stored as ISO 8601 strings despite `INTEGER` column declaration** (migration 138 discrepancy confirmed). All window queries must use ISO string comparisons (`datetime('now', '-3 days')` returns ISO string in SQLite); do not mix with Unix integer comparisons.

---

## Metadata

**Analog search scope:** `src/main/whatsapp/`, `src/main/ipc/`, `src/main/lifecycle/`, `src/main/llm/`, `src/main/briefing/`, `src/shared/`, `src/renderer/features/briefing/`, `tests/unit/main/whatsapp/`, `tests/unit/main/ipc/`, `tests/unit/renderer/features/briefing/`
**Files scanned:** 15 analog files read directly
**Pattern extraction date:** 2026-06-10

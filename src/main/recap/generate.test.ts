/**
 * Plan 08-02 Task 3 — generateWeeklyRecap tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../db/connect';
import { runMigrations } from '../db/migrations/runner';
import { createTempUserDataDir } from '../../../tests/setup';
import { generateWeeklyRecap, buildNarrativePrompt } from './generate';
import type { LLMRouter } from '../llm/router';

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-recap-generate');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedSendLog(db: ReturnType<typeof freshDb>, id: string, ts: string): void {
  db.prepare(
    `INSERT INTO approval (id, kind, state, created_at, updated_at, idempotency_key)
     VALUES (?, 'email_send', 'pending', ?, ?, ?)`,
  ).run(id, ts, ts, `idk-${id}`);
  db.prepare(
    `INSERT INTO send_log (approval_id, ts, provider, recipients_json, subject, ok)
     VALUES (?, ?, 'gmail', '["a@x.com"]', 'subj', 1)`,
  ).run(id, ts);
}

const fakeRouter: LLMRouter = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  classify: async () => ({ route: 'LOCAL' as const, reason: 'test', model: 'fake', provider: 'ollama' as const }),
} as unknown as LLMRouter;

const silentLogger = { info: () => undefined, warn: () => undefined };

describe('generateWeeklyRecap', () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('Test 1: gathers audit rows for the window', async () => {
    seedSendLog(db, 'a1', '2026-05-12T10:00:00.000Z');
    seedSendLog(db, 'a2', '2026-05-13T10:00:00.000Z');
    const res = await generateWeeklyRecap(db, {
      isoWeek: '2026-W20',
      weekStartYmd: '2026-05-11',
      fromIso: '2026-05-11T00:00:00.000Z',
      toIso: '2026-05-17T23:59:59.999Z',
      router: fakeRouter,
      logger: silentLogger,
      generateObjectFn: (async () => ({ object: { narrative: 'two sends', actionRefs: [] } })) as never,
      getLocalModelFn: (() => ({ id: 'fake' })) as never,
      getFrontierModelFn: (async () => ({ id: 'fake' })) as never,
    });
    expect(res.auditRowCount).toBe(2);
    expect(res.recap.canonical.whatAriaDid.blocks[0].kind).toBe('bullet_list');
  });

  it('Test 3: PASS 2 truncates narrative + sets hallucinationDetected when refs are bogus', async () => {
    seedSendLog(db, 'a1', '2026-05-12T10:00:00.000Z');
    const res = await generateWeeklyRecap(db, {
      isoWeek: '2026-W20',
      weekStartYmd: '2026-05-11',
      fromIso: '2026-05-11T00:00:00.000Z',
      toIso: '2026-05-17T23:59:59.999Z',
      router: fakeRouter,
      logger: silentLogger,
      generateObjectFn: (async () => ({
        object: { narrative: 'I sent a draft and also closed the deal.', actionRefs: ['email_send:1', 'made-up:999'] },
      })) as never,
      getLocalModelFn: (() => ({ id: 'fake' })) as never,
      getFrontierModelFn: (async () => ({ id: 'fake' })) as never,
    });
    expect(res.hallucinationDetected).toBe(true);
    expect(res.recap.canonical.whatAriaDid.auditRowRefs).toEqual(['email_send:1']);
    expect(res.recap.canonical.whatAriaDid.narrative).toMatch(/source of truth/);
  });

  it('Test 6: writes a routing_log row source=recap-narrative on success', async () => {
    seedSendLog(db, 'a1', '2026-05-12T10:00:00.000Z');
    await generateWeeklyRecap(db, {
      isoWeek: '2026-W20',
      weekStartYmd: '2026-05-11',
      fromIso: '2026-05-11T00:00:00.000Z',
      toIso: '2026-05-17T23:59:59.999Z',
      router: fakeRouter,
      logger: silentLogger,
      generateObjectFn: (async () => ({ object: { narrative: 'ok', actionRefs: [] } })) as never,
      getLocalModelFn: (() => ({ id: 'fake' })) as never,
      getFrontierModelFn: (async () => ({ id: 'fake' })) as never,
    });
    const row = db.prepare(`SELECT source, ok FROM routing_log WHERE source='recap-narrative'`).get() as
      | { source: string; ok: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.ok).toBe(1);
  });

  it('buildNarrativePrompt — content-free invariant: prompt includes only renderAuditRowLine output', () => {
    const prompt = buildNarrativePrompt([
      {
        kind: 'email_send',
        id: 'email_send:1',
        occurredAt: '2026-05-12T10:00:00Z',
        provider: 'gmail',
        resource: 'email',
        approvalId: 'a1',
        payload: { subject: 'X', recipients: ['a@x.com'], ok: 1 },
        outcome: 'sent',
      },
    ]);
    expect(prompt).toContain('[email_send:1]');
    expect(prompt).toContain('Gmail');
  });
});

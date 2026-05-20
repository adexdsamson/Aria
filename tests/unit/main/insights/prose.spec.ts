/**
 * Plan 08-01 Task 4 — insightProse tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import { insightProse, buildProsePrompt } from '../../../../src/main/insights/prose';
import type { InsightPayload } from '../../../../src/main/insights/schema';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-insight-prose');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function fakeRouter(route: 'LOCAL' | 'FRONTIER' = 'LOCAL') {
  return {
    classify: vi.fn().mockResolvedValue({
      route,
      reason: 'test',
      model: route === 'LOCAL' ? 'ollama-test' : 'claude-test',
      provider: route === 'LOCAL' ? 'ollama' : 'anthropic',
    }),
  } as unknown as Parameters<typeof insightProse>[1]['router'];
}

const SAMPLE_PAYLOAD: InsightPayload = {
  kind: 'calendar_load',
  meetingHoursThisWeek: 18,
  meetingHoursLastWeek: 12,
  deltaPct: 50,
  focusBlockCount: 4,
};

describe('insightProse', () => {
  let db: ReturnType<typeof freshDb>;
  const logger = { info: () => {}, warn: () => {} };

  beforeEach(() => { db = freshDb(); });
  afterEach(() => { closeDb(db); });

  it('returns 1–3 sentences via generateObject (mocked) and writes one routing_log row', async () => {
    const gen = vi.fn().mockResolvedValue({
      object: { sentences: ['Calendar is up 50% week-over-week.', 'You have 4 focus blocks.'] },
    });
    const factory = vi.fn().mockResolvedValue({} as never);
    const out = await insightProse(SAMPLE_PAYLOAD, {
      router: fakeRouter(),
      logger,
      db,
      generateObjectFn: gen as never,
      getLocalModelFn: factory as never,
      getFrontierModelFn: factory as never,
    });
    expect(out.sentences.length).toBeGreaterThanOrEqual(1);
    expect(out.sentences.length).toBeLessThanOrEqual(3);
    expect(gen).toHaveBeenCalled();

    const row = db.prepare(`SELECT route, source, prompt_hash, ok FROM routing_log ORDER BY id DESC LIMIT 1`).get() as
      | { route: string; source: string; prompt_hash: string; ok: number }
      | undefined;
    expect(row?.source).toBe('generic');
    expect(row?.ok).toBe(1);
    expect(row?.prompt_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('truncates oversized sentences to 220 chars', async () => {
    const long = 'X'.repeat(500);
    const gen = vi.fn().mockResolvedValue({ object: { sentences: [long] } });
    const out = await insightProse(SAMPLE_PAYLOAD, {
      router: fakeRouter(),
      logger,
      db,
      generateObjectFn: gen as never,
      getLocalModelFn: (() => ({}) as never) as never,
      getFrontierModelFn: (async () => ({}) as never) as never,
    });
    expect(out.sentences[0]!.length).toBeLessThanOrEqual(220);
  });

  it('falls back to placeholder + ok=0 routing_log when generateObject throws', async () => {
    const gen = vi.fn().mockRejectedValue(new Error('boom'));
    const out = await insightProse(SAMPLE_PAYLOAD, {
      router: fakeRouter('FRONTIER'),
      logger,
      db,
      generateObjectFn: gen as never,
      getLocalModelFn: (() => ({}) as never) as never,
      getFrontierModelFn: (async () => ({}) as never) as never,
    });
    expect(out.sentences.length).toBeGreaterThanOrEqual(1);
    const row = db.prepare(`SELECT ok FROM routing_log ORDER BY id DESC LIMIT 1`).get() as { ok: number };
    expect(row.ok).toBe(0);
  });

  it('buildProsePrompt never includes raw email/calendar strings', () => {
    const prompt = buildProsePrompt({
      kind: 'response_time',
      medianMinutesThisWeek: 30,
      medianMinutesLastWeek: 60,
      deltaMinutes: -30,
      perPersonTop3: [{ contactEmail: 'evil@example.com', medianMinutes: 5 }],
    });
    // Local-part is masked to "someone@"
    expect(prompt).not.toContain('evil@example.com');
    expect(prompt).toContain('someone@example.com');
  });
});

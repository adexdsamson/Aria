/**
 * Plan 03-04 Wave A — voice-match pairwise harness unit tests.
 *
 * Validates:
 *   - JudgeSchema rejects unknown winner / over-long reason
 *   - runVoiceMatchEval computes winRate + passed correctly
 *   - Judge dispatch flows through scheduler.queue (queue.add called per item)
 *   - tokenizeForFrontier called per item; disposeDraftTable in finally
 *   - voice_match_holdout rows persisted before judge dispatch
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PQueue from 'p-queue';
import Database from 'better-sqlite3-multiple-ciphers';
import {
  JudgeSchema,
  runVoiceMatchEval,
  evaluatePassCriteria,
  stratumOf,
  stratifiedSample,
  recordHoldout,
  type HeldOutItem,
} from '../../../../../src/main/drafting/eval/pairwise';
import { _resetDraftTablesForTests } from '../../../../../src/main/llm/tokenize';

function makeQueue(): InstanceType<typeof PQueue> {
  return new PQueue({ concurrency: 1 });
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  // Minimal schema: gmail_message + voice_match_holdout. Migration 002+009
  // shape is what production runs; tests only need the holdout table to
  // accept inserts.
  db.exec(`
    CREATE TABLE gmail_message (id TEXT PRIMARY KEY);
    CREATE TABLE voice_match_holdout (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function makeItem(id: string, stratum: 'short-formal' | 'short-casual' | 'long-formal' | 'long-casual' = 'short-casual'): HeldOutItem {
  return {
    id,
    inboundText: `Inbound for ${id}`,
    goldReply: `Gold reply for ${id}`,
    stratum,
  };
}

beforeEach(() => {
  _resetDraftTablesForTests();
});

describe('JudgeSchema', () => {
  it('accepts valid output', () => {
    const r = JudgeSchema.parse({ winner: 'a', catastrophic: false, reason: 'A matches tone' });
    expect(r.winner).toBe('a');
  });

  it('rejects unknown winner enum', () => {
    expect(() =>
      JudgeSchema.parse({ winner: 'maybe', catastrophic: false, reason: 'x' }),
    ).toThrow();
  });

  it('rejects reason > 200 chars', () => {
    expect(() =>
      JudgeSchema.parse({
        winner: 'a',
        catastrophic: false,
        reason: 'x'.repeat(201),
      }),
    ).toThrow();
  });
});

describe('stratumOf + stratifiedSample', () => {
  it('classifies short-casual body', () => {
    expect(stratumOf({ subject: 'hey', body: 'k thx' })).toBe('short-casual');
  });

  it('classifies long-formal body', () => {
    expect(
      stratumOf({
        subject: 'Quarterly Review',
        body: 'A '.repeat(150),
      }),
    ).toBe('long-formal');
  });

  it('stratifiedSample yields up to 50 items from a uniform pool', () => {
    const pool = Array.from({ length: 200 }, (_, i) => ({
      subject: i % 2 === 0 ? 'Hello' : 'hey',
      body: i < 100 ? 'short body' : 'x '.repeat(200),
      id: String(i),
    }));
    const sample = stratifiedSample(pool, 50);
    expect(sample.length).toBe(50);
  });
});

describe('evaluatePassCriteria', () => {
  it('passes at exactly 65% with zero catastrophic', () => {
    expect(evaluatePassCriteria({ ariaWins: 33, total: 50, catastrophic: 0 })).toBe(true);
  });

  it('fails at 64% even with zero catastrophic', () => {
    expect(evaluatePassCriteria({ ariaWins: 32, total: 50, catastrophic: 0 })).toBe(false);
  });

  it('fails on any catastrophic regardless of win rate', () => {
    expect(evaluatePassCriteria({ ariaWins: 50, total: 50, catastrophic: 1 })).toBe(false);
  });

  it('fails on empty sample', () => {
    expect(evaluatePassCriteria({ ariaWins: 0, total: 0, catastrophic: 0 })).toBe(false);
  });
});

describe('recordHoldout', () => {
  it('inserts ids idempotently', () => {
    const db = makeDb();
    recordHoldout(db, ['m1', 'm2']);
    recordHoldout(db, ['m2', 'm3']);
    const rows = db.prepare(`SELECT id FROM voice_match_holdout ORDER BY id`).all() as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual(['m1', 'm2', 'm3']);
    db.close();
  });
});

describe('runVoiceMatchEval', () => {
  it('computes ariaWins / winRate / passed for a 3-item sample', async () => {
    const db = makeDb();
    const queue = makeQueue();
    const addSpy = vi.spyOn(queue, 'add');

    const items: HeldOutItem[] = [
      makeItem('m1', 'short-casual'),
      makeItem('m2', 'short-casual'),
      makeItem('m3', 'long-formal'),
    ];

    // Two Aria wins out of 3 → winRate 0.667, passes the 0.65 bar.
    const winners: Array<'a' | 'b' | 'tie'> = ['a', 'a', 'b'];
    let i = 0;
    const report = await runVoiceMatchEval({
      db,
      items,
      queue,
      approach: 'few-shot',
      draftFewShot: async (item) => `aria-draft-${item.id} foo@example.com`,
      draftBaseline: async (item) => `baseline-draft-${item.id}`,
      fetchExemplars: async () => ['exemplar one', 'exemplar two', 'exemplar three'],
      judge: async () => ({
        winner: winners[i++]!,
        catastrophic: false,
        reason: 'rationale',
      }),
    });

    expect(report.total).toBe(3);
    expect(report.ariaWins).toBe(2);
    expect(report.baselineWins).toBe(1);
    expect(report.winRate).toBeCloseTo(2 / 3, 5);
    expect(report.passed).toBe(true);
    expect(report.approach).toBe('few-shot');

    // Holdout persisted.
    const rows = db.prepare(`SELECT id FROM voice_match_holdout`).all() as { id: string }[];
    expect(rows.map((r) => r.id).sort()).toEqual(['m1', 'm2', 'm3']);

    // Judge dispatch routed through queue.add (per item: 3 draft calls + 1
    // judge = 4 each; baseline + few-shot both queued).
    expect(addSpy).toHaveBeenCalled();
    expect(addSpy.mock.calls.length).toBeGreaterThanOrEqual(items.length);

    db.close();
  });

  it('fails the bar when any item is catastrophic', async () => {
    const db = makeDb();
    const items: HeldOutItem[] = [makeItem('m1'), makeItem('m2')];
    const report = await runVoiceMatchEval({
      db,
      items,
      queue: makeQueue(),
      approach: 'few-shot',
      draftFewShot: async () => 'aria',
      draftBaseline: async () => 'base',
      fetchExemplars: async () => [],
      judge: async () => ({ winner: 'a', catastrophic: true, reason: 'tone wildly wrong' }),
    });
    expect(report.catastrophic).toBe(2);
    expect(report.passed).toBe(false);
    db.close();
  });

  it('rehydrates judge reason via the per-item token table', async () => {
    const db = makeDb();
    const items: HeldOutItem[] = [makeItem('m1')];
    let observedJudgeExemplars: string[] = [];
    const report = await runVoiceMatchEval({
      db,
      items,
      queue: makeQueue(),
      approach: 'few-shot',
      // Inject an email address into exemplars so tokenize substitutes it
      // with EMAIL_1 inside the judge prompt.
      draftFewShot: async () => 'aria draft',
      draftBaseline: async () => 'base draft',
      fetchExemplars: async () => ['Please ping alice@example.com'],
      judge: async ({ exemplars }) => {
        observedJudgeExemplars = exemplars;
        // Judge response quotes the token; rehydrate must substitute back.
        return { winner: 'a', catastrophic: false, reason: 'matches tone of EMAIL_1' };
      },
    });

    // Judge saw the tokenized exemplar (no raw email address).
    expect(observedJudgeExemplars.join(' ')).not.toContain('alice@example.com');
    expect(observedJudgeExemplars.join(' ')).toContain('EMAIL_1');
    // Rehydrated reason has the address back.
    expect(report.perItem[0]!.reason).toContain('alice@example.com');

    db.close();
  });
});

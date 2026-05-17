/**
 * Plan 02-04 Task 1 — briefing + briefing_item_dismissed persistence tests.
 * Uses a real SQLCipher DB with migrations 001-005 applied.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  upsertBriefing,
  readBriefing,
  dismissNewsItem,
  isNewsItemDismissed,
  readBriefingHistory,
  hashFromUrl,
} from '../../../../src/main/briefing/persist';
import type { BriefingNewsItem } from '../../../../src/shared/ipc-contract';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb() {
  const dataDir = createTempUserDataDir('aria-briefing-persist');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('briefing/persist', () => {
  let db: ReturnType<typeof freshDb>;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    closeDb(db);
  });

  it('Case 1 — upsertBriefing inserts; readBriefing returns row with parsed sections', () => {
    const sections = {
      calendar: [{ id: 'c1', title: 'Sync', why: 'because' }],
      email: [{ id: 'm1', title: 'Re: deal', why: 'urgent' }],
      news: [],
      errors: {},
      reason: 'generic-source-frontier-active',
    };
    upsertBriefing(db, {
      date: '2026-05-20',
      generatedAt: '2026-05-20T07:00:00.000Z',
      tz: 'America/New_York',
      sections: JSON.stringify(sections),
      route: 'FRONTIER',
      model: 'claude-sonnet-4-5',
      latency_ms: 1234,
      ok: 1,
    });
    const payload = readBriefing(db, '2026-05-20');
    expect(payload).not.toBeNull();
    expect(payload!.date).toBe('2026-05-20');
    expect(payload!.calendar).toHaveLength(1);
    expect(payload!.calendar[0].title).toBe('Sync');
    expect(payload!.email[0].why).toBe('urgent');
    expect(payload!.route).toBe('FRONTIER');
    expect(payload!.model).toBe('claude-sonnet-4-5');
    expect(payload!.reason).toBe('generic-source-frontier-active');
  });

  it('Case 2 — upsertBriefing on same date replaces (idempotent)', () => {
    const baseRow = {
      date: '2026-05-20',
      generatedAt: '2026-05-20T07:00:00.000Z',
      tz: 'UTC',
      route: 'LOCAL' as const,
      model: 'llama3.1:8b-instruct-q4_K_M',
      latency_ms: 100,
      ok: 1 as const,
    };
    upsertBriefing(db, { ...baseRow, sections: '{"calendar":[],"email":[],"news":[]}' });
    upsertBriefing(db, {
      ...baseRow,
      sections: '{"calendar":[{"id":"x","title":"Replaced","why":"yes"}],"email":[],"news":[]}',
    });
    const count = (
      db.prepare("SELECT COUNT(*) AS n FROM briefing WHERE date = '2026-05-20'").get() as { n: number }
    ).n;
    expect(count).toBe(1);
    const payload = readBriefing(db, '2026-05-20');
    expect(payload!.calendar[0].title).toBe('Replaced');
  });

  it('Case 3 — dismissNewsItem is per-day; isNewsItemDismissed reflects it', () => {
    dismissNewsItem(db, { date: '2026-05-20', urlHash: 'abc' });
    expect(isNewsItemDismissed(db, '2026-05-20', 'abc')).toBe(true);
    expect(isNewsItemDismissed(db, '2026-05-21', 'abc')).toBe(false);
    // INSERT OR IGNORE — repeated dismiss same key is idempotent.
    dismissNewsItem(db, { date: '2026-05-20', urlHash: 'abc' });
    const count = (
      db
        .prepare("SELECT COUNT(*) AS n FROM briefing_item_dismissed WHERE date = '2026-05-20'")
        .get() as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  it('Case 4 — readBriefing populates news[i].dismissed by joining briefing_item_dismissed', () => {
    const news: BriefingNewsItem[] = [
      {
        id: 'hn-100',
        title: 'A',
        why: 'why-a',
        url: 'https://a.example/1',
        sourceKind: 'hn',
        dismissed: false,
      },
      {
        id: 'rss-deadbeef',
        title: 'B',
        why: 'why-b',
        url: 'https://b.example/2',
        sourceKind: 'rss',
        dismissed: false,
      },
    ];
    upsertBriefing(db, {
      date: '2026-05-20',
      generatedAt: '2026-05-20T07:00:00.000Z',
      tz: 'UTC',
      sections: JSON.stringify({ calendar: [], email: [], news, errors: {} }),
      route: 'LOCAL',
      model: 'llama3.1:8b-instruct-q4_K_M',
      latency_ms: 50,
      ok: 1,
    });
    // Dismiss the first by its candidate id (matches how renderer calls dismiss).
    dismissNewsItem(db, { date: '2026-05-20', urlHash: 'hn-100' });
    // And the second by url-derived hash.
    dismissNewsItem(db, { date: '2026-05-20', urlHash: hashFromUrl('https://b.example/2') });

    const out = readBriefing(db, '2026-05-20')!;
    expect(out.news[0].dismissed).toBe(true);
    expect(out.news[1].dismissed).toBe(true);

    // History helper returns the row.
    const hist = readBriefingHistory(db, 5);
    expect(hist).toHaveLength(1);
    expect(hist[0].date).toBe('2026-05-20');
    expect(hist[0].route).toBe('LOCAL');
    expect(hist[0].ok).toBe(1);
  });
});

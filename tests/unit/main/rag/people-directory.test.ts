import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDb } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  parseAddress,
  rebuildPeopleDirectory,
  resolvePersonMention,
  upsertPersonFromHeaders,
} from '../../../../src/main/rag/people-directory';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');
const FIXTURE = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../fixtures/rag/people-directory-10.json'), 'utf8'),
) as {
  people: Array<{
    id: string;
    canonicalEmail: string | null;
    displayName: string;
    aliases: string[];
  }>;
  cases: Array<{ question: string; expectedPersonId: string; ambiguous?: boolean }>;
};

function setupDb() {
  const dataDir = createTempUserDataDir('aria-people');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function seedGmailFromFixture(db: ReturnType<typeof setupDb>) {
  const now = '2026-05-15T10:00:00Z';
  for (const p of FIXTURE.people) {
    db.prepare(
      `INSERT INTO gmail_message (
         id, thread_id, from_addr, subject, snippet, received_at, label_ids,
         is_unread, is_important, history_id, fetched_at
       ) VALUES (?, ?, ?, 'subj', 'body', ?, '[]', 0, 0, NULL, ?)`,
    ).run(
      `msg-${p.canonicalEmail ?? p.id}`,
      `t-${p.canonicalEmail ?? p.id}`,
      `"${p.displayName}" <${p.canonicalEmail ?? `${p.id}@example.com`}>`,
      now,
      now,
    );
  }
}

describe('people-directory — Plan 07-02 Task 8 / REVIEWS C10', () => {
  let db: ReturnType<typeof setupDb>;

  beforeEach(() => {
    db = setupDb();
  });

  it('parseAddress handles display + bare-email forms', () => {
    expect(parseAddress('"Sarah Doe" <sarah@example.com>')).toEqual({
      email: 'sarah@example.com',
      display: 'Sarah Doe',
    });
    expect(parseAddress('sarah@example.com')).toEqual({
      email: 'sarah@example.com',
      display: null,
    });
    expect(parseAddress('garbage')).toBeNull();
  });

  it('10-case eval: ≥9/10 top-1 correct on the fixture', () => {
    seedGmailFromFixture(db);
    rebuildPeopleDirectory(db);
    let correct = 0;
    let ambiguousMatches = 0;
    for (const q of FIXTURE.cases) {
      // Extract the first capitalized token from the question as the mention
      // probe (the fixture in dual-purpose mode no longer ships a bare
      // \`mention\` field — the person-resolver test reads structured questions).
      const STOP = new Set(['What', 'Who', 'When', 'Where', 'Why', 'How', 'Did', 'Do', 'Does', 'Is', 'Are', 'Was', 'Were']);
      const tokens = [...q.question.matchAll(/\b([A-Z][a-zA-Z]+)\b/g)].map((m) => m[1]!);
      const mention = tokens.find((t) => !STOP.has(t)) ?? q.question;
      const res = resolvePersonMention(db, mention);
      if (q.ambiguous) {
        if (res.kind === 'ambiguous') {
          ambiguousMatches++;
          correct++;
        }
      } else if (res.kind === 'confident' && res.person.id === q.expectedPersonId) {
        correct++;
      }
    }
    expect(correct).toBeGreaterThanOrEqual(9);
    // Ambiguous case should sort by last_seen_at DESC, observed_count DESC.
    const ambig = resolvePersonMention(db, 'Alex');
    expect(ambig.kind).toBe('ambiguous');
  });

  it('upsertPersonFromHeaders is resolvable in the same tick (C10)', () => {
    upsertPersonFromHeaders(db, { from_addr: '"Brand New" <newbie@example.com>' });
    const res = resolvePersonMention(db, 'newbie@example.com');
    expect(res.kind).toBe('confident');
    if (res.kind === 'confident') {
      expect(res.person.canonicalEmail).toBe('newbie@example.com');
      expect(res.person.displayName).toBe('Brand New');
    }
  });

  it('exposes directoryStale=true when last rebuild is older than 24h', () => {
    seedGmailFromFixture(db);
    rebuildPeopleDirectory(db);
    // Stomp app_meta to 48h ago.
    const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    db.prepare(
      `UPDATE app_meta SET v = ? WHERE k = 'last_people_directory_rebuild_at'`,
    ).run(old);
    const res = resolvePersonMention(db, 'Sarah Doe');
    expect(res.directoryStale).toBe(true);
  });
});

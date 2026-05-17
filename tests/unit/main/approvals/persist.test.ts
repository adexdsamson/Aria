/**
 * Plan 03-01 Task 1 — approval persistence + crash-recovery sweep.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import { createTempUserDataDir } from '../../../setup';
import {
  insertApproval,
  transitionTo,
  listApprovals,
  reapInterruptedOnStartup,
  getApproval,
} from '../../../../src/main/approvals/persist';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-approvals-persist');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

describe('approvals/persist', () => {
  let db: Db;

  beforeEach(() => {
    db = freshDb();
  });

  afterEach(() => {
    closeDb(db);
  });

  it('insertApproval returns a uuid and persists default state pending', () => {
    const id = insertApproval(db, {
      kind: 'email_send',
      subject: 'Hi',
      recipients_json: JSON.stringify(['a@b.com']),
      body_original: 'hello',
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const row = getApproval(db, id);
    expect(row).not.toBeNull();
    expect(row!.state).toBe('pending');
    expect(row!.kind).toBe('email_send');
    expect(row!.subject).toBe('Hi');
    expect(row!.approval_path).toBe('explicit');
  });

  it('transitionTo throws on invalid transition (pending -> approved)', () => {
    const id = insertApproval(db, { kind: 'email_send' });
    expect(() => transitionTo(db, id, 'approved')).toThrow(/invalid-transition/);
    expect(getApproval(db, id)!.state).toBe('pending');
  });

  it('transitionTo accepts a valid chain pending->generating->ready->approved->sent and patches columns', () => {
    const id = insertApproval(db, { kind: 'email_send' });
    transitionTo(db, id, 'generating');
    transitionTo(db, id, 'ready', { body_original: 'drafted' });
    transitionTo(db, id, 'approved', { approval_path: 'explicit' });
    transitionTo(db, id, 'sent', { sent_at: '2026-05-20T00:00:00.000Z' });
    const row = getApproval(db, id)!;
    expect(row.state).toBe('sent');
    expect(row.body_original).toBe('drafted');
    expect(row.approval_path).toBe('explicit');
    expect(row.sent_at).toBe('2026-05-20T00:00:00.000Z');
  });

  it('reapInterruptedOnStartup converts generating rows to interrupted AND returns count', () => {
    const a = insertApproval(db, { kind: 'email_send', state: 'generating' });
    const b = insertApproval(db, { kind: 'email_send', state: 'generating' });
    const c = insertApproval(db, { kind: 'email_send', state: 'pending' });
    const count = reapInterruptedOnStartup(db);
    expect(count).toBe(2);
    expect(getApproval(db, a)!.state).toBe('interrupted');
    expect(getApproval(db, b)!.state).toBe('interrupted');
    expect(getApproval(db, c)!.state).toBe('pending');
  });

  it('listApprovals filters by states and orders by updated_at DESC', async () => {
    const a = insertApproval(db, { kind: 'email_send', state: 'pending' });
    await new Promise((r) => setTimeout(r, 5));
    const b = insertApproval(db, { kind: 'email_send', state: 'pending' });
    transitionTo(db, b, 'generating');
    const pending = listApprovals(db, { states: ['pending'] });
    expect(pending.map((r) => r.id)).toEqual([a]);
    const both = listApprovals(db, { states: ['pending', 'generating'] });
    expect(both.map((r) => r.id).sort()).toEqual([a, b].sort());
  });

  it('migration seeds approval_tier with email_send_general -> always-confirm', () => {
    const r = db
      .prepare(`SELECT tier FROM approval_tier WHERE content_class = ?`)
      .get('email_send_general') as { tier: string } | undefined;
    expect(r?.tier).toBe('always-confirm');
  });
});

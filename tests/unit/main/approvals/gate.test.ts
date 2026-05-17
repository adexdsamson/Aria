/**
 * Plan 03-01 Task 1 — assertApproved (the single send gate).
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
} from '../../../../src/main/approvals/persist';
import {
  assertApproved,
  ApprovalGateError,
} from '../../../../src/main/approvals/gate';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

function freshDb(): Db {
  const dataDir = createTempUserDataDir('aria-approvals-gate');
  const dbKey = crypto.randomBytes(32);
  const db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
  runMigrations(db, { dir: MIGRATIONS_DIR });
  return db;
}

function bring(
  db: Db,
  opts: {
    categories?: string[];
    severity?: 'low' | 'med' | 'high';
    approvalPath?: 'explicit' | 'silent';
    finalState?: 'ready' | 'approved';
  } = {},
): string {
  const id = insertApproval(db, {
    kind: 'email_send',
    categories_json: opts.categories ? JSON.stringify(opts.categories) : null,
    severity: opts.severity ?? null,
  });
  transitionTo(db, id, 'generating');
  transitionTo(db, id, 'ready');
  if (opts.finalState !== 'ready') {
    transitionTo(db, id, 'approved', { approval_path: opts.approvalPath ?? 'explicit' });
  }
  return id;
}

describe('approvals/gate assertApproved', () => {
  let db: Db;
  beforeEach(() => {
    db = freshDb();
  });
  afterEach(() => {
    closeDb(db);
  });

  it("throws code='not-found' on unknown id", () => {
    try {
      assertApproved(db, 'does-not-exist');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalGateError);
      expect((e as ApprovalGateError).code).toBe('not-found');
    }
  });

  it("throws code='not-approved' when state != 'approved'", () => {
    const id = bring(db, { finalState: 'ready' });
    try {
      assertApproved(db, id);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalGateError);
      expect((e as ApprovalGateError).code).toBe('not-approved');
    }
  });

  it('passes when approved + low severity + no forced categories', () => {
    const id = bring(db, { severity: 'low', approvalPath: 'silent' });
    expect(() => assertApproved(db, id)).not.toThrow();
  });

  it("throws 'forced-explicit-missing' when severity=high AND approval_path=silent", () => {
    const id = bring(db, { severity: 'high', approvalPath: 'silent' });
    try {
      assertApproved(db, id);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApprovalGateError);
      expect((e as ApprovalGateError).code).toBe('forced-explicit-missing');
    }
  });

  it('passes when severity=high AND approval_path=explicit', () => {
    const id = bring(db, { severity: 'high', approvalPath: 'explicit' });
    expect(() => assertApproved(db, id)).not.toThrow();
  });

  it.each(['financial', 'legal', 'hr'])(
    "throws 'forced-explicit-missing' when category=%s AND silent",
    (cat) => {
      const id = bring(db, { categories: [cat], approvalPath: 'silent' });
      try {
        assertApproved(db, id);
        throw new Error('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(ApprovalGateError);
        expect((e as ApprovalGateError).code).toBe('forced-explicit-missing');
      }
    },
  );

  it.each(['financial', 'legal', 'hr'])(
    'passes when category=%s AND explicit',
    (cat) => {
      const id = bring(db, { categories: [cat], approvalPath: 'explicit' });
      expect(() => assertApproved(db, id)).not.toThrow();
    },
  );

  it('tolerates malformed categories_json', () => {
    const id = bring(db, { approvalPath: 'silent' });
    db.prepare(`UPDATE approval SET categories_json='{not-json' WHERE id=?`).run(id);
    expect(() => assertApproved(db, id)).not.toThrow();
  });
});

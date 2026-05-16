import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import { openDb, closeDb, type Db } from '../../../../src/main/db/connect';
import { runMigrations } from '../../../../src/main/db/migrations/runner';
import {
  writeRoutingLog,
  readRecentRoutingLog,
  hashPrompt,
} from '../../../../src/main/llm/routingLog';
import { createTempUserDataDir } from '../../../setup';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../src/main/db/migrations');

describe('routingLog', () => {
  let db: Db;

  beforeEach(() => {
    const dataDir = createTempUserDataDir('aria-routinglog');
    const dbKey = crypto.randomBytes(32);
    db = openDb({ dataDir, dbKey, runMigrationsOnOpen: false });
    runMigrations(db, { dir: MIGRATIONS_DIR });
  });

  afterEach(() => {
    closeDb(db);
  });

  it('hashPrompt returns SHA-256 hex for "hello"', () => {
    expect(hashPrompt('hello')).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('writeRoutingLog inserts rows; readRecentRoutingLog returns DESC', () => {
    const base = {
      route: 'LOCAL' as const,
      reason: 'frontier-not-configured',
      source: 'generic',
      prompt_hash: hashPrompt('hi'),
      model: 'llama3.1:8b-instruct-q4_K_M',
      latency_ms: 42,
      ok: 1 as const,
    };
    writeRoutingLog(db, { ...base, ts: '2026-05-16T10:00:00.000Z' });
    writeRoutingLog(db, { ...base, ts: '2026-05-16T10:01:00.000Z', reason: 'second' });
    writeRoutingLog(db, { ...base, ts: '2026-05-16T10:02:00.000Z', reason: 'third' });

    const recent = readRecentRoutingLog(db, 2);
    expect(recent).toHaveLength(2);
    expect(recent[0]!.reason).toBe('third');
    expect(recent[1]!.reason).toBe('second');
    expect(recent[0]!.ok).toBe(1);
    expect(recent[0]!.prompt_hash).toBe(hashPrompt('hi'));
  });

  it('readRecentRoutingLog defaults to 100', () => {
    for (let i = 0; i < 5; i++) {
      writeRoutingLog(db, {
        ts: new Date(2026, 0, 1, 0, i).toISOString(),
        route: 'LOCAL',
        reason: `r${i}`,
        source: 'generic',
        prompt_hash: hashPrompt(`p${i}`),
        model: 'm',
        latency_ms: i,
        ok: 1,
      });
    }
    const all = readRecentRoutingLog(db);
    expect(all).toHaveLength(5);
  });
});

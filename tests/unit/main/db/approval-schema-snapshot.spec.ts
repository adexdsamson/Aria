import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURE_PATH = path.resolve(__dirname, '../../../fixtures/approval-schema-pre-012a.snapshot.json');
const MIGRATION_PATH = path.resolve(__dirname, '../../../../src/main/db/migrations/012a_idempotency_key.sql');

function loadFixture(): string[] {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')) as string[];
}

function extractApprovalNewBlock(sql: string): string {
  const match = /CREATE TABLE approval_new\s*\(([\s\S]*?)\n\);\s*/m.exec(sql);
  if (!match?.[1]) {
    throw new Error('could not find CREATE TABLE approval_new block');
  }
  return match[1];
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('012a approval schema snapshot', () => {
  it('keeps every pre-012a approval column in the verbatim 012a table rebuild', () => {
    const fixture = loadFixture();
    expect(fixture).toHaveLength(34);

    const sql = fs.readFileSync(MIGRATION_PATH, 'utf8');
    const block = extractApprovalNewBlock(sql);

    for (const col of fixture) {
      expect(
        new RegExp(`^\\s*${escapeRegex(col)}\\s+`, 'm').test(block),
        `missing approval column in 012a migration: ${col}`,
      ).toBe(true);
    }

    expect(block).toMatch(/idempotency_key\s+TEXT\s+NOT\s+NULL/);
    expect(block).toMatch(/last_error_message\s+TEXT/);
    expect(block).toMatch(/state\s+TEXT\s+NOT\s+NULL\s+CHECK\s*\(\s*state\s+IN\s*\([\s\S]*'sending'[\s\S]*'failed'[\s\S]*'needs-operator-decision'/);
  });
});

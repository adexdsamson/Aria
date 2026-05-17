/**
 * Plan 03-02 Task 1 — tokenize/rehydrate unit tests.
 *
 * Covers:
 *   - tokenizeForFrontier substitutes email + currency with EMAIL_N / AMT_N
 *   - table contains originals
 *   - rehydrate restores originals
 *   - cross-approval-id isolation: tokens from B do NOT substitute in A
 *   - disposeDraftTable throws 'no-token-table:<id>' on subsequent rehydrate
 *
 *   (PERSON/ORG patterns intentionally skipped v1 per RESEARCH §OQ-1.)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  tokenizeForFrontier,
  rehydrate,
  disposeDraftTable,
  _resetDraftTablesForTests,
} from '../../../../src/main/llm/tokenize';

describe('tokenize', () => {
  beforeEach(() => {
    _resetDraftTablesForTests();
  });

  it("substitutes email and currency with EMAIL_1 / AMT_1; table contains originals", () => {
    const { prompt, table } = tokenizeForFrontier(
      'a-id',
      'John Doe wrote foo@bar.com about $5,000',
    );
    expect(prompt).not.toContain('foo@bar.com');
    expect(prompt).not.toContain('$5,000');
    expect(prompt).toContain('EMAIL_1');
    expect(prompt).toContain('AMT_1');
    expect(table['EMAIL_1']).toBe('foo@bar.com');
    expect(table['AMT_1']).toBe('$5,000');
  });

  it('rehydrate restores originals', () => {
    tokenizeForFrontier('a-id', 'send to foo@bar.com about $5,000');
    const restored = rehydrate('a-id', 'reply to EMAIL_1 about AMT_1');
    expect(restored).toBe('reply to foo@bar.com about $5,000');
  });

  it('counters increment within a single call (multi-email)', () => {
    const { prompt, table } = tokenizeForFrontier(
      'multi',
      'cc alice@x.com and bob@y.com',
    );
    expect(table['EMAIL_1']).toBeDefined();
    expect(table['EMAIL_2']).toBeDefined();
    expect(prompt).toContain('EMAIL_1');
    expect(prompt).toContain('EMAIL_2');
  });

  it('cross-approval-id isolation: tokens from b do NOT substitute in a', () => {
    tokenizeForFrontier('a-id', 'first foo@bar.com');
    tokenizeForFrontier('b-id', 'second baz@qux.com');
    // a's table only knows foo@bar.com → EMAIL_1; b's table only knows
    // baz@qux.com → EMAIL_1. Rehydrating an "EMAIL_1" against a's table
    // returns foo@bar.com — NOT baz@qux.com. Each table is independent.
    const fromA = rehydrate('a-id', 'reply to EMAIL_1');
    const fromB = rehydrate('b-id', 'reply to EMAIL_1');
    expect(fromA).toBe('reply to foo@bar.com');
    expect(fromB).toBe('reply to baz@qux.com');
    expect(fromA).not.toContain('baz@qux.com');
    expect(fromB).not.toContain('foo@bar.com');
  });

  it('cross-id rehydrate of an unknown token leaves it intact', () => {
    tokenizeForFrontier('a-id', 'only foo@bar.com');
    // a's table has EMAIL_1 but no AMT_1. Rehydrate against a's table with a
    // foreign token name → token stays untouched (no false substitution).
    const out = rehydrate('a-id', 'amount AMT_1 unknown');
    expect(out).toBe('amount AMT_1 unknown');
  });

  it("disposeDraftTable causes subsequent rehydrate to throw 'no-token-table:<id>'", () => {
    tokenizeForFrontier('zz', 'foo@bar.com');
    disposeDraftTable('zz');
    expect(() => rehydrate('zz', 'EMAIL_1')).toThrow('no-token-table:zz');
  });

  it('rehydrate on unknown approvalId throws', () => {
    expect(() => rehydrate('never-tokenized', 'EMAIL_1')).toThrow(
      'no-token-table:never-tokenized',
    );
  });
});

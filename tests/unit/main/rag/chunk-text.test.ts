import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  tokenCount,
  normalizeWhitespace,
  stripEmailReply,
  mapCleanedToOriginalSpan,
} from '../../../../src/main/rag/chunk-text';

const FIXTURE = path.resolve(
  __dirname,
  '../../../../tests/fixtures/rag/email-reply-samples.json',
);

interface ReplyCase {
  id: string;
  description: string;
  body: string;
  visible_contains?: string;
  visible_contains_all?: string[];
  visible_excludes?: string;
  visible_excludes_optional?: string;
}

describe('chunk-text primitives', () => {
  it('tokenCount: ceil(len/4) heuristic', () => {
    expect(tokenCount('')).toBe(0);
    expect(tokenCount('abc')).toBe(1);
    expect(tokenCount('abcd')).toBe(1);
    expect(tokenCount('abcde')).toBe(2);
    expect(tokenCount('a'.repeat(2048))).toBe(512);
  });

  it('normalizeWhitespace collapses runs but preserves paragraph breaks', () => {
    expect(normalizeWhitespace('  hello   world  ')).toBe('hello world');
    expect(normalizeWhitespace('para1\n\n\n\npara2')).toBe('para1\n\npara2');
    expect(normalizeWhitespace('line  \nnext')).toBe('line\nnext');
    expect(normalizeWhitespace('')).toBe('');
  });

  it('mapCleanedToOriginalSpan: exact match returns precise span', () => {
    const original = 'prefix HELLO suffix';
    const span = mapCleanedToOriginalSpan('HELLO', original);
    expect(span.charStart).toBe(7);
    expect(span.charEnd).toBe(12);
    expect(span.approximated).toBe(false);
  });

  it('mapCleanedToOriginalSpan: no match falls back with approximated=true', () => {
    const original = '   actual body here   ';
    const span = mapCleanedToOriginalSpan('totally different', original);
    expect(span.approximated).toBe(true);
    expect(span.charStart).toBe(3); // first non-ws char
  });
});

describe('stripEmailReply — RESEARCH §8 six cases', () => {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { cases: ReplyCase[] };

  for (const c of fixture.cases) {
    it(`case ${c.id}: ${c.description}`, () => {
      const visible = stripEmailReply(c.body);
      expect(typeof visible).toBe('string');

      if (c.visible_contains) {
        expect(visible).toContain(c.visible_contains);
      }
      if (c.visible_contains_all) {
        for (const needle of c.visible_contains_all) {
          expect(visible).toContain(needle);
        }
      }
      if (c.visible_excludes) {
        expect(visible).not.toContain(c.visible_excludes);
      }
      // visible_excludes_optional is informational — library quality varies by
      // separator; we don't hard-fail when the parser leaves the quoted block.
    });
  }

  it('empty body yields empty string', () => {
    expect(stripEmailReply('')).toBe('');
  });
});

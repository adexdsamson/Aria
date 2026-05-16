import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PII_PATTERNS,
  redactObject,
  redactString,
  REDACTED,
} from '../../../../src/main/log/redact';

describe('redactString', () => {
  it('redacts email addresses', () => {
    expect(redactString('contact foo@bar.com please')).toBe(`contact ${REDACTED} please`);
  });

  it('redacts E.164 / NANP phone numbers', () => {
    expect(redactString('call +1-415-555-0100 now')).toBe(`call ${REDACTED} now`);
    expect(redactString('phone (415) 555-0100')).toBe(`phone ${REDACTED}`);
  });

  it('redacts currency amounts', () => {
    expect(redactString('paid $1,234.56 yesterday')).toBe(`paid ${REDACTED} yesterday`);
    expect(redactString('cost $5')).toBe(`cost ${REDACTED}`);
  });

  it('redacts SSN-shaped strings', () => {
    expect(redactString('ssn 123-45-6789 here')).toBe(`ssn ${REDACTED} here`);
  });

  it('passes through non-matching text unchanged', () => {
    expect(redactString('hello world — nothing sensitive here')).toBe(
      'hello world — nothing sensitive here',
    );
  });

  it('handles empty / undefined inputs safely', () => {
    expect(redactString('')).toBe('');
    // @ts-expect-error — defensive runtime guard
    expect(redactString(undefined)).toBe(undefined);
  });

  it('exposes a non-empty DEFAULT_PII_PATTERNS array', () => {
    expect(Array.isArray(DEFAULT_PII_PATTERNS)).toBe(true);
    expect(DEFAULT_PII_PATTERNS.length).toBeGreaterThanOrEqual(4);
  });
});

describe('redactObject', () => {
  it('redacts string leaves inside nested objects and arrays', () => {
    const input = {
      user: { email: 'foo@bar.com', name: 'Alice' },
      messages: ['call +1-415-555-0100', 'safe text'],
      cost: '$1,234.56',
      ssn: '123-45-6789',
      count: 42,
      ok: true,
      none: null,
    };
    const out = redactObject(input);
    expect(out).toEqual({
      user: { email: REDACTED, name: 'Alice' },
      messages: [`call ${REDACTED}`, 'safe text'],
      cost: REDACTED,
      ssn: REDACTED,
      count: 42,
      ok: true,
      none: null,
    });
  });

  it('breaks cycles without throwing', () => {
    const a: Record<string, unknown> = { email: 'foo@bar.com' };
    a.self = a;
    expect(() => redactObject(a)).not.toThrow();
  });
});

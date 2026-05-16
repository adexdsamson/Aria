import { describe, expect, it } from 'vitest';
import { classifySensitivity } from '../../../../src/main/llm/classifier';

describe('classifySensitivity', () => {
  it('returns not sensitive for empty string', () => {
    expect(classifySensitivity('')).toEqual({ sensitive: false, matched: [] });
  });

  it('flags email', () => {
    const r = classifySensitivity('Email me at foo@bar.com');
    expect(r.sensitive).toBe(true);
    expect(r.matched).toContain('email');
  });

  it('flags currency', () => {
    const r = classifySensitivity('Pay $1,234.56 next Friday');
    expect(r.sensitive).toBe(true);
    expect(r.matched).toContain('currency');
  });

  it('flags SSN', () => {
    const r = classifySensitivity('My SSN is 123-45-6789');
    expect(r.sensitive).toBe(true);
    expect(r.matched).toContain('ssn');
  });

  it('flags phone', () => {
    const r = classifySensitivity('Call me at (415) 555-0123');
    expect(r.sensitive).toBe(true);
    expect(r.matched).toContain('phone');
  });

  it('does not flag benign weather question', () => {
    const r = classifySensitivity('What is the weather like in Paris today?');
    expect(r.sensitive).toBe(false);
    expect(r.matched).toEqual([]);
  });

  it('returns multiple matches when several patterns hit', () => {
    const r = classifySensitivity('Email foo@bar.com and pay $50');
    expect(r.matched).toContain('email');
    expect(r.matched).toContain('currency');
  });
});

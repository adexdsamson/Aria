/**
 * Plan 04-03 Task 1 — self-only gate tests.
 */
import { describe, it, expect } from 'vitest';
import {
  isSelfOnly,
  assertSelfOnly,
  SelfOnlyGateError,
} from '../../../../src/main/scheduling/self-only-gate';

const USER = 'me@example.com';

describe('isSelfOnly / assertSelfOnly', () => {
  it('returns true for a solo event (undefined attendees)', () => {
    const ev = { organizer: { email: USER, self: true } };
    expect(isSelfOnly(ev, USER)).toBe(true);
    expect(() => assertSelfOnly(ev, USER)).not.toThrow();
  });

  it('returns true for self-only event (attendees only contain self)', () => {
    const ev = {
      organizer: { email: USER, self: true },
      attendees: [{ email: USER, self: true }],
    };
    expect(isSelfOnly(ev, USER)).toBe(true);
  });

  it('returns false (and throws multi-attendee) when an external attendee is present', () => {
    const ev = {
      organizer: { email: USER, self: true },
      attendees: [{ email: USER }, { email: 'bob@external.com' }],
    };
    expect(isSelfOnly(ev, USER)).toBe(false);
    try {
      assertSelfOnly(ev, USER);
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(SelfOnlyGateError);
      expect((err as SelfOnlyGateError).code).toBe('multi-attendee');
    }
  });

  it('throws no-organizer when organizer is missing', () => {
    const ev = { attendees: [] };
    try {
      assertSelfOnly(ev, USER);
      throw new Error('expected throw');
    } catch (err) {
      expect((err as SelfOnlyGateError).code).toBe('no-organizer');
    }
  });

  it('returns false for resource/unspecified attendee (no email)', () => {
    const ev = {
      organizer: { email: USER, self: true },
      attendees: [{ email: USER }, { email: null }],
    };
    expect(isSelfOnly(ev, USER)).toBe(false);
  });
});

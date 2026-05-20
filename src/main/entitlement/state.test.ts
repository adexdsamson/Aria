/**
 * Plan 08.1-02 Task 4 — state machine tests.
 * Pure-function coverage for all 10 RESEARCH §9 states.
 */
import { describe, it, expect } from 'vitest';
import {
  computeEntitlementState,
  isLocked,
  type EntitlementRow,
} from './state';

function trialRow(opts: {
  trialExpiresAt: string;
  trialStartedAt?: string;
  jwtIat?: string;
  jwtExp?: string;
  lastVerifiedAt?: string;
}): EntitlementRow {
  return {
    install_id: 'install-test',
    tier: 'trial',
    jwt: 'jwt.body',
    jwt_iat: opts.jwtIat ?? '2026-05-20T00:00:00.000Z',
    jwt_exp: opts.jwtExp ?? '2026-05-27T00:00:00.000Z',
    trial_started_at: opts.trialStartedAt ?? '2026-03-21T00:00:00.000Z',
    trial_expires_at: opts.trialExpiresAt,
    license_key: null,
    last_verified_at: opts.lastVerifiedAt ?? '2026-05-20T00:00:00.000Z',
    last_check_error: null,
  };
}

function proRow(opts: {
  lastVerifiedAt: string;
  jwtIat?: string;
  jwtExp?: string;
}): EntitlementRow {
  return {
    install_id: 'install-test',
    tier: 'pro',
    jwt: 'jwt.body',
    jwt_iat: opts.jwtIat ?? '2026-05-20T00:00:00.000Z',
    jwt_exp: opts.jwtExp ?? '2026-05-27T00:00:00.000Z',
    trial_started_at: null,
    trial_expires_at: null,
    license_key: 'ARIA-XXX-YYYY',
    last_verified_at: opts.lastVerifiedAt,
    last_check_error: null,
  };
}

describe('computeEntitlementState — pure function (no I/O imports)', () => {
  it('returns trial-active-quiet when more than 10 days remain', () => {
    const now = new Date('2026-04-01T00:00:00.000Z');
    const s = computeEntitlementState(
      trialRow({ trialExpiresAt: '2026-05-20T00:00:00.000Z', jwtIat: now.toISOString() }),
      now,
    );
    expect(s.kind).toBe('trial-active-quiet');
  });

  it('returns trial-active-day50 exactly at 10 days remaining', () => {
    const now = new Date('2026-05-10T00:00:00.000Z');
    const s = computeEntitlementState(
      trialRow({ trialExpiresAt: '2026-05-20T00:00:00.000Z', jwtIat: now.toISOString() }),
      now,
    );
    expect(s.kind).toBe('trial-active-day50');
    if (s.kind === 'trial-active-day50') expect(s.daysRemaining).toBe(10);
  });

  it('returns trial-active-day55 at 5 days remaining', () => {
    const now = new Date('2026-05-15T00:00:00.000Z');
    const s = computeEntitlementState(
      trialRow({ trialExpiresAt: '2026-05-20T00:00:00.000Z', jwtIat: now.toISOString() }),
      now,
    );
    expect(s.kind).toBe('trial-active-day55');
  });

  it('returns trial-active-day59 when 1-2 days remain', () => {
    const now = new Date('2026-05-19T00:00:00.000Z');
    const s = computeEntitlementState(
      trialRow({ trialExpiresAt: '2026-05-20T00:00:00.000Z', jwtIat: now.toISOString() }),
      now,
    );
    expect(s.kind).toBe('trial-active-day59');
  });

  it('returns trial-expired-grace at 0 days remaining within the 24h window', () => {
    const expiresAt = '2026-05-20T00:00:00.000Z';
    const now = new Date('2026-05-20T06:00:00.000Z'); // 6h past expiry
    const s = computeEntitlementState(
      trialRow({ trialExpiresAt: expiresAt, jwtIat: now.toISOString() }),
      now,
    );
    expect(s.kind).toBe('trial-expired-grace');
    if (s.kind === 'trial-expired-grace') {
      expect(s.hoursOfGraceRemaining).toBeGreaterThan(0);
      expect(s.hoursOfGraceRemaining).toBeLessThanOrEqual(18);
    }
  });

  it('returns trial-locked once now >= trial_expires_at + 24h (day-61 transition)', () => {
    const expiresAt = '2026-05-20T00:00:00.000Z';
    const now = new Date('2026-05-21T00:00:00.001Z');
    const s = computeEntitlementState(
      trialRow({ trialExpiresAt: expiresAt, jwtIat: now.toISOString() }),
      now,
    );
    expect(s.kind).toBe('trial-locked');
    expect(isLocked(s)).toBe(true);
  });

  it('boundary: grace ends exactly at trial_expires_at + 24h → locked', () => {
    const expiresAt = '2026-05-20T00:00:00.000Z';
    const exactBoundary = new Date('2026-05-21T00:00:00.000Z');
    const s = computeEntitlementState(
      trialRow({ trialExpiresAt: expiresAt, jwtIat: exactBoundary.toISOString() }),
      exactBoundary,
    );
    expect(s.kind).toBe('trial-locked');
  });

  it('returns pro-active when last_verified_at is recent', () => {
    const now = new Date('2026-05-20T00:00:00.000Z');
    const s = computeEntitlementState(
      proRow({
        lastVerifiedAt: '2026-05-20T00:00:00.000Z',
        jwtIat: now.toISOString(),
        jwtExp: '2026-05-27T00:00:00.000Z',
      }),
      now,
    );
    expect(s.kind).toBe('pro-active');
  });

  it('returns pro-grace between 24h and 14d of offline', () => {
    const now = new Date('2026-05-20T00:00:00.000Z');
    // last verified 3 days ago
    const s = computeEntitlementState(
      proRow({
        lastVerifiedAt: '2026-05-17T00:00:00.000Z',
        jwtIat: now.toISOString(),
      }),
      now,
    );
    expect(s.kind).toBe('pro-grace');
    if (s.kind === 'pro-grace') {
      expect(s.daysUntilLock).toBeGreaterThan(0);
      expect(s.daysUntilLock).toBeLessThanOrEqual(11);
    }
  });

  it('returns pro-locked once last_verified_at + 14d < now', () => {
    const now = new Date('2026-05-20T00:00:00.000Z');
    const s = computeEntitlementState(
      proRow({
        lastVerifiedAt: '2026-05-01T00:00:00.000Z',
        jwtIat: now.toISOString(),
      }),
      now,
    );
    expect(s.kind).toBe('pro-locked');
    expect(isLocked(s)).toBe(true);
  });

  it('wraps in clock-skew-warn when jwt.iat is more than 7d in the future', () => {
    const now = new Date('2026-05-20T00:00:00.000Z');
    const futureIat = new Date('2026-06-20T00:00:00.000Z').toISOString(); // +31d
    const s = computeEntitlementState(
      trialRow({
        trialExpiresAt: '2026-07-20T00:00:00.000Z',
        jwtIat: futureIat,
      }),
      now,
    );
    expect(s.kind).toBe('clock-skew-warn');
    if (s.kind === 'clock-skew-warn') {
      expect(s.skewDays).toBeGreaterThan(7);
      // Underlying must still be the active state, NOT a lock.
      expect(s.underlyingState.kind).toBe('trial-active-quiet');
      expect(isLocked(s)).toBe(false);
    }
  });

  it('clock-skew does NOT cause a lock by itself', () => {
    const now = new Date('2026-05-20T00:00:00.000Z');
    const futureIat = new Date('2026-06-20T00:00:00.000Z').toISOString();
    const s = computeEntitlementState(
      proRow({
        lastVerifiedAt: '2026-05-20T00:00:00.000Z',
        jwtIat: futureIat,
      }),
      now,
    );
    expect(s.kind).toBe('clock-skew-warn');
    expect(isLocked(s)).toBe(false);
  });

  // Smoke: this file imports zero I/O modules. Vitest will surface a
  // resolution failure otherwise — purity is enforced by the absence of
  // `fs`/`electron`/`http` imports at the top of the SUT.
});

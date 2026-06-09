/**
 * Gate 5 — session-manager.ts reconnect classification spec.
 *
 * DisconnectReason codes drive the reconnect policy:
 *   - 401, 403, 440, 500 → no reconnect → status='needs-auth'
 *   - 408, 515            → schedule exponential backoff reconnect
 *   - 5th consecutive failure (cap) → status='degraded'
 *
 * This spec RED-fails until Plan 20-04 (session-manager.ts) lands.
 * Run: npx vitest run tests/unit/main/whatsapp/session-reconnect.spec.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Module under test — does not exist yet; RED-fails until Plan 20-04 lands.
import { classifyDisconnectReason, MAX_RECONNECT_ATTEMPTS } from '../../../../src/main/whatsapp/session-manager';

describe('session-manager.ts — reconnect classification (gate 5)', () => {
  it('classifyDisconnectReason is exported', () => {
    expect(typeof classifyDisconnectReason).toBe('function');
  });

  it('MAX_RECONNECT_ATTEMPTS is exported (cap before degraded)', () => {
    expect(typeof MAX_RECONNECT_ATTEMPTS).toBe('number');
    expect(MAX_RECONNECT_ATTEMPTS).toBeGreaterThanOrEqual(4);
    expect(MAX_RECONNECT_ATTEMPTS).toBeLessThanOrEqual(6);
  });

  describe('permanent-failure codes → needs-auth (no reconnect scheduled)', () => {
    it.each([401, 403, 440, 500])('code %i → action="needs-auth"', (code) => {
      const result = classifyDisconnectReason(code);
      expect(result.action).toBe('needs-auth');
    });

    it.each([401, 403, 440, 500])('code %i → scheduleReconnect=false', (code) => {
      const result = classifyDisconnectReason(code);
      expect(result.scheduleReconnect).toBe(false);
    });
  });

  describe('transient codes → reconnect with backoff', () => {
    it.each([408, 515])('code %i → action="reconnect"', (code) => {
      const result = classifyDisconnectReason(code);
      expect(result.action).toBe('reconnect');
    });

    it.each([408, 515])('code %i → scheduleReconnect=true', (code) => {
      const result = classifyDisconnectReason(code);
      expect(result.scheduleReconnect).toBe(true);
    });

    it.each([408, 515])('code %i → backoffMs is a positive number', (code) => {
      const result = classifyDisconnectReason(code);
      expect(result.backoffMs).toBeGreaterThan(0);
    });
  });

  describe('after 5 consecutive failures → status=degraded', () => {
    it('5th consecutive reconnect attempt returns action="degraded"', () => {
      // Simulate 5 consecutive backoff-eligible failures
      for (let i = 1; i <= MAX_RECONNECT_ATTEMPTS - 1; i++) {
        const result = classifyDisconnectReason(408, i);
        expect(result.action).toBe('reconnect');
      }
      const finalResult = classifyDisconnectReason(408, MAX_RECONNECT_ATTEMPTS);
      expect(finalResult.action).toBe('degraded');
    });

    it('degraded result has scheduleReconnect=false', () => {
      const result = classifyDisconnectReason(408, MAX_RECONNECT_ATTEMPTS);
      expect(result.scheduleReconnect).toBe(false);
    });
  });

  describe('exponential backoff curve', () => {
    it('backoff increases with attempt count (5s/15s/60s/300s/600s curve)', () => {
      const b1 = classifyDisconnectReason(408, 1).backoffMs ?? 0;
      const b2 = classifyDisconnectReason(408, 2).backoffMs ?? 0;
      const b3 = classifyDisconnectReason(408, 3).backoffMs ?? 0;
      expect(b2).toBeGreaterThan(b1);
      expect(b3).toBeGreaterThan(b2);
    });

    it('first backoff is approximately 5s (5000ms ±2000ms)', () => {
      const result = classifyDisconnectReason(408, 1);
      expect(result.backoffMs).toBeGreaterThanOrEqual(3000);
      expect(result.backoffMs).toBeLessThanOrEqual(7000);
    });
  });
});

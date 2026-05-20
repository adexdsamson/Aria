/**
 * Plan 08.1-02 Task 9 — deep-link tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { parseActivateDeepLink, handleActivateDeepLink } from './deep-link';
import type { EntitlementService } from './service';

describe('parseActivateDeepLink', () => {
  it('extracts the key from a well-formed URL', () => {
    expect(
      parseActivateDeepLink('aria://activate?key=ARIA-XYZ'),
    ).toEqual({ license_key: 'ARIA-XYZ' });
  });

  it('returns null for the wrong scheme', () => {
    expect(parseActivateDeepLink('https://activate?key=ARIA-X')).toBeNull();
  });

  it('returns null for the wrong host', () => {
    expect(
      parseActivateDeepLink('aria://other?key=ARIA-X'),
    ).toBeNull();
  });

  it('returns null when key param missing', () => {
    expect(parseActivateDeepLink('aria://activate')).toBeNull();
  });

  it('returns null for non-string input', () => {
    // @ts-expect-error — testing runtime defense
    expect(parseActivateDeepLink(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseActivateDeepLink('')).toBeNull();
  });

  it('returns null for malformed URLs', () => {
    expect(parseActivateDeepLink('aria://')).toBeNull();
  });
});

describe('handleActivateDeepLink', () => {
  it('calls service.activate with the parsed key and emits state-changed on success', async () => {
    const service = {
      activate: vi.fn(async () => undefined),
    } as unknown as EntitlementService;
    const emit = vi.fn();
    const res = await handleActivateDeepLink('aria://activate?key=ARIA-XYZ', {
      service,
      emitStateChanged: emit,
    });
    expect(service.activate).toHaveBeenCalledWith('ARIA-XYZ');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it('returns ok:false with code on activation failure', async () => {
    const err = new Error('boom') as Error & { code: string };
    err.code = 'install-cap-exceeded';
    const service = {
      activate: vi.fn(async () => {
        throw err;
      }),
    } as unknown as EntitlementService;
    const res = await handleActivateDeepLink('aria://activate?key=ARIA-XYZ', {
      service,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('install-cap-exceeded');
  });

  it('returns ok:false with invalid-deep-link for malformed URL (does not call activate)', async () => {
    const service = {
      activate: vi.fn(),
    } as unknown as EntitlementService;
    const res = await handleActivateDeepLink('aria://nope', { service });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('invalid-deep-link');
    expect(service.activate).not.toHaveBeenCalled();
  });
});

/**
 * Plan 08.1-02 Task 6 — LicenseServerClient tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { LicenseServerClient, LicenseServerError } from './license-server-client';

function mockResponse(
  body: unknown,
  init: { status?: number } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('LicenseServerClient', () => {
  const BASE = 'https://example.test';

  it('startTrial POSTs install_id and returns the typed response', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({
        ok: true,
        trial_started_at: '2026-05-20T00:00:00.000Z',
        jwt: 'jwt.body',
      }),
    );
    const client = new LicenseServerClient({ baseUrl: BASE, fetchImpl });
    const res = await client.startTrial('install-abc');
    expect(res.jwt).toBe('jwt.body');
    expect(res.trial_started_at).toBe('2026-05-20T00:00:00.000Z');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/trial/start');
    expect(JSON.parse(opts.body as string)).toEqual({ install_id: 'install-abc' });
  });

  it('activate POSTs license_key + install_id', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({ ok: true, jwt: 'pro.jwt' }),
    );
    const client = new LicenseServerClient({ baseUrl: BASE, fetchImpl });
    const res = await client.activate('ARIA-XXX-YYYY', 'install-1');
    expect(res.jwt).toBe('pro.jwt');
    const [url, opts] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/license/activate');
    expect(JSON.parse(opts.body as string)).toEqual({
      license_key: 'ARIA-XXX-YYYY',
      install_id: 'install-1',
    });
  });

  it('refresh POSTs jwt + install_id', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({ ok: true, jwt: 'refreshed' }),
    );
    const client = new LicenseServerClient({ baseUrl: BASE, fetchImpl });
    await client.refresh('current.jwt', 'install-1');
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/entitlement/refresh');
  });

  it('getPortalUrl POSTs jwt', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({ ok: true, url: 'https://billing.example/abc' }),
    );
    const client = new LicenseServerClient({ baseUrl: BASE, fetchImpl });
    const res = await client.getPortalUrl('jwt');
    expect(res.url).toBe('https://billing.example/abc');
  });

  it('resendKey hits /v1/license/resend', async () => {
    const fetchImpl = vi.fn(async () => mockResponse({ ok: true }));
    const client = new LicenseServerClient({ baseUrl: BASE, fetchImpl });
    await client.resendKey('tok-abc');
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.test/v1/license/resend');
  });

  it('throws LicenseServerError with code from server on 409 install-cap-exceeded', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse(
        { ok: false, error: { code: 'install-cap-exceeded' } },
        { status: 409 },
      ),
    );
    const client = new LicenseServerClient({ baseUrl: BASE, fetchImpl });
    try {
      await client.activate('K', 'I');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(LicenseServerError);
      expect((e as LicenseServerError).code).toBe('install-cap-exceeded');
      expect((e as LicenseServerError).status).toBe(409);
    }
  });

  it('retries exactly once on 5xx then succeeds', async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      n++;
      if (n === 1) return mockResponse({ ok: false }, { status: 503 });
      return mockResponse({
        ok: true,
        trial_started_at: '2026-05-20T00:00:00.000Z',
        jwt: 'jwt',
      });
    });
    const client = new LicenseServerClient({ baseUrl: BASE, fetchImpl });
    const res = await client.startTrial('install-abc');
    expect(res.jwt).toBe('jwt');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries 5xx once then surfaces server-error if it persists', async () => {
    const fetchImpl = vi.fn(async () =>
      mockResponse({ ok: false }, { status: 500 }),
    );
    const client = new LicenseServerClient({ baseUrl: BASE, fetchImpl });
    await expect(client.startTrial('install-abc')).rejects.toMatchObject({
      code: 'server-error',
      status: 500,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('translates AbortError to network-timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const e = new Error('aborted') as Error & { name: string };
      e.name = 'AbortError';
      throw e;
    });
    const client = new LicenseServerClient({
      baseUrl: BASE,
      fetchImpl,
      timeoutMs: 5,
    });
    await expect(client.startTrial('install-abc')).rejects.toMatchObject({
      code: 'network-timeout',
    });
  });
});

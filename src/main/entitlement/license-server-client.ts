/**
 * Plan 08.1-02 Task 6 — HTTP client for the Aria license server.
 *
 * Endpoint contracts: RESEARCH §4.
 * Single timeout: 10s. Retry once on 5xx / network. All 4xx surface as a
 * typed `LicenseServerError` carrying the server's `error.code` string.
 */
import { _currentServerUrl } from './jwt-verify';

const DEFAULT_TIMEOUT_MS = 10_000;
const RETRY_BACKOFF_MS = 1_000;

export type LicenseServerErrorCode =
  | 'install-cap-exceeded'
  | 'key-not-found'
  | 'key-revoked'
  | 'subscription-canceled'
  | 'invalid-signature'
  | 'clock-skew'
  | 'rate-limited'
  | 'already-bound'
  | 'revoked'
  | 'network-timeout'
  | 'network-error'
  | 'server-error'
  | 'bad-response';

export class LicenseServerError extends Error {
  readonly code: LicenseServerErrorCode;
  readonly status?: number;
  constructor(code: LicenseServerErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'LicenseServerError';
    this.code = code;
    this.status = status;
  }
}

export interface StartTrialResponse {
  trial_started_at: string;
  jwt: string;
}

export interface ActivateResponse {
  jwt: string;
}

export interface RefreshResponse {
  jwt: string;
}

export interface PortalUrlResponse {
  url: string;
}

export interface LicenseServerClientDeps {
  /** Base URL override (else uses LICENSE_SERVER_URL). */
  baseUrl?: string;
  /** fetch override (tests). Must conform to global fetch API. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms (default 10s). */
  timeoutMs?: number;
}

interface ApiOk<T> {
  ok: true;
  // additional fields per endpoint
  [k: string]: unknown;
  _payload?: T;
}
interface ApiErr {
  ok: false;
  error: { code: LicenseServerErrorCode; message?: string };
}

export class LicenseServerClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(deps: LicenseServerClientDeps = {}) {
    this.baseUrl = (deps.baseUrl ?? _currentServerUrl()).replace(/\/$/, '');
    this.fetchImpl = deps.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async startTrial(install_id: string): Promise<StartTrialResponse> {
    const data = await this.post('/v1/trial/start', { install_id });
    if (
      typeof (data as Record<string, unknown>).trial_started_at !== 'string' ||
      typeof (data as Record<string, unknown>).jwt !== 'string'
    ) {
      throw new LicenseServerError('bad-response', 'startTrial: missing fields');
    }
    return {
      trial_started_at: (data as { trial_started_at: string }).trial_started_at,
      jwt: (data as { jwt: string }).jwt,
    };
  }

  async activate(
    license_key: string,
    install_id: string,
  ): Promise<ActivateResponse> {
    const data = await this.post('/v1/license/activate', {
      license_key,
      install_id,
    });
    if (typeof (data as Record<string, unknown>).jwt !== 'string') {
      throw new LicenseServerError('bad-response', 'activate: missing jwt');
    }
    return { jwt: (data as { jwt: string }).jwt };
  }

  async refresh(jwt: string, install_id: string): Promise<RefreshResponse> {
    const data = await this.post('/v1/entitlement/refresh', { jwt, install_id });
    if (typeof (data as Record<string, unknown>).jwt !== 'string') {
      throw new LicenseServerError('bad-response', 'refresh: missing jwt');
    }
    return { jwt: (data as { jwt: string }).jwt };
  }

  async getPortalUrl(jwt: string): Promise<PortalUrlResponse> {
    const data = await this.post('/v1/portal/session', { jwt });
    if (typeof (data as Record<string, unknown>).url !== 'string') {
      throw new LicenseServerError('bad-response', 'getPortalUrl: missing url');
    }
    return { url: (data as { url: string }).url };
  }

  async resendKey(stripe_customer_session_token: string): Promise<void> {
    await this.post('/v1/license/resend', { stripe_customer_session_token });
  }

  // ---------- internals ----------

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    return this.doWithRetry(() => this.postOnce(path, body));
  }

  private async doWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof LicenseServerError && this.isTransient(err)) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        return await fn();
      }
      throw err;
    }
  }

  private isTransient(err: LicenseServerError): boolean {
    if (err.code === 'network-timeout' || err.code === 'network-error') return true;
    if (err.code === 'server-error') return true;
    return false;
  }

  private async postOnce(
    path: string,
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const url = this.baseUrl + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      const e = err as { name?: string };
      if (e?.name === 'AbortError') {
        throw new LicenseServerError(
          'network-timeout',
          `${path}: timeout after ${this.timeoutMs}ms`,
        );
      }
      throw new LicenseServerError(
        'network-error',
        `${path}: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }

    let json: ApiOk<unknown> | ApiErr | null = null;
    try {
      json = (await res.json()) as ApiOk<unknown> | ApiErr;
    } catch {
      // body not JSON
    }

    if (res.status >= 500) {
      throw new LicenseServerError(
        'server-error',
        `${path}: ${res.status}`,
        res.status,
      );
    }
    if (!res.ok || (json && (json as ApiErr).ok === false)) {
      const code = (json as ApiErr | null)?.error?.code ?? 'bad-response';
      const msg = (json as ApiErr | null)?.error?.message ?? `${path} failed`;
      throw new LicenseServerError(code, msg, res.status);
    }
    if (!json || (json as ApiOk<unknown>).ok !== true) {
      throw new LicenseServerError(
        'bad-response',
        `${path}: missing ok=true wrapper`,
        res.status,
      );
    }
    return json;
  }
}

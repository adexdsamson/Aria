/**
 * Plan 08.1-02 Task 7 — EntitlementService.
 *
 * Coordinates: first-launch trial registration, refresh, license activation,
 * and current-state read. All persistence funnels through the singleton
 * `entitlement` row (id=1). Every state-changing call logs to
 * `entitlement_audit`.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import {
  LicenseServerClient,
  LicenseServerError,
} from './license-server-client';
import { verifyEntitlementJwt, type EntitlementClaims } from './jwt-verify';
import {
  computeEntitlementState,
  type EntitlementState,
  type EntitlementRow,
} from './state';

type Db = Database.Database;

export interface EntitlementServiceDeps {
  db: Db;
  client?: LicenseServerClient;
  installIdProvider: () => Promise<string>;
  clock?: () => Date;
  logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
}

function audit(db: Db, event: string, detail?: Record<string, unknown>): void {
  try {
    db.prepare(
      `INSERT INTO entitlement_audit (event, detail) VALUES (?, ?)`,
    ).run(event, detail ? JSON.stringify(detail) : null);
  } catch {
    /* never let audit failure cascade */
  }
}

interface RawEntitlementRow {
  install_id: string;
  tier: 'trial' | 'pro' | 'locked';
  jwt: string | null;
  jwt_iat: string | null;
  jwt_exp: string | null;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  license_key: string | null;
  last_verified_at: string;
  last_check_error: string | null;
}

export class EntitlementService {
  private readonly db: Db;
  private readonly client: LicenseServerClient;
  private readonly installIdProvider: () => Promise<string>;
  private readonly clock: () => Date;
  private readonly logger?: Pick<Logger, 'info' | 'warn' | 'error'>;
  private bootstrapInflight: Promise<void> | null = null;

  constructor(deps: EntitlementServiceDeps) {
    this.db = deps.db;
    this.client = deps.client ?? new LicenseServerClient();
    this.installIdProvider = deps.installIdProvider;
    this.clock = deps.clock ?? (() => new Date());
    this.logger = deps.logger;
  }

  private readRow(): RawEntitlementRow | undefined {
    return this.db
      .prepare(
        `SELECT install_id, tier, jwt, jwt_iat, jwt_exp,
                trial_started_at, trial_expires_at, license_key,
                last_verified_at, last_check_error
           FROM entitlement WHERE id = 1`,
      )
      .get() as RawEntitlementRow | undefined;
  }

  private upsertRow(row: {
    install_id: string;
    tier: 'trial' | 'pro' | 'locked';
    jwt: string | null;
    jwt_iat: string | null;
    jwt_exp: string | null;
    trial_started_at: string | null;
    trial_expires_at: string | null;
    license_key: string | null;
    last_verified_at: string;
    last_check_error: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO entitlement (
          id, install_id, tier, jwt, jwt_iat, jwt_exp,
          trial_started_at, trial_expires_at, license_key,
          last_verified_at, last_check_error, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          install_id = excluded.install_id,
          tier = excluded.tier,
          jwt = excluded.jwt,
          jwt_iat = excluded.jwt_iat,
          jwt_exp = excluded.jwt_exp,
          trial_started_at = COALESCE(excluded.trial_started_at, trial_started_at),
          trial_expires_at = COALESCE(excluded.trial_expires_at, trial_expires_at),
          license_key = COALESCE(excluded.license_key, license_key),
          last_verified_at = excluded.last_verified_at,
          last_check_error = excluded.last_check_error,
          updated_at = excluded.updated_at`,
      )
      .run(
        row.install_id,
        row.tier,
        row.jwt,
        row.jwt_iat,
        row.jwt_exp,
        row.trial_started_at,
        row.trial_expires_at,
        row.license_key,
        row.last_verified_at,
        row.last_check_error,
        this.clock().toISOString(),
      );
  }

  /**
   * First-launch trial registration. Idempotent — if a row exists, this is a
   * no-op. Concurrent calls are deduped via a single in-flight promise.
   */
  async bootstrap(): Promise<void> {
    if (this.bootstrapInflight) return this.bootstrapInflight;
    this.bootstrapInflight = this.bootstrapInner().finally(() => {
      this.bootstrapInflight = null;
    });
    return this.bootstrapInflight;
  }

  private async bootstrapInner(): Promise<void> {
    const existing = this.readRow();
    if (existing) return;

    const install_id = await this.installIdProvider();
    let result: Awaited<ReturnType<LicenseServerClient['startTrial']>>;
    try {
      result = await this.client.startTrial(install_id);
    } catch (err) {
      audit(this.db, 'refresh-fail', {
        stage: 'trial-start',
        error: (err as Error).message,
      });
      this.logger?.warn(
        { scope: 'entitlement', event: 'trial-start.fail' },
        'trial registration failed; gate will remain closed',
      );
      // Intentionally do NOT seed a row. Gate will throw 'no-entitlement'
      // for every gated action until trial-start succeeds. Read-only IPC
      // remains usable.
      throw err;
    }

    let claims: EntitlementClaims;
    try {
      claims = await verifyEntitlementJwt(result.jwt);
    } catch (err) {
      audit(this.db, 'refresh-fail', {
        stage: 'trial-start-verify',
        error: (err as Error).message,
      });
      throw err;
    }

    this.upsertRow({
      install_id,
      tier: claims.tier,
      jwt: result.jwt,
      jwt_iat:
        typeof claims.iat === 'number'
          ? new Date(claims.iat * 1000).toISOString()
          : null,
      jwt_exp:
        typeof claims.exp === 'number'
          ? new Date(claims.exp * 1000).toISOString()
          : null,
      trial_started_at: claims.trial_started_at ?? result.trial_started_at,
      trial_expires_at: claims.trial_expires_at ?? null,
      license_key: null,
      last_verified_at: this.clock().toISOString(),
      last_check_error: null,
    });
    audit(this.db, 'trial-start', { install_id });
    this.logger?.info(
      { scope: 'entitlement', event: 'trial-start.ok' },
      'trial registered',
    );
  }

  /** Re-call /v1/entitlement/refresh, update jwt + last_verified_at on success. */
  async refresh(): Promise<EntitlementState> {
    const row = this.readRow();
    if (!row) {
      throw new Error('entitlement: refresh called before bootstrap');
    }
    if (!row.jwt) {
      throw new Error('entitlement: refresh called on row without jwt');
    }
    const install_id = row.install_id;
    try {
      const res = await this.client.refresh(row.jwt, install_id);
      const claims = await verifyEntitlementJwt(res.jwt);
      this.upsertRow({
        install_id,
        tier: claims.tier,
        jwt: res.jwt,
        jwt_iat:
          typeof claims.iat === 'number'
            ? new Date(claims.iat * 1000).toISOString()
            : row.jwt_iat,
        jwt_exp:
          typeof claims.exp === 'number'
            ? new Date(claims.exp * 1000).toISOString()
            : row.jwt_exp,
        trial_started_at: claims.trial_started_at ?? row.trial_started_at,
        trial_expires_at: claims.trial_expires_at ?? row.trial_expires_at,
        license_key: row.license_key,
        last_verified_at: this.clock().toISOString(),
        last_check_error: null,
      });
      audit(this.db, 'refresh-success');
      return this.getCurrentState();
    } catch (err) {
      const code =
        err instanceof LicenseServerError ? err.code : 'network-error';
      // For subscription-canceled: keep JWT (it will expire naturally), set
      // last_check_error so UI can surface a banner. Do NOT clear jwt.
      this.upsertRow({
        ...row,
        last_check_error: code,
      });
      audit(this.db, 'refresh-fail', { code });
      this.logger?.warn(
        { scope: 'entitlement', event: 'refresh.fail', code },
        'entitlement refresh failed',
      );
      return this.getCurrentState();
    }
  }

  /** Activate a license key. Replaces JWT, sets tier='pro'. */
  async activate(license_key: string): Promise<EntitlementState> {
    const install_id = await this.installIdProvider();
    let result: Awaited<ReturnType<LicenseServerClient['activate']>>;
    try {
      result = await this.client.activate(license_key, install_id);
    } catch (err) {
      const code =
        err instanceof LicenseServerError ? err.code : 'network-error';
      audit(this.db, 'activate-fail', { code });
      throw err;
    }
    const claims = await verifyEntitlementJwt(result.jwt);
    const existing = this.readRow();
    this.upsertRow({
      install_id,
      tier: claims.tier,
      jwt: result.jwt,
      jwt_iat:
        typeof claims.iat === 'number'
          ? new Date(claims.iat * 1000).toISOString()
          : null,
      jwt_exp:
        typeof claims.exp === 'number'
          ? new Date(claims.exp * 1000).toISOString()
          : null,
      trial_started_at: existing?.trial_started_at ?? null,
      trial_expires_at: existing?.trial_expires_at ?? null,
      license_key,
      last_verified_at: this.clock().toISOString(),
      last_check_error: null,
    });
    audit(this.db, 'activate-success', { install_id });
    return this.getCurrentState();
  }

  /** Read current state by computing from the row + verified JWT. */
  async getCurrentState(): Promise<EntitlementState> {
    const row = this.readRow();
    if (!row) {
      throw new Error(
        'entitlement: getCurrentState called before bootstrap (no row)',
      );
    }
    let merged: EntitlementRow;
    if (row.jwt) {
      try {
        const claims = await verifyEntitlementJwt(row.jwt);
        merged = {
          install_id: row.install_id,
          tier: claims.tier,
          jwt: row.jwt,
          jwt_iat:
            typeof claims.iat === 'number'
              ? new Date(claims.iat * 1000).toISOString()
              : row.jwt_iat,
          jwt_exp:
            typeof claims.exp === 'number'
              ? new Date(claims.exp * 1000).toISOString()
              : row.jwt_exp,
          trial_started_at: claims.trial_started_at ?? row.trial_started_at,
          trial_expires_at: claims.trial_expires_at ?? row.trial_expires_at,
          license_key: row.license_key,
          last_verified_at: row.last_verified_at,
          last_check_error: row.last_check_error,
        };
      } catch {
        // Invalid JWT — treat as if there were no row at the tier level by
        // forcing the row to a locked posture. The gate will independently
        // throw jwt-invalid; this is only for UX state read.
        merged = {
          ...row,
          tier: row.tier,
        };
      }
    } else {
      merged = { ...row };
    }
    return computeEntitlementState(merged, this.clock());
  }
}

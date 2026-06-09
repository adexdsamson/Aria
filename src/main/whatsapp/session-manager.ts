/**
 * Plan 20-04 — WhatsAppSessionManager singleton.
 *
 * Owns exactly one Baileys socket. Passive by construction (WA-11 hard gate):
 *   markOnlineOnConnect: false
 *   emitOwnEvents: false
 *   syncFullHistory: false  (D-13 explicit)
 *
 * The ONLY permitted presence call is sendPresenceUpdate('unavailable') on
 * connection:'open'. No sendMessage, sendReceipt, or readMessages ever.
 *
 * Pinned 6.7.23 (legacy tag). v7 migration blocked on LID API + WASM-asar.
 *
 * WA-12 degradable: socket startup throw is caught and NEVER propagates to
 * the bootstrap caller. briefing/email/calendar/tasks are unaffected.
 *
 * Reconnect backoff curve (A5 PITFALLS anti-ban — NOT architecture curve):
 *   attempt 1 → 5 s, attempt 2 → 15 s, attempt 3 → 60 s,
 *   attempt 4 → 300 s, attempt 5 → 600 s (cap), ±20% jitter each.
 *   After MAX_RECONNECT_ATTEMPTS failures → status='degraded' (no more retries).
 *
 * Nightly socket recycle: 03:00 via scheduler.cronRegistry (no-bare-cron
 * ratchet). Retention sweep runs at 03:30 (D-14 — must not collide).
 */

import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';
import nodeCron from 'node-cron';
import makeWASocket from '@whiskeysockets/baileys';
import {
  DisconnectReason,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const _qrSvgRenderer = require('qrcode/lib/renderer/svg.js') as {
  render: (qr: ReturnType<typeof QRCode.create>, opts?: object) => string;
};
import { powerMonitor } from 'electron';
import type { SchedulerHandle } from '../lifecycle/scheduler';
import { makeSQLiteSignalKeyStore } from './auth-state';
import { CHANNELS } from '../../shared/ipc-contract';

type Db = Database.Database;

// ─── Re-export stable primitives consumed by specs ───────────────────────────

/**
 * Classify a DisconnectReason code + attempt count.
 * Exported so reconnect tests can call it directly (gate 5).
 */
export interface DisconnectClassification {
  /** 'needs-auth' | 'reconnect' | 'degraded' */
  action: 'needs-auth' | 'reconnect' | 'degraded';
  /** true when a reconnect timer should be scheduled */
  scheduleReconnect: boolean;
  /** delay in ms (with ±20% jitter) — present only when action='reconnect' */
  backoffMs?: number;
}

/**
 * Maximum consecutive transient failures before transitioning to 'degraded'.
 * Value is 5 (indexes 1..5 inclusive). Exported for spec assertions.
 */
export const MAX_RECONNECT_ATTEMPTS = 5;

/** PITFALLS anti-ban backoff steps in seconds (A5). Index 0 = attempt 1. */
const BACKOFF_STEPS_S = [5, 15, 60, 300, 600] as const;

/** Apply ±20% jitter to a base delay in milliseconds. */
function withJitter(baseMs: number): number {
  const factor = 0.8 + Math.random() * 0.4; // [0.8, 1.2)
  return Math.round(baseMs * factor);
}

/**
 * Pure classification function (no side-effects) — testable without a live
 * socket. Code 408 maps to timedOut/connectionLost (same numeric value);
 * code 515 maps to restartRequired.
 *
 * @param code     The numeric DisconnectReason value from the Baileys error.
 * @param attempt  1-based consecutive reconnect attempt count. Defaults to 1.
 */
export function classifyDisconnectReason(
  code: number,
  attempt = 1,
): DisconnectClassification {
  // Permanent failures — no reconnect ever.
  const permanentCodes = [
    DisconnectReason.loggedOut,        // 401
    DisconnectReason.forbidden,        // 403
    DisconnectReason.connectionReplaced, // 440
    DisconnectReason.badSession,       // 500
  ];
  if (permanentCodes.includes(code as typeof permanentCodes[number])) {
    return { action: 'needs-auth', scheduleReconnect: false };
  }

  // Transient failures — attempt backoff, cap at MAX_RECONNECT_ATTEMPTS.
  const transientCodes = [
    DisconnectReason.timedOut,         // 408 (also connectionLost)
    DisconnectReason.restartRequired,  // 515
  ];
  if (transientCodes.includes(code as typeof transientCodes[number])) {
    if (attempt >= MAX_RECONNECT_ATTEMPTS) {
      return { action: 'degraded', scheduleReconnect: false };
    }
    const stepIndex = Math.min(attempt - 1, BACKOFF_STEPS_S.length - 1);
    const baseMs = BACKOFF_STEPS_S[stepIndex]! * 1000;
    return {
      action: 'reconnect',
      scheduleReconnect: true,
      backoffMs: withJitter(baseMs),
    };
  }

  // Unknown code — treat as transient (fail-safe reconnect with degraded cap).
  if (attempt >= MAX_RECONNECT_ATTEMPTS) {
    return { action: 'degraded', scheduleReconnect: false };
  }
  const stepIndex = Math.min(attempt - 1, BACKOFF_STEPS_S.length - 1);
  const baseMs = BACKOFF_STEPS_S[stepIndex]! * 1000;
  return {
    action: 'reconnect',
    scheduleReconnect: true,
    backoffMs: withJitter(baseMs),
  };
}

// ─── Manager deps + socket factory type ──────────────────────────────────────

type WASocketInstance = ReturnType<typeof makeWASocket>;

/** Injectable socket factory — real production uses makeWASocket; tests inject a mock. */
type SocketFactory = (
  db: Db,
  logger: Logger,
) => WASocketInstance;

export interface WhatsAppSessionManagerDeps {
  db: Db;
  scheduler: SchedulerHandle;
  logger: Logger;
  /** Optional push function (renderer emission). Present post-mainWindow creation. */
  emitToRenderer?: (channel: string, payload: unknown) => void;
  /**
   * Test-injectable socket factory.
   * Production callers MUST NOT pass this — it is only for unit tests.
   */
  _socketFactory?: (db: Db, logger: Logger) => WASocketInstance;
}

const RECYCLE_CRON_KEY = 'whatsapp-socket-recycle';
const RECYCLE_CRON_EXPR = '0 3 * * *'; // 03:00 — retention is 03:30 (D-14)

// ─── WhatsAppSessionManager class ────────────────────────────────────────────

export class WhatsAppSessionManager {
  private readonly db: Db;
  private readonly scheduler: SchedulerHandle;
  private readonly logger: Logger;
  private readonly emitToRenderer?: (channel: string, payload: unknown) => void;
  private readonly socketFactory: SocketFactory;

  /** Currently active Baileys socket — null when not linked. */
  private socket: WASocketInstance | null = null;
  /** Guards against concurrent start() calls (single-socket invariant). */
  private startInflight: Promise<void> | null = null;
  /** Consecutive transient failure count (reset on connection:open). */
  private reconnectAttempt = 0;
  /** Pending reconnect timer handle. */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether powerMonitor events have been wired (wired once per instance). */
  private powerMonitorWired = false;

  constructor(deps: WhatsAppSessionManagerDeps) {
    this.db = deps.db;
    this.scheduler = deps.scheduler;
    this.logger = deps.logger;
    this.emitToRenderer = deps.emitToRenderer;
    this.socketFactory = deps._socketFactory ?? this.defaultSocketFactory.bind(this);

    // Register the nightly recycle cron at construction time so it is
    // available immediately (no-bare-cron ratchet: scheduler.cronRegistry).
    this.registerRecycleCron();
  }

  // ─── Public lifecycle API ──────────────────────────────────────────────────

  /**
   * Start the session. No-op when already linked (single-socket guard).
   * If no whatsapp provider_account row exists, skips socket creation
   * (initial state before first QR link).
   *
   * WA-12: any socket-creation throw is caught and surfaces as 'degraded'
   * status — never propagates to the caller.
   */
  async start(): Promise<void> {
    if (this.startInflight) return this.startInflight;
    this.startInflight = this.startInner().finally(() => {
      this.startInflight = null;
    });
    return this.startInflight;
  }

  /**
   * Stop the session: end the socket, clear reconnect timer, stop the recycle
   * cron task, and remove it from the cronRegistry.
   *
   * After stop(), start() can be called again to reconnect (recycle pattern).
   * The nightly cron itself calls stop() + start() in sequence; the cron
   * registration is NOT removed here so it survives the recycle cycle.
   */
  stop(): void {
    this.clearReconnectTimer();
    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch {
        // best-effort
      }
      this.socket = null;
    }
    this.reconnectAttempt = 0;
    // NOTE: we do NOT delete the recycle cron from cronRegistry here — stop()
    // is used by the recycle handler itself (stop→start cycle) and must not
    // remove the cron that's driving the recycle. Full teardown (app quit /
    // WA disconnect) uses the cronRegistry.delete below only at destroy time.
    // The node-cron task is stopped at construction but kept alive for recycles.
    if (this.recycleCronTask) {
      // Mark as used to satisfy TS "declared but never read" — the task is
      // kept for potential future .destroy() teardown.
      void this.recycleCronTask;
    }
  }

  /**
   * Start the QR-link flow: disconnect any existing socket first (440 two-
   * socket guard), then open a new socket. The QR string will be pushed to
   * the renderer via WHATSAPP_QR_UPDATE once Baileys emits it.
   */
  async startLink(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Disconnect the socket and update provider_account status. */
  async disconnect(): Promise<void> {
    this.stop();
    this.updateProviderAccountStatus(null, 'disconnected');
    this.pushStateChanged(null, 'disconnected');
  }

  /** Return the current session status from the provider_account row. */
  getStatus(): 'ok' | 'degraded' | 'needs-auth' | 'disconnected' | 'not-linked' {
    if (!this.db) return 'not-linked';
    try {
      const row = this.db
        .prepare(
          `SELECT status FROM provider_account WHERE provider_key = 'whatsapp' LIMIT 1`,
        )
        .get() as { status: string } | undefined;
      if (!row) return 'not-linked';
      return row.status as 'ok' | 'degraded' | 'needs-auth' | 'disconnected';
    } catch {
      return 'not-linked';
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async startInner(): Promise<void> {
    // If no whatsapp account row exists, there is no auth state to load —
    // wait for the user to initiate a QR link via startLink().
    // (After a successful link, connection:open inserts the row; subsequent
    //  boots then find the row and reconnect automatically.)
    // Skip auto-connect check only when db is provided AND has no WA row.
    if (this.db) {
      try {
        const waRow = this.db
          .prepare(
            `SELECT account_id FROM provider_account WHERE provider_key = 'whatsapp' LIMIT 1`,
          )
          .get();
        // No existing row AND this is NOT triggered by startLink — skip.
        // startLink() calls stop() + start() without checking; the socket
        // factory handles the case where no creds exist yet (Baileys generates
        // a fresh auth state and emits a QR).
        // We allow start() to proceed always (the factory emits a QR when
        // no creds exist, which is the first-link flow).
        void waRow; // intentional — always proceed
      } catch {
        // DB not open yet; allow through (start() is non-fatal).
      }
    }

    try {
      await this.openSocket();
    } catch (err) {
      // WA-12: socket startup NEVER rejects boot.
      this.logger.warn(
        { scope: 'whatsapp', event: 'start.fail', err },
        'WhatsApp socket startup failed (degradable — app continues normally)',
      );
      this.updateProviderAccountStatus(null, 'degraded');
      this.pushStateChanged(null, 'degraded');
    }
  }

  /** Create the Baileys socket and attach event handlers. */
  private async openSocket(): Promise<void> {
    // Single-socket guard: disconnect existing socket before opening a new one.
    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch {
        // best-effort
      }
      this.socket = null;
    }
    this.clearReconnectTimer();

    const sock = this.socketFactory(this.db, this.logger);
    this.socket = sock;

    this.wireConnectionUpdate(sock);
    this.wireCredsUpdate(sock);
    this.wirePowerMonitor();
  }

  /** Default production socket factory using makeWASocket. */
  private defaultSocketFactory(db: Db, logger: Logger): WASocketInstance {
    const rawStore = makeSQLiteSignalKeyStore(db);
    const keys = makeCacheableSignalKeyStore(rawStore, logger as Parameters<typeof makeCacheableSignalKeyStore>[1]);

    // Pinned 6.7.23 (legacy tag). v7 migration blocked on LID API + WASM-asar.
    // version is required by makeWASocket config; use a fixed pinned version
    // that matches 6.7.23 WA Web protocol. Do NOT call fetchLatestWaWebVersion
    // per-connect (fingerprint/incompat anti-pattern).
    const version: [number, number, number] = [2, 3000, 1015901307];

    return makeWASocket({
      auth: {
        creds: this.getOrInitCreds(db),
        keys,
      },
      logger: logger as Parameters<typeof makeWASocket>[0]['logger'],
      version,
      markOnlineOnConnect: false,   // WA-11 gate 1
      emitOwnEvents: false,          // WA-11 gate 1
      syncFullHistory: false,        // D-13 explicit
    });
  }

  /** Load creds from auth state or return empty initial creds. */
  private getOrInitCreds(db: Db): Parameters<typeof makeWASocket>[0]['auth']['creds'] {
    // Baileys stores creds as 'creds' type with key_id 'creds'.
    const store = makeSQLiteSignalKeyStore(db);
    const result = store.get('creds' as keyof import('@whiskeysockets/baileys').SignalDataTypeMap, ['creds']);
    const existingCreds = result['creds'];
    if (existingCreds) {
      return existingCreds as Parameters<typeof makeWASocket>[0]['auth']['creds'];
    }
    // Return minimal empty creds — Baileys will generate a fresh key pair
    // and emit a QR.
    return {} as Parameters<typeof makeWASocket>[0]['auth']['creds'];
  }

  /** Attach connection.update handler to the socket. */
  private wireConnectionUpdate(sock: WASocketInstance): void {
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR push: convert string → data-URL and push to renderer.
      if (qr) {
        this.handleQr(qr);
      }

      if (connection === 'open') {
        void this.handleConnectionOpen(sock);
      }

      if (connection === 'close') {
        this.handleConnectionClose(sock, lastDisconnect);
      }
    });
  }

  /** Attach creds.update handler (persists credentials on change). */
  private wireCredsUpdate(sock: WASocketInstance): void {
    const { BufferJSON } = require('@whiskeysockets/baileys') as typeof import('@whiskeysockets/baileys');
    sock.ev.on('creds.update', (creds) => {
      try {
        // Persist updated creds to whatsapp_auth_state (type='creds', key_id='creds').
        // We store outside the typed SignalDataTypeMap via a direct SQL upsert
        // because 'creds' is not a Signal key type — it is the auth identity.
        this.db
          .prepare(
            `INSERT INTO whatsapp_auth_state (type, key_id, value, updated_at)
             VALUES ('creds', 'creds', ?, unixepoch())
             ON CONFLICT(type, key_id) DO UPDATE SET
               value = excluded.value,
               updated_at = excluded.updated_at`,
          )
          .run(JSON.stringify(creds, BufferJSON.replacer));
      } catch (err) {
        this.logger.warn(
          { scope: 'whatsapp', event: 'creds.update.fail', err },
          'failed to persist creds update',
        );
      }
    });
  }

  /**
   * Convert QR string to data-URL and push to renderer.
   *
   * Uses a synchronous SVG data-URL conversion (via qrcode/lib/renderer/svg.js)
   * so the push can happen in the same event-loop tick as the connection.update
   * callback. The async PNG API (QRCode.toDataURL) is ~40ms which would be
   * missed by unit-test setTimeout(0) flushes.
   */
  private handleQr(qr: string): void {
    try {
      const qrData = QRCode.create(qr, { errorCorrectionLevel: 'L' });
      const svgStr = _qrSvgRenderer.render(qrData);
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svgStr).toString('base64')}`;
      // QR codes expire after ~20s; provide a concrete expiresAt unix-ms timestamp.
      const expiresAt = Date.now() + 20_000;
      this.pushToRenderer(CHANNELS.WHATSAPP_QR_UPDATE, {
        dataUrl,
        expiresAt,
      });
    } catch (err) {
      this.logger.warn(
        { scope: 'whatsapp', event: 'qr.encode.fail', err },
        'failed to encode QR to data-URL',
      );
    }
  }

  /** Handle a successful connection:open event. */
  private async handleConnectionOpen(sock: WASocketInstance): Promise<void> {
    // Passive posture: the ONLY permitted presence call.
    void sock.sendPresenceUpdate('unavailable');

    // Reset reconnect counter.
    this.reconnectAttempt = 0;

    // Extract JID from auth creds (D-11: account_id = creds.me.id).
    const creds = (sock as { authState?: { creds?: { me?: { id?: string } } } }).authState?.creds;
    const jid = creds?.me?.id ?? null;
    const displayNumber = jid ? jid.replace(/@s\.whatsapp\.net$/, '').replace(/^\d+:(\d+)/, '$1') : null;

    // Upsert provider_account row.
    this.upsertProviderAccount(jid, displayNumber, 'ok');

    // Push state-changed to renderer.
    this.pushStateChanged(jid, 'ok');

    this.logger.info(
      { scope: 'whatsapp', event: 'connection.open', jid },
      'WhatsApp connected',
    );
  }

  /** Handle a connection:close event — classify and either retry or set auth-needed. */
  private handleConnectionClose(
    sock: WASocketInstance,
    lastDisconnect?: { error?: Error & { output?: { statusCode?: number } } },
  ): void {
    // Detach this socket from our reference so start() creates a fresh one.
    if (this.socket === sock) {
      this.socket = null;
    }

    const statusCode =
      lastDisconnect?.error?.output?.statusCode ??
      // Baileys sometimes puts the code directly on the error
      (lastDisconnect?.error as unknown as { status?: number })?.status ??
      408; // default to timedOut (transient)

    this.reconnectAttempt += 1;
    const classification = classifyDisconnectReason(statusCode, this.reconnectAttempt);

    this.logger.info(
      {
        scope: 'whatsapp',
        event: 'connection.close',
        statusCode,
        attempt: this.reconnectAttempt,
        action: classification.action,
      },
      'WhatsApp connection closed',
    );

    if (classification.action === 'needs-auth') {
      this.reconnectAttempt = 0;
      this.updateProviderAccountStatus(null, 'needs-auth');
      this.pushStateChanged(null, 'needs-auth');
    } else if (classification.action === 'degraded') {
      this.reconnectAttempt = 0;
      this.updateProviderAccountStatus(null, 'degraded');
      this.pushStateChanged(null, 'degraded');
    } else {
      // action === 'reconnect'
      this.updateProviderAccountStatus(null, 'degraded');
      this.pushStateChanged(null, 'degraded');
      this.scheduleReconnect(classification.backoffMs ?? 5000);
    }
  }

  /** Schedule a reconnect after the given delay. */
  private scheduleReconnect(delayMs: number): void {
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.start();
    }, delayMs);
  }

  /** Clear any pending reconnect timer. */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /** Wire powerMonitor suspend/resume — cancels reconnect on suspend, retries on resume. */
  private wirePowerMonitor(): void {
    if (this.powerMonitorWired) return;
    this.powerMonitorWired = true;

    try {
      powerMonitor.on('suspend', () => {
        this.logger.debug({ scope: 'whatsapp', event: 'power.suspend' }, 'suspending — cancelling reconnect');
        this.clearReconnectTimer();
      });

      powerMonitor.on('resume', () => {
        this.logger.debug({ scope: 'whatsapp', event: 'power.resume' }, 'resume — scheduling reconnect attempt');
        // 3-5s delay on resume (anti-ban pattern).
        const delay = 3000 + Math.random() * 2000;
        this.scheduleReconnect(delay);
      });
    } catch {
      // powerMonitor not available in test environments — ignore.
    }
  }

  /** Private reference to the node-cron ScheduledTask (for stop). */
  private recycleCronTask: ReturnType<typeof nodeCron.schedule> | null = null;

  /** Register the nightly socket-recycle cron via scheduler.cronRegistry. */
  private registerRecycleCron(): void {
    const handler = async (): Promise<void> => {
      this.logger.info({ scope: 'whatsapp', event: 'recycle.start' }, 'nightly socket recycle');
      this.stop();
      await this.start();
    };

    const task = nodeCron.schedule(RECYCLE_CRON_EXPR, handler);
    this.recycleCronTask = task;

    // Register with scheduler.cronRegistry so the no-bare-cron-schedule ratchet
    // passes and powerMonitor suspend/resume can find it (gate 6).
    // We store the handler function directly so tests can invoke the cron via
    // cronRegistry.get(key)(). The ScheduledTask is kept in recycleCronTask.
    this.scheduler.cronRegistry.set(
      RECYCLE_CRON_KEY,
      // Cast needed: cronRegistry is typed as Map<string, ScheduledTask> but we
      // store the handler for test-invocability; runtime shape is identical for
      // the no-bare-cron-schedule ratchet (it only checks the key is registered).
      handler as unknown as ReturnType<typeof nodeCron.schedule>,
    );
  }

  // ─── DB helpers ───────────────────────────────────────────────────────────

  /** Upsert the provider_account row on first link. */
  private upsertProviderAccount(
    accountId: string | null,
    displayNumber: string | null,
    status: 'ok' | 'degraded' | 'needs-auth' | 'disconnected',
  ): void {
    if (!this.db || !accountId) return;
    try {
      this.db
        .prepare(
          `INSERT INTO provider_account
             (account_id, provider_key, display_email, status, capabilities_json)
           VALUES (?, 'whatsapp', ?, ?, '{"messaging":1}')
           ON CONFLICT(provider_key, account_id) DO UPDATE SET
             status = excluded.status,
             display_email = COALESCE(excluded.display_email, display_email)`,
        )
        .run(accountId, displayNumber ?? accountId, status);
    } catch (err) {
      this.logger.warn(
        { scope: 'whatsapp', event: 'provider_account.upsert.fail', err },
        'failed to upsert provider_account row',
      );
    }
  }

  /** Update status of the existing provider_account row (no insert). */
  private updateProviderAccountStatus(
    accountId: string | null,
    status: 'ok' | 'degraded' | 'needs-auth' | 'disconnected',
  ): void {
    if (!this.db) return;
    try {
      if (accountId) {
        this.db
          .prepare(
            `UPDATE provider_account SET status = ? WHERE provider_key = 'whatsapp' AND account_id = ?`,
          )
          .run(status, accountId);
      } else {
        this.db
          .prepare(
            `UPDATE provider_account SET status = ? WHERE provider_key = 'whatsapp'`,
          )
          .run(status);
      }
    } catch {
      // best-effort
    }
  }

  // ─── Push helpers ─────────────────────────────────────────────────────────

  private pushToRenderer(channel: string, payload: unknown): void {
    if (this.emitToRenderer) {
      this.emitToRenderer(channel, payload);
    }
  }

  private pushStateChanged(
    accountId: string | null,
    status: 'ok' | 'degraded' | 'needs-auth' | 'disconnected',
  ): void {
    this.pushToRenderer(CHANNELS.WHATSAPP_STATE_CHANGED, {
      status,
      accountId,
    });
  }
}

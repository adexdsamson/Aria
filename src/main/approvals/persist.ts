/**
 * Plan 03-01 — Approval row persistence.
 *
 * CRUD over the polymorphic `approval` table + the crash-recovery sweep that
 * runs once at startup BEFORE any IPC handler registers (Pattern 2). Every
 * state mutation goes through `transitionTo`, which validates against
 * `assertTransition` inside a single SQLite transaction.
 *
 * `writeSendLog` is a dormant helper in Plan 03-01 — the `send_log` table is
 * created by Plan 03-04 migration 009. Plan 03-01 ships zero callers of the
 * function; it exists so the contract is fixed up front.
 */
import * as crypto from 'node:crypto';
import type Database from 'better-sqlite3-multiple-ciphers';
import {
  assertTransition,
  type ApprovalState,
} from './state';

type Db = Database.Database;

export type ApprovalKind = 'email_send' | 'calendar_change';
export type CalendarAction = 'move' | 'create' | 'find-time';
export type RecurringScope = 'this' | 'future' | 'all';
export type ApprovalPath = 'explicit' | 'silent';
export type Severity = 'low' | 'med' | 'high';
export type Routed = 'local' | 'frontier' | 'hybrid';

export interface ApprovalRow {
  id: string;
  kind: ApprovalKind;
  state: ApprovalState;
  created_at: string;
  updated_at: string;
  approval_path: ApprovalPath;
  source_message_id: string | null;
  recipients_json: string | null;
  subject: string | null;
  body_original: string | null;
  body_edited: string | null;
  classifier_version: string | null;
  categories_json: string | null;
  severity: Severity | null;
  confidence: number | null;
  classifier_rationale: string | null;
  routed: Routed | null;
  triage_signals_json: string | null;
  triage_summary: string | null;
  rejection_reason: string | null;
  snooze_until: string | null;
  sent_at: string | null;
  send_log_id: number | null;
  // Plan 04-01 — calendar_change payload (NULL when kind='email_send').
  calendar_event_id: string | null;
  calendar_action: CalendarAction | null;
  recurring_scope: RecurringScope | null;
  before_json: string | null;
  after_json: string | null;
  conflicts_json: string | null;
  alternatives_json: string | null;
  rule_overrides_json: string | null;
}

export interface NewApprovalInput {
  kind: ApprovalKind;
  state?: ApprovalState;
  source_message_id?: string | null;
  recipients_json?: string | null;
  subject?: string | null;
  body_original?: string | null;
  body_edited?: string | null;
  classifier_version?: string | null;
  categories_json?: string | null;
  severity?: Severity | null;
  confidence?: number | null;
  classifier_rationale?: string | null;
  routed?: Routed | null;
  triage_signals_json?: string | null;
  triage_summary?: string | null;
  approval_path?: ApprovalPath;
  // Plan 04-01 — calendar_change payload.
  calendar_event_id?: string | null;
  calendar_action?: CalendarAction | null;
  recurring_scope?: RecurringScope | null;
  before_json?: string | null;
  after_json?: string | null;
  conflicts_json?: string | null;
  alternatives_json?: string | null;
  rule_overrides_json?: string | null;
}

const INSERT_SQL = `INSERT INTO approval (
  id, kind, state, created_at, updated_at, approval_path,
  source_message_id, recipients_json, subject, body_original, body_edited,
  classifier_version, categories_json, severity, confidence,
  classifier_rationale, routed, triage_signals_json, triage_summary,
  calendar_event_id, calendar_action, recurring_scope,
  before_json, after_json, conflicts_json, alternatives_json, rule_overrides_json
) VALUES (
  @id, @kind, @state, @created_at, @updated_at, @approval_path,
  @source_message_id, @recipients_json, @subject, @body_original, @body_edited,
  @classifier_version, @categories_json, @severity, @confidence,
  @classifier_rationale, @routed, @triage_signals_json, @triage_summary,
  @calendar_event_id, @calendar_action, @recurring_scope,
  @before_json, @after_json, @conflicts_json, @alternatives_json, @rule_overrides_json
)`;

export function insertApproval(db: Db, input: NewApprovalInput): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const row = {
    id,
    kind: input.kind,
    state: input.state ?? 'pending',
    created_at: now,
    updated_at: now,
    approval_path: input.approval_path ?? 'explicit',
    source_message_id: input.source_message_id ?? null,
    recipients_json: input.recipients_json ?? null,
    subject: input.subject ?? null,
    body_original: input.body_original ?? null,
    body_edited: input.body_edited ?? null,
    classifier_version: input.classifier_version ?? null,
    categories_json: input.categories_json ?? null,
    severity: input.severity ?? null,
    confidence: input.confidence ?? null,
    classifier_rationale: input.classifier_rationale ?? null,
    routed: input.routed ?? null,
    triage_signals_json: input.triage_signals_json ?? null,
    triage_summary: input.triage_summary ?? null,
    calendar_event_id: input.calendar_event_id ?? null,
    calendar_action: input.calendar_action ?? null,
    recurring_scope: input.recurring_scope ?? null,
    before_json: input.before_json ?? null,
    after_json: input.after_json ?? null,
    conflicts_json: input.conflicts_json ?? null,
    alternatives_json: input.alternatives_json ?? null,
    rule_overrides_json: input.rule_overrides_json ?? null,
  };
  const tx = db.transaction(() => {
    db.prepare(INSERT_SQL).run(row);
  });
  tx();
  return id;
}

const ALLOWED_PATCH_COLS = new Set<keyof ApprovalRow>([
  'approval_path',
  'source_message_id',
  'recipients_json',
  'subject',
  'body_original',
  'body_edited',
  'classifier_version',
  'categories_json',
  'severity',
  'confidence',
  'classifier_rationale',
  'routed',
  'triage_signals_json',
  'triage_summary',
  'rejection_reason',
  'snooze_until',
  'sent_at',
  'send_log_id',
  'calendar_event_id',
  'calendar_action',
  'recurring_scope',
  'before_json',
  'after_json',
  'conflicts_json',
  'alternatives_json',
  'rule_overrides_json',
]);

export function getApprovalState(db: Db, id: string): ApprovalState | null {
  const r = db.prepare(`SELECT state FROM approval WHERE id = ?`).get(id) as
    | { state: ApprovalState }
    | undefined;
  return r ? r.state : null;
}

export function transitionTo(
  db: Db,
  id: string,
  to: ApprovalState,
  patch: Partial<ApprovalRow> = {},
): void {
  const tx = db.transaction(() => {
    const row = db.prepare(`SELECT state FROM approval WHERE id = ?`).get(id) as
      | { state: ApprovalState }
      | undefined;
    if (!row) throw new Error(`approval-not-found:${id}`);
    assertTransition(row.state, to);

    const sets: string[] = ['state = @state', 'updated_at = @updated_at'];
    const params: Record<string, unknown> = {
      id,
      state: to,
      updated_at: new Date().toISOString(),
    };
    for (const [k, v] of Object.entries(patch)) {
      if (!ALLOWED_PATCH_COLS.has(k as keyof ApprovalRow)) continue;
      sets.push(`${k} = @${k}`);
      params[k] = v as unknown;
    }
    const sql = `UPDATE approval SET ${sets.join(', ')} WHERE id = @id`;
    db.prepare(sql).run(params);
  });
  tx();
}

export interface ListApprovalsOptions {
  states?: ApprovalState[];
  limit?: number;
}

export function listApprovals(db: Db, opts: ListApprovalsOptions = {}): ApprovalRow[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 200, 1000));
  if (opts.states && opts.states.length > 0) {
    const placeholders = opts.states.map(() => '?').join(',');
    const sql = `SELECT * FROM approval WHERE state IN (${placeholders})
                 ORDER BY updated_at DESC LIMIT ?`;
    return db.prepare(sql).all(...opts.states, limit) as ApprovalRow[];
  }
  return db
    .prepare(`SELECT * FROM approval ORDER BY updated_at DESC LIMIT ?`)
    .all(limit) as ApprovalRow[];
}

export function getApproval(db: Db, id: string): ApprovalRow | null {
  const r = db.prepare(`SELECT * FROM approval WHERE id = ?`).get(id) as
    | ApprovalRow
    | undefined;
  return r ?? null;
}

/**
 * RESEARCH Pattern 2 — startup sweep. Any row left in `generating` from a
 * prior process is converted to `interrupted` BEFORE any IPC handler can be
 * invoked. Returns the count of converted rows.
 */
export function reapInterruptedOnStartup(db: Db): number {
  const result = db
    .prepare(
      `UPDATE approval SET state = 'interrupted', updated_at = ?
       WHERE state = 'generating'`,
    )
    .run(new Date().toISOString());
  return result.changes;
}

/**
 * Append a row to send_log. Dormant in Plan 03-01 — the send_log table is
 * created by Plan 03-04 migration 009; this function exists so the contract
 * is locked up front. Calling it before migration 009 lands will throw
 * (no such table).
 */
export function writeSendLog(
  db: Db,
  args: {
    approvalId: string;
    ok: 0 | 1;
    providerMsgId?: string;
    error?: string;
    recipients: string[];
    subject?: string;
    provider?: string;
  },
): number {
  const provider = args.provider ?? 'gmail';
  const stmt = db.prepare(
    `INSERT INTO send_log
      (approval_id, ts, provider, provider_msg_id, recipients_json, subject, ok, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const res = stmt.run(
    args.approvalId,
    new Date().toISOString(),
    provider,
    args.providerMsgId ?? null,
    JSON.stringify(args.recipients),
    args.subject ?? null,
    args.ok,
    args.error ?? null,
  );
  return Number(res.lastInsertRowid);
}

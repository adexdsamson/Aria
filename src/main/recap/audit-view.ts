/**
 * Plan 08-02 Task 1 — audit-view reader.
 *
 * Provides a typed pagination + filter API over the `action_audit_log` VIEW
 * (migration 129). The VIEW unions 4 arms:
 *   - email_send          (send_log; provider = gmail|outlook|…)
 *   - calendar_change     (calendar_action_log WHERE phase IN post_write/failed/override)
 *   - task_pushed         (meeting_action_task_link JOIN todoist_task)
 *   - approval_declined   (approval WHERE state='rejected')
 *
 * The recap generator + RECAP_LIST_AUDIT IPC channel both call
 * `readActionAuditWindow`. The trust-anchor rendering on the RecapScreen
 * "What Aria did" list also reads via this module.
 *
 * Provider labels (H-4 peer review): centralized in `PROVIDER_LABELS` so the
 * renderer, DOCX exporter, and PDF exporter ALL render Outlook as "Outlook"
 * and Gmail as "Gmail" deterministically — never hardcoded.
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export type ActionAuditKind =
  | 'email_send'
  | 'calendar_change'
  | 'task_pushed'
  | 'approval_declined';

export interface ActionAuditRow {
  kind: ActionAuditKind;
  /** Stable id for narrative cross-validation. `${kind}:${row_id}` */
  id: string;
  occurredAt: string;
  /** Free-form provider key (gmail|outlook|google|todoist|null). */
  provider: string | null;
  resource: string;
  approvalId: string | null;
  payload: unknown;
  outcome: string;
}

export interface ReadAuditWindowOpts {
  fromIso?: string;
  toIso?: string;
  limit?: number;
}

interface RawRow {
  kind: ActionAuditKind;
  row_id: string | number;
  occurred_at: string;
  provider: string | null;
  resource: string;
  approval_id: string | null;
  payload_json: string;
  outcome: string;
}

/** Read action_audit_log rows in [fromIso, toIso] ordered newest-first. */
export function readActionAuditWindow(
  db: Db,
  opts: ReadAuditWindowOpts = {},
): ActionAuditRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.fromIso) {
    clauses.push('occurred_at >= ?');
    params.push(opts.fromIso);
  }
  if (opts.toIso) {
    clauses.push('occurred_at <= ?');
    params.push(opts.toIso);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(2000, Math.round(opts.limit ?? 200)));
  const sql = `SELECT kind, row_id, occurred_at, provider, resource,
                      approval_id, payload_json, outcome
                 FROM action_audit_log
                 ${where}
                 ORDER BY occurred_at DESC
                 LIMIT ?`;
  params.push(limit);
  let raw: RawRow[] = [];
  try {
    raw = db.prepare(sql).all(...params) as RawRow[];
  } catch {
    return [];
  }
  return raw.map((r) => {
    let payload: unknown = null;
    try {
      payload = JSON.parse(r.payload_json);
    } catch {
      payload = null;
    }
    return {
      kind: r.kind,
      id: `${r.kind}:${r.row_id}`,
      occurredAt: r.occurred_at,
      provider: r.provider,
      resource: r.resource,
      approvalId: r.approval_id,
      payload,
      outcome: r.outcome,
    };
  });
}

// ─── Provider-label centralization (H-4) ────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
  google: 'Google',
  microsoft: 'Outlook',
  todoist: 'Todoist',
};

/** Map raw provider string to human label. Falls back to capitalized provider. */
export function providerLabel(provider: string | null | undefined): string {
  if (!provider) return '';
  const key = provider.toLowerCase();
  if (PROVIDER_LABELS[key]) return PROVIDER_LABELS[key];
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/** Render an audit row as a single deterministic prose line. Shared by renderer + exporters. */
export function renderAuditRowLine(row: ActionAuditRow): string {
  const when = (row.occurredAt ?? '').slice(0, 10);
  switch (row.kind) {
    case 'email_send': {
      const label = providerLabel(row.provider) || 'Email';
      const subj = readField(row.payload, 'subject') ?? '(no subject)';
      const recipients = readArray(row.payload, 'recipients');
      const to = recipients.length > 0 ? `to ${recipients.join(', ')}` : '';
      const ok = readField(row.payload, 'ok');
      const status = ok === 0 ? ' (failed)' : '';
      return `${when}: Sent draft via ${label}${to ? ' ' + to : ''} — ${subj}${status}`.trim();
    }
    case 'calendar_change': {
      const eventId = readField(row.payload, 'eventId') ?? '';
      return `${when}: Calendar change (${row.outcome}) on event ${eventId}`;
    }
    case 'task_pushed': {
      const content = readField(row.payload, 'content') ?? '';
      const project = readField(row.payload, 'projectName') ?? '';
      return `${when}: Pushed task to Todoist${project ? ` (${project})` : ''}: ${content}`;
    }
    case 'approval_declined': {
      const subj = readField(row.payload, 'subject') ?? row.resource;
      return `${when}: Declined ${row.resource} approval — ${subj}`;
    }
    default:
      return `${when}: ${row.kind}`;
  }
}

function readField(payload: unknown, key: string): string | number | null {
  if (!payload || typeof payload !== 'object') return null;
  const v = (payload as Record<string, unknown>)[key];
  if (typeof v === 'string' || typeof v === 'number') return v;
  return null;
}

function readArray(payload: unknown, key: string): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const v = (payload as Record<string, unknown>)[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

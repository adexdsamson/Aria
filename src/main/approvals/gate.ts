/**
 * Plan 03-01 — The single send-authorization gate.
 *
 * `assertApproved` is the ONLY function permitted to declare a row "safe to
 * send." It is called as the first line of the future Gmail send adapter
 * (`src/main/integrations/google/send.ts`, landing in Plan 03-04). The
 * static-grep test `tests/static/single-send-call-site.test.ts` asserts that
 * no other module reaches the Gmail send method.
 *
 * APPR-07 forced-explicit override: when `severity === 'high'` or any of the
 * FORCED_CATEGORIES are present, the row MUST have been approved via the
 * 'explicit' path. Plan 03-01 records this on every approve transition;
 * Plan 03-02 surfaces the high-severity case in the renderer.
 *
 * Source: RESEARCH Example 1 (verbatim).
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export type ApprovalGateErrorCode =
  | 'not-found'
  | 'not-approved'
  | 'forced-explicit-missing';

export class ApprovalGateError extends Error {
  readonly code: ApprovalGateErrorCode;
  constructor(code: ApprovalGateErrorCode, message: string) {
    super(message);
    this.name = 'ApprovalGateError';
    this.code = code;
  }
}

export const FORCED_CATEGORIES: ReadonlySet<string> = new Set([
  'financial',
  'legal',
  'hr',
]);

export function assertApproved(db: Db, approvalId: string): void {
  const row = db
    .prepare(
      `SELECT state, severity, categories_json, approval_path
       FROM approval WHERE id = ?`,
    )
    .get(approvalId) as
    | {
        state: string;
        severity: string | null;
        categories_json: string | null;
        approval_path: string;
      }
    | undefined;

  if (!row) {
    throw new ApprovalGateError('not-found', `approval not found: ${approvalId}`);
  }
  if (row.state !== 'approved') {
    throw new ApprovalGateError(
      'not-approved',
      `approval ${approvalId} state=${row.state}, must be 'approved'`,
    );
  }
  let cats: string[] = [];
  if (row.categories_json) {
    try {
      const parsed = JSON.parse(row.categories_json);
      if (Array.isArray(parsed)) cats = parsed.map(String);
    } catch {
      // tolerate malformed JSON — treat as no categories.
    }
  }
  const isForced =
    row.severity === 'high' || cats.some((c) => FORCED_CATEGORIES.has(c));
  if (isForced && row.approval_path !== 'explicit') {
    throw new ApprovalGateError(
      'forced-explicit-missing',
      `severity=high or forced-category requires explicit approval; got path=${row.approval_path}`,
    );
  }
}

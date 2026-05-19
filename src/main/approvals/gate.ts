/**
 * Plan 03-01 — The single send-authorization gate.
 *
 * `assertApproved` is the ONLY function permitted to declare a row "safe to
 * send." It is called as the first line of the unified send adapter
 * (`src/main/integrations/send.ts`). The
 * static-grep test `tests/static/single-mail-send-site.test.ts` asserts that
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
  let parseFailed = false;
  if (row.categories_json) {
    try {
      const parsed = JSON.parse(row.categories_json);
      if (Array.isArray(parsed)) {
        cats = parsed.map(String);
      } else {
        // CR-01: non-array JSON (e.g. '"hr"', '{}') is malformed for our schema.
        parseFailed = true;
      }
    } catch {
      // CR-01: fail CLOSED on malformed JSON rather than silently downgrading
      // to non-forced. The gate is the last line of defense.
      parseFailed = true;
    }
  }
  // CR-01: row.severity === null treats unclassified rows as forced — they
  // must not ride the silent path. parseFailed likewise forces explicit.
  const isForced =
    parseFailed ||
    row.severity === null ||
    row.severity === 'high' ||
    cats.some((c) => FORCED_CATEGORIES.has(c));
  if (isForced && row.approval_path !== 'explicit') {
    const reason = parseFailed
      ? '; reason=malformed-categories_json'
      : row.severity === null
        ? '; reason=null-severity'
        : '';
    throw new ApprovalGateError(
      'forced-explicit-missing',
      `severity=high or forced-category requires explicit approval; got path=${row.approval_path}${reason}`,
    );
  }
}

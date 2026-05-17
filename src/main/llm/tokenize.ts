/**
 * Plan 03-02 — PII tokenize + rehydrate (per-draft scoped).
 *
 * Token table keyed by `approvalId`. Frontier prompt uses tokens (EMAIL_1,
 * AMT_2, ...); frontier response is scanned and substituted back via
 * `rehydrate(approvalId, response)`.
 *
 * v1: regex-only redaction reusing `DEFAULT_PII_PATTERNS` from
 * `src/main/log/redact.ts`. PERSON/ORG NER skipped v1 per RESEARCH §OQ-1.
 * Compensating control: HR/legal/financial≥med routes ENTIRELY local in
 * `router.ts` — token-leak risk only applies to the `hybrid` path which
 * handles `pii`-only content.
 *
 * Cross-task isolation: the in-memory `drafts` Map is process-local. Token
 * counters reset per `tokenizeForFrontier` call. Calling rehydrate on one
 * approvalId never substitutes tokens from another approvalId's table.
 */
import { DEFAULT_PII_PATTERNS, DEFAULT_PII_PATTERN_NAMES } from '../log/redact';

export interface TokenTable {
  [token: string]: string; // e.g. 'EMAIL_1' -> 'foo@bar.com'
}

export interface TokenizedPrompt {
  prompt: string;
  table: TokenTable;
}

/**
 * Map regex-pattern name (DEFAULT_PII_PATTERN_NAMES) → token prefix used in
 * the substituted prompt. Parallel to the pattern list in
 * `src/main/log/redact.ts`.
 */
const PATTERN_TOKEN_PREFIX: Record<string, string> = {
  email: 'EMAIL',
  ssn: 'SSN',
  phone: 'PHONE',
  currency: 'AMT',
  bearer: 'BEARER',
  'oauth-code': 'OAUTHCODE',
};

// Process-local. Cleared by `disposeDraftTable(approvalId)` after send/reject.
const drafts = new Map<string, TokenTable>();

export function tokenizeForFrontier(
  approvalId: string,
  raw: string,
): TokenizedPrompt {
  const table: TokenTable = {};
  const counters = new Map<string, number>();
  let out = raw;
  for (let i = 0; i < DEFAULT_PII_PATTERNS.length; i++) {
    const re = DEFAULT_PII_PATTERNS[i]!;
    const name = DEFAULT_PII_PATTERN_NAMES[i] ?? `pat${i}`;
    const prefix = PATTERN_TOKEN_PREFIX[name] ?? name.toUpperCase();
    re.lastIndex = 0;
    out = out.replace(re, (match) => {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      const token = `${prefix}_${n}`;
      table[token] = match;
      return token;
    });
    re.lastIndex = 0;
  }
  drafts.set(approvalId, table);
  return { prompt: out, table };
}

export function rehydrate(
  approvalId: string,
  frontierResponse: string,
): string {
  const table = drafts.get(approvalId);
  if (!table) throw new Error(`no-token-table:${approvalId}`);
  let out = frontierResponse;
  // Replace longer tokens first to avoid prefix collisions (e.g. EMAIL_10 vs
  // EMAIL_1). Sort by token length descending.
  const tokens = Object.keys(table).sort((a, b) => b.length - a.length);
  for (const token of tokens) {
    out = out.split(token).join(table[token]!);
  }
  return out;
}

export function disposeDraftTable(approvalId: string): void {
  drafts.delete(approvalId);
}

/** Test-only: clear all tables between tests. */
export function _resetDraftTablesForTests(): void {
  drafts.clear();
}

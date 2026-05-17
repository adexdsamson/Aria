/**
 * Single source-of-truth PII redaction utilities used by:
 *   - the pino log sink (src/main/log/pino.ts) — applied on every log entry
 *   - Plan 04 sensitivity classifier (re-exports DEFAULT_PII_PATTERNS)
 *
 * Patterns are intentionally conservative — they trade false positives for
 * leak resistance. Anything matching is replaced with the literal `[REDACTED]`.
 */

export const REDACTED = '[REDACTED]';

/** Default PII regex set. Order matters — see DEFAULT_PII_PATTERN_NAMES /_TOKENS. */
export const DEFAULT_PII_PATTERNS: RegExp[] = [
  // Email (RFC 5322-lite). Global so `replace` hits every occurrence.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // SSN — must come before phone so 123-45-6789 isn't masked as a phone fragment.
  /\b\d{3}-\d{2}-\d{4}\b/g,
  // Phone (E.164 / NANP-ish): optional +, optional country, separators or none, 7-15 digits total.
  /(?:(?:\+?\d{1,3}[-.\s])?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4})/g,
  // Currency amounts: $1, $1.50, $1,234.56
  /\$\d{1,3}(?:,\d{3})*(?:\.\d+)?|\$\d+(?:\.\d+)?/g,
  // Plan 02-01 (T-02-01-02): OAuth bearer access tokens. Conservative; this
  // covers Google's URL-safe base64 access_token format including '.' / '-' / '_' / '+' / '/' / '~' / '=' padding.
  /Bearer\s+[A-Za-z0-9._\-~+/]+=*/g,
  // Plan 02-01 (T-02-01-02): OAuth authorization code (loopback redirect query).
  /code=[A-Za-z0-9._\-/]+/g,
];

/**
 * Stable, ordered names — parallel to DEFAULT_PII_PATTERNS. Used by the
 * classifier to label which pattern matched in routing_log reasons.
 *
 * Single source of truth: anything that reasons about pattern identity
 * (classifier, briefing M1 redactor) imports this array.
 */
export const DEFAULT_PII_PATTERN_NAMES: ReadonlyArray<string> = [
  'email',
  'ssn',
  'phone',
  'currency',
  'bearer',
  'oauth-code',
] as const;

/**
 * Per-pattern placeholder tokens — parallel to DEFAULT_PII_PATTERNS. Used by
 * the briefing M1 redactor (UAT Gap 9) to produce semantic placeholders
 * (`<EMAIL>`, `<PHONE>`, ...) rather than a single opaque `[REDACTED]`. The
 * pino log sink keeps using `[REDACTED]` via `redactString` since logs don't
 * need to preserve semantic shape.
 */
export const DEFAULT_PII_PATTERN_TOKENS: ReadonlyArray<string> = [
  '<EMAIL>',
  '<SSN>',
  '<PHONE>',
  '<AMOUNT>',
  '<BEARER>',
  '<OAUTH_CODE>',
] as const;

/**
 * Redact every match of every pattern in `s` with `[REDACTED]`.
 * Returns the original string unchanged if no pattern matches.
 */
export function redactString(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return s;
  let out = s;
  for (const re of DEFAULT_PII_PATTERNS) {
    // Reset lastIndex defensively for global regexes shared across calls.
    re.lastIndex = 0;
    out = out.replace(re, REDACTED);
  }
  return out;
}

/**
 * Deep-walk `obj` and redact every string leaf. Arrays, objects, and primitive
 * non-strings are preserved structurally; cycles are broken with a WeakSet so
 * accidental self-references in log payloads don't crash the logger.
 */
export function redactObject<T>(obj: T): T {
  const seen = new WeakSet<object>();
  function walk(v: unknown): unknown {
    if (v === null || v === undefined) return v;
    if (typeof v === 'string') return redactString(v);
    if (typeof v !== 'object') return v;
    if (seen.has(v as object)) return '[Circular]';
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>)) {
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return walk(obj) as T;
}

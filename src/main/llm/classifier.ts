/**
 * Hard-rules sensitivity classifier (Plan 04 Task 1).
 *
 * Re-exports DEFAULT_PII_PATTERNS from src/main/log/redact.ts so the classifier
 * and the pino redactor can never drift. `classifySensitivity(prompt)` walks
 * each named pattern and returns the list of pattern names that matched.
 *
 * Pattern names (for the verbatim routing-log reason string):
 *   - 'email'
 *   - 'ssn'
 *   - 'phone'
 *   - 'currency'
 *
 * Order matches DEFAULT_PII_PATTERNS in src/main/log/redact.ts.
 */
import { DEFAULT_PII_PATTERNS } from '../log/redact';

export { DEFAULT_PII_PATTERNS };

/** Stable, ordered names — parallel to DEFAULT_PII_PATTERNS. */
export const PII_PATTERN_NAMES: ReadonlyArray<string> = [
  'email',
  'ssn',
  'phone',
  'currency',
] as const;

export interface ClassifierResult {
  sensitive: boolean;
  matched: string[];
}

/**
 * Return the set of pattern names that match anywhere in `prompt`. Empty
 * string and non-string values return `{ sensitive: false, matched: [] }`.
 *
 * Side-effect safety: each pattern's `lastIndex` is reset before use because
 * the same global RegExp objects are shared with the pino redactor.
 */
export function classifySensitivity(prompt: string): ClassifierResult {
  if (typeof prompt !== 'string' || prompt.length === 0) {
    return { sensitive: false, matched: [] };
  }
  const matched: string[] = [];
  for (let i = 0; i < DEFAULT_PII_PATTERNS.length; i++) {
    const re = DEFAULT_PII_PATTERNS[i]!;
    re.lastIndex = 0;
    if (re.test(prompt)) {
      matched.push(PII_PATTERN_NAMES[i] ?? `pattern-${i}`);
    }
    re.lastIndex = 0;
  }
  return { sensitive: matched.length > 0, matched };
}

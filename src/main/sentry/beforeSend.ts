/**
 * Plan 08-03 Task 2 — Sentry beforeSend allowlist (LEARN-02 mitigation T-08-11).
 *
 * Aria does not currently initialize Sentry, but if/when @sentry/electron is
 * added in Phase 8 Release Prep this module is the single gate that filters
 * learning-pipeline events. The Phase 1 telemetry posture (privacy-constrained,
 * opt-in only) requires that NO event tagged `scope:'learning'` or referencing
 * the `learning_signals` table ever leaves the device.
 *
 * Returning `null` from beforeSend drops the event entirely.
 */

/**
 * Minimal Sentry event shape used by beforeSend. We avoid importing
 * @sentry/* types here to keep this module zero-dependency (and so the
 * static-grep ratchet under src/main/learning/* never has a transitive
 * Sentry import even when the future Sentry init module wires this in).
 */
export interface SentryEventLike {
  tags?: Record<string, string | number | boolean | undefined> | null;
  message?: string;
  exception?: {
    values?: Array<{ type?: string; value?: string }>;
  };
  extra?: Record<string, unknown> | null;
}

const FORBIDDEN_TAG_VALUES = new Set(['learning', 'signals']);
const FORBIDDEN_MESSAGE_SUBSTRINGS = [
  'learning_signals',
  'learned_preferences',
];

export function beforeSend<T extends SentryEventLike>(event: T): T | null {
  // 1. Drop if tagged scope:'learning' (any case).
  const scopeTag = event.tags?.scope;
  if (typeof scopeTag === 'string' && FORBIDDEN_TAG_VALUES.has(scopeTag.toLowerCase())) {
    return null;
  }

  // 2. Drop if the event message mentions a learning table.
  if (typeof event.message === 'string') {
    const lower = event.message.toLowerCase();
    for (const needle of FORBIDDEN_MESSAGE_SUBSTRINGS) {
      if (lower.includes(needle)) return null;
    }
  }

  // 3. Drop if any exception value mentions a learning table (catches throws
  //    out of writeSignal that bubble up to a global handler).
  if (event.exception?.values?.length) {
    for (const v of event.exception.values) {
      const text = `${v.type ?? ''} ${v.value ?? ''}`.toLowerCase();
      for (const needle of FORBIDDEN_MESSAGE_SUBSTRINGS) {
        if (text.includes(needle)) return null;
      }
    }
  }

  return event;
}

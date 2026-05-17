/**
 * Plan 02-04 — M1 PII redaction for briefing prompt assembly.
 *
 * The briefing engine routes through Phase 1's `LLMRouter.classify({source:'generic'})`.
 * Without redaction, raw PII in candidate fields would either:
 *   (a) trip the classifier's PII hard-rules and force LOCAL routing, OR
 *   (b) leak verbatim to the FRONTIER provider (Anthropic/OpenAI/Google) in the
 *       prompt body.
 *
 * Both outcomes are bad: (a) downgrades briefing quality and — when Ollama is
 * not installed (FRONTIER_ONLY mode) — fails the call entirely with
 * ECONNREFUSED; (b) leaks PII.
 *
 * UAT Gap 9 invariant (Plan 02-04 + UAT 02-UAT.md): every classifier PII
 * pattern is redacted before prompt assembly. Classifier and briefing
 * redactor share `DEFAULT_PII_PATTERNS` and `DEFAULT_PII_PATTERN_TOKENS`
 * from `src/main/log/redact.ts` — single source of truth.
 *
 * Tokens (parallel to DEFAULT_PII_PATTERNS):
 *   email      → <EMAIL>
 *   ssn        → <SSN>
 *   phone      → <PHONE>
 *   currency   → <AMOUNT>
 *   bearer     → <BEARER>
 *   oauth-code → <OAUTH_CODE>
 *
 * NOT touched: news candidate `url` fields — URLs are not PII for the
 * classifier and the renderer needs the raw href to build the back-link.
 *
 * Idempotent: redactAllPii(redactAllPii(x)) === redactAllPii(x) for the
 * email-shape pattern. Phone/currency/bearer/oauth-code placeholders contain
 * no characters that re-match their patterns, so they are stable. Returns a
 * NEW candidate object — never mutates input.
 */

import type { NewsCandidate } from '../news/hn';
import {
  DEFAULT_PII_PATTERNS,
  DEFAULT_PII_PATTERN_TOKENS,
} from '../log/redact';

/**
 * Canonical email-shape regex used by Phase 1's classifier
 * (`src/main/log/redact.ts` `DEFAULT_PII_PATTERNS[0]`). Re-declared here as a
 * NON-global regex factory so callers control `lastIndex` themselves (we use
 * `.replace` with `/g` for the actual substitution).
 *
 * Kept for back-compat with the residual-email defense-in-depth check in
 * `src/main/briefing/generate.ts`.
 */
export const EMAIL_TOKEN_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Replace every PII-shape substring (per DEFAULT_PII_PATTERNS) in `s` with
 * its corresponding token from DEFAULT_PII_PATTERN_TOKENS. Returns the input
 * unchanged if no pattern matches.
 */
export function redactAllPii(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return s;
  let out = s;
  for (let i = 0; i < DEFAULT_PII_PATTERNS.length; i++) {
    const re = DEFAULT_PII_PATTERNS[i]!;
    const token = DEFAULT_PII_PATTERN_TOKENS[i] ?? '[REDACTED]';
    re.lastIndex = 0;
    out = out.replace(re, token);
    re.lastIndex = 0;
  }
  return out;
}

/**
 * @deprecated — prefer `redactAllPii`. Kept as a thin wrapper around the
 * email pattern only so existing call sites and tests don't break.
 */
export function redactEmailString(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return s;
  // Build a fresh regex per call to avoid lastIndex carry-over across calls.
  return s.replace(new RegExp(EMAIL_TOKEN_REGEX.source, 'g'), '<EMAIL>');
}

export interface CalendarCandidate {
  id: string;
  title: string;
  startsAt?: string | null;
  allDay?: boolean;
  location?: string | null;
}

export interface EmailCandidate {
  id: string;
  subject: string;
  from_addr: string;
  snippet: string;
  received_at: string;
}

export interface BriefingCandidates {
  calendar: CalendarCandidate[];
  email: EmailCandidate[];
  news: NewsCandidate[];
}

/**
 * Walk a candidate set and apply the full PII redactor to every string field
 * EXCEPT news[i].url (preserved verbatim — the renderer needs it). Returns a
 * brand-new object; does not mutate input.
 *
 * UAT Gap 9 — broadened from email-only (`redactEmailsInBriefingInput`) to
 * cover phone/ssn/currency/bearer/oauth-code so the classifier does not trip
 * on meeting IDs, dial-ins, dollar amounts, etc. in briefing prompts.
 */
export function redactPiiInBriefingInput(c: BriefingCandidates): BriefingCandidates {
  return {
    calendar: c.calendar.map((e) => ({
      ...e,
      title: redactAllPii(e.title),
      location: e.location != null ? redactAllPii(e.location) : e.location,
    })),
    email: c.email.map((e) => ({
      ...e,
      subject: redactAllPii(e.subject),
      from_addr: redactAllPii(e.from_addr),
      snippet: redactAllPii(e.snippet),
    })),
    news: c.news.map((n) => ({
      ...n,
      title: redactAllPii(n.title),
      // url intentionally NOT redacted — not PII for the classifier and the
      // renderer needs the raw href.
    })),
  };
}

/**
 * @deprecated — prefer `redactPiiInBriefingInput`. Kept as an alias so
 * pre-Gap-9 call sites still compile. Will be removed in a follow-up cleanup.
 */
export const redactEmailsInBriefingInput = redactPiiInBriefingInput;

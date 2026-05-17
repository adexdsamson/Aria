/**
 * Plan 02-04 — M1 PII redaction for briefing prompt assembly.
 *
 * The briefing engine routes through Phase 1's `LLMRouter.classify({source:'generic'})`.
 * Without redaction, raw sender emails in `gmail_message.from_addr` would either
 *   (a) trip the classifier's PII hard-rules and force LOCAL routing, OR
 *   (b) leak verbatim to the FRONTIER provider (Anthropic/OpenAI/Google) in the
 *       prompt body.
 *
 * Both outcomes are bad: (a) downgrades briefing quality, (b) leaks PII.
 *
 * Solution (M1 / T-02-04-01): replace every raw email-address-shaped substring
 * with the literal token `<EMAIL>` BEFORE prompt assembly. Display-names in the
 * canonical "Name <addr@example.com>" form are preserved so the LLM still gets
 * useful sender context ("Adex Samson <EMAIL>"). After redaction the prompt
 * contains zero matches for `/\S+@\S+\.\S+/`, the classifier sees no PII, and
 * routing is preserved to FRONTIER (per CONTEXT.md cost expectation).
 *
 * NOT touched: news candidate `url` fields — URLs are not PII for the
 * classifier and the renderer needs the raw href to build the back-link.
 *
 * Idempotent: redact(redact(x)) === redact(x). Returns a NEW candidate object —
 * never mutates input.
 */

import type { NewsCandidate } from '../news/hn';

/**
 * Canonical email-shape regex used by Phase 1's classifier
 * (`src/main/log/redact.ts` `DEFAULT_PII_PATTERNS[0]`). Re-declared here as a
 * NON-global regex factory so callers control `lastIndex` themselves (we use
 * `.replace` with `/g` for the actual substitution).
 */
export const EMAIL_TOKEN_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const EMAIL_TOKEN = '<EMAIL>';

/** Replace every email-shape substring in `s` with `<EMAIL>`. */
export function redactEmailString(s: string): string {
  if (typeof s !== 'string' || s.length === 0) return s;
  // Build a fresh regex per call to avoid lastIndex carry-over across calls.
  return s.replace(new RegExp(EMAIL_TOKEN_REGEX.source, 'g'), EMAIL_TOKEN);
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
 * Walk a candidate set and replace every email-address-shaped substring with
 * `<EMAIL>` in every string field EXCEPT news[i].url (preserved verbatim — the
 * renderer needs it). Returns a brand-new object; does not mutate input.
 */
export function redactEmailsInBriefingInput(c: BriefingCandidates): BriefingCandidates {
  return {
    calendar: c.calendar.map((e) => ({
      ...e,
      title: redactEmailString(e.title),
      location: e.location != null ? redactEmailString(e.location) : e.location,
    })),
    email: c.email.map((e) => ({
      ...e,
      subject: redactEmailString(e.subject),
      from_addr: redactEmailString(e.from_addr),
      snippet: redactEmailString(e.snippet),
    })),
    news: c.news.map((n) => ({
      ...n,
      title: redactEmailString(n.title),
      // url intentionally NOT redacted — not PII for the classifier and the
      // renderer needs the raw href.
    })),
  };
}

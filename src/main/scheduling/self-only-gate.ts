/**
 * Plan 04-03 Task 1 — Self-only attendee gate.
 *
 * APPR-02 v1 ships self-only calendar changes ONLY. Multi-attendee events
 * must be refused BEFORE alternatives are generated so the user gets clear
 * guidance to handle the change in Google Calendar instead.
 *
 * Predicate (RESEARCH Pitfall 5 — self-only is TWO predicates):
 *   - organizer.self === true AND organizer.email matches userEmail
 *   - AND attendees is undefined OR every attendee.email === organizer.email
 *
 * Undefined `attendees` is treated as self-only (Google omits the field for
 * solo events).
 */

export interface SelfOnlyEvent {
  organizer?: { email?: string | null; self?: boolean | null };
  attendees?: Array<{ email?: string | null; self?: boolean | null }>;
}

export type SelfOnlyGateCode = 'multi-attendee' | 'no-organizer';

export class SelfOnlyGateError extends Error {
  readonly code: SelfOnlyGateCode;
  constructor(code: SelfOnlyGateCode, message?: string) {
    super(message ?? code);
    this.name = 'SelfOnlyGateError';
    this.code = code;
  }
}

export function isSelfOnly(event: SelfOnlyEvent, userEmail: string): boolean {
  const organizer = event.organizer;
  if (!organizer || !organizer.email) return false;
  if (organizer.self !== true) {
    // Best-effort: when self flag is missing but email matches, still self-organized.
    if (organizer.email.toLowerCase() !== userEmail.toLowerCase()) return false;
  } else {
    // organizer.self === true; still ensure email aligns when present.
    if (organizer.email && organizer.email.toLowerCase() !== userEmail.toLowerCase()) {
      // Allow — Google sometimes reports a domain-aliased organizer email
      // alongside self=true. The self flag is authoritative.
    }
  }

  const attendees = event.attendees;
  if (!attendees || attendees.length === 0) return true;

  const orgEmail = organizer.email.toLowerCase();
  const userEmailLc = userEmail.toLowerCase();
  for (const a of attendees) {
    const ae = (a.email ?? '').toLowerCase();
    if (!ae) {
      // Resource / unspecified attendee — treat as external.
      return false;
    }
    if (ae !== orgEmail && ae !== userEmailLc) {
      return false;
    }
  }
  return true;
}

export function assertSelfOnly(event: SelfOnlyEvent, userEmail: string): void {
  if (!event.organizer || !event.organizer.email) {
    throw new SelfOnlyGateError(
      'no-organizer',
      'event has no organizer — refusing to apply self-only calendar change',
    );
  }
  if (!isSelfOnly(event, userEmail)) {
    throw new SelfOnlyGateError(
      'multi-attendee',
      'multi-attendee calendar changes are not supported in v1',
    );
  }
}

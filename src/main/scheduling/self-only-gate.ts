/**
 * Plan 04-03 Task 1 - Self-only attendee gate.
 *
 * APPR-02 v1 ships self-only calendar changes ONLY. Multi-attendee events
 * must be refused BEFORE alternatives are generated so the user gets clear
 * guidance to handle the change in the source calendar instead.
 */

export interface SelfOnlyEvent {
  organizer?: { email?: string | null; self?: boolean | null };
  attendees?: Array<{ email?: string | null; self?: boolean | null }>;
}

export interface IdentitySet {
  primaryEmail: string;
  aliases: string[];
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

function normalizeIdentity(identity: string | IdentitySet): IdentitySet {
  if (typeof identity === 'string') {
    return { primaryEmail: identity, aliases: [identity] };
  }
  return {
    primaryEmail: identity.primaryEmail,
    aliases: [...new Set([identity.primaryEmail, ...identity.aliases].filter(Boolean))],
  };
}

function identityMatches(email: string | null | undefined, identity: IdentitySet): boolean {
  if (!email) return false;
  const lc = email.toLowerCase();
  return [identity.primaryEmail, ...identity.aliases].some((candidate) => candidate.toLowerCase() === lc);
}

export function isSelfOnly(event: SelfOnlyEvent, userEmail: string): boolean;
export function isSelfOnly(event: SelfOnlyEvent, identitySet: IdentitySet): boolean;
export function isSelfOnly(event: SelfOnlyEvent, identity: string | IdentitySet): boolean {
  const identitySet = normalizeIdentity(identity);
  const organizer = event.organizer;
  if (!organizer || !organizer.email) return false;
  if (organizer.self !== true) {
    if (!identityMatches(organizer.email, identitySet)) return false;
  }

  const attendees = event.attendees;
  if (!attendees || attendees.length === 0) return true;

  const orgEmail = organizer.email.toLowerCase();
  for (const attendee of attendees) {
    const attendeeEmail = (attendee.email ?? '').toLowerCase();
    if (!attendeeEmail) return false;
    if (attendeeEmail !== orgEmail && !identityMatches(attendeeEmail, identitySet)) {
      return false;
    }
  }
  return true;
}

export function assertSelfOnly(event: SelfOnlyEvent, userEmail: string): void;
export function assertSelfOnly(event: SelfOnlyEvent, identitySet: IdentitySet): void;
export function assertSelfOnly(event: SelfOnlyEvent, identity: string | IdentitySet): void {
  if (!event.organizer || !event.organizer.email) {
    throw new SelfOnlyGateError(
      'no-organizer',
      'event has no organizer - refusing to apply self-only calendar change',
    );
  }
  if (!isSelfOnly(event, normalizeIdentity(identity))) {
    throw new SelfOnlyGateError(
      'multi-attendee',
      'multi-attendee calendar changes are not supported in v1',
    );
  }
}

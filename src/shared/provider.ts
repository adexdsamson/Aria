export type ProviderKey = 'google' | 'microsoft';

export interface DeltaResult<T> {
  items: T[];
  tombstones: string[];
  cursor: string;
  hadFullResync: boolean;
}

export interface CanonicalMessage {
  externalId: string;
  threadId: string;
  fromAddr: string;
  subject: string;
  snippet: string;
  receivedAtUtc: string;
  labels: string[];
  isUnread: boolean;
  isImportant: boolean;
  bodyText?: string | null;
}

export interface CanonicalEvent {
  externalId: string;
  summary: string;
  startAtUtc: string | null;
  endAtUtc: string | null;
  startDate?: string | null;
  endDate?: string | null;
  isAllDay: boolean;
  isRecurring: boolean;
  recurrence?: string[] | null;
  recurrenceUnsupported?: boolean;
  location?: string | null;
  description?: string | null;
  webLink?: string | null;
  iCalUid?: string | null;
  organizerEmail?: string | null;
  organizerSelf?: boolean | null;
  attendees?: Array<{
    email: string | null;
    self?: boolean | null;
    type?: string | null;
  }>;
}

export interface MailSendInput {
  to: string[];
  subject: string;
  bodyText: string;
  cc?: string[];
  bcc?: string[];
  inReplyToExternalId?: string | null;
  references?: string[];
}

export interface MailCapability {
  listMessagesDelta(opts?: { cursor?: string | null }): Promise<DeltaResult<CanonicalMessage>>;
  getMessage(externalId: string): Promise<CanonicalMessage | null>;
  sendMessage(message: MailSendInput, opts: { idempotencyKey: string }): Promise<{ externalId: string }>;
  findSentByIdempotencyKey(key: string): Promise<string | null>;
  upsertDraft?(message: MailSendInput): Promise<{ externalId: string }>;
}

export interface CalendarCapability {
  listEventsDelta(opts?: { cursor?: string | null; startDateTime?: string; endDateTime?: string }): Promise<DeltaResult<CanonicalEvent>>;
  listEventsWindow(opts: { startDateTime: string; endDateTime: string }): Promise<DeltaResult<CanonicalEvent>>;
  getEvent(externalId: string): Promise<CanonicalEvent | null>;
  patchEvent(args: { externalId: string; event: Partial<CanonicalEvent>; ifMatch?: string; sendUpdates?: 'none' | 'all' | 'externalOnly' }): Promise<{ externalId: string; etag?: string }>;
  insertEvent(args: { event: Partial<CanonicalEvent>; sendUpdates?: 'none' | 'all' | 'externalOnly' }): Promise<{ externalId: string; etag?: string }>;
  eventInstances(args: { externalId: string; startDateTime: string; endDateTime: string }): Promise<CanonicalEvent[]>;
  freeBusy(args: { startDateTime: string; endDateTime: string; calendarIds: string[] }): Promise<Record<string, Array<{ start: string; end: string }>>>;
}

export interface ProviderCapabilities {
  recurrenceFormat: 'rrule' | 'graph';
  supportsSendUpdates: boolean;
  mailLabelModel: 'gmail' | 'outlook';
  mailSendReturnsId: boolean;
}

export interface Provider {
  providerKey: ProviderKey;
  accountId: string;
  accountEmail: string;
  capabilities: ProviderCapabilities;
  mail?: MailCapability;
  calendar?: CalendarCapability;
  disconnect?: () => Promise<void> | void;
}

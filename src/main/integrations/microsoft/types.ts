export type {
  ProviderKey,
  DeltaResult,
  CanonicalMessage,
  CanonicalEvent,
  MailSendInput,
  MailCapability,
  CalendarCapability,
  ProviderCapabilities,
  Provider,
} from '../../../shared/provider';

export type MicrosoftProviderKey = 'microsoft';

export interface IdentitySet {
  primaryEmail: string;
  aliases: string[];
}

export interface MicrosoftSelfIdentity {
  upn: string;
  mail: string;
  proxyAddresses: string[];
  displayName: string;
  primaryEmail: string;
  identitySet: IdentitySet;
}

export interface ProviderAccountInput {
  providerKey: 'google' | 'microsoft';
  accountId: string;
  displayEmail: string;
  displayLabel?: string | null;
  displayColor?: string | null;
  status?: 'ok' | 'degraded' | 'needs-auth' | 'disconnected';
  identitySet?: IdentitySet | null;
  capabilitiesJson?: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
  lastErrorAt?: string | null;
}

export type ProviderAccountStatus = NonNullable<ProviderAccountInput['status']>;

export interface ProviderAccountRow extends ProviderAccountInput {
  createdAt: string;
}

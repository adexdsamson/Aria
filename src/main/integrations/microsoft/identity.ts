import { TokenInvalidError } from './errors';
import type { MicrosoftSelfIdentity } from './types';

function asStringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function pickPrimaryEmail(mail: string, upn: string, displayName: string): string {
  const candidates = [mail, upn, displayName];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return '';
}

export async function fetchSelfIdentity(accessToken: string): Promise<MicrosoftSelfIdentity> {
  const res = await fetch(
    'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,proxyAddresses,displayName',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    },
  );

  if (res.status === 401) {
    throw new TokenInvalidError({ reason: 'expired', message: 'Microsoft Graph rejected access token' });
  }
  if (!res.ok) {
    throw new Error(`fetchSelfIdentity failed: HTTP ${res.status}`);
  }

  const body = (await res.json()) as {
    mail?: string | null;
    userPrincipalName?: string | null;
    proxyAddresses?: unknown;
    displayName?: string | null;
  };

  const mail = body.mail ?? '';
  const upn = body.userPrincipalName ?? '';
  const displayName = body.displayName ?? '';
  const proxyAddresses = asStringList(body.proxyAddresses);
  const primaryEmail = pickPrimaryEmail(mail, upn, displayName);

  return {
    upn,
    mail,
    proxyAddresses,
    displayName,
    primaryEmail,
    identitySet: {
      primaryEmail,
      aliases: [...new Set([mail, upn, ...proxyAddresses].filter((s): s is string => typeof s === 'string' && s.length > 0))],
    },
  };
}

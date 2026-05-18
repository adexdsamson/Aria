# Phase 5: Outlook Parity (Email + Calendar) — Research

**Researched:** 2026-05-18
**Domain:** Microsoft Graph (Outlook Mail + Calendar) via MSAL-node, provider abstraction across Google + Microsoft
**Confidence:** HIGH on MSAL/Graph mechanics, MEDIUM on recurrence round-tripping edge cases, MEDIUM on dev-tenant cost/limits

## Summary

This phase adds an Outlook (Microsoft Graph) adapter alongside the existing Google adapter built in Phases 2 and 4, then unifies them behind a single `Provider` interface with capability flags. The Graph side mirrors the Google patterns we already have: a thin SDK wrapper exposing domain-typed methods, a sync engine that page-loops a delta cursor, a chokepoint for writes gated by `assertApproved`, and per-account keyring helpers.

The main novelty Graph forces on us:

1. **OAuth via MSAL-node PKCE** instead of `google-auth-library`'s loopback flow. The shape is similar (auth code + loopback redirect + token cache) but MSAL persists a richer token cache including the OID/tid claims and `homeAccountId`, which is the right stable key for multi-account.
2. **Delta queries** instead of `historyId` for Gmail and `syncToken` for Google Calendar. Same semantics (cursor advances after every call, 410-equivalent on expiration), different field name (`@odata.deltaLink`), and a hard 7-day TTL when idle.
3. **Recurrence is an object, not a string list.** Graph's `recurrence.pattern` + `recurrence.range` must be converted to/from RFC5545 RRULE at the boundary. Our CONTEXT locks RFC5545 as canonical (Decision §"Recurring event normalization"), and refuses on lossy conversion.
4. **Throttling is more aggressive than Google.** Graph returns 429 with `Retry-After` headers regularly under burst load; our existing `p-queue` discipline handles serialization, but we need an explicit Retry-After-respecting backoff.

**Primary recommendation:** Build the Outlook adapter as a peer of the Google adapter in plan 1 (auth + clients + sync), then introduce the unified `Provider` interface in plan 2 as a refactor that wraps both. Defer adapter unification's "delete the Google-specific code paths" until plan 3 to keep regression risk bounded — CONTEXT explicitly accepts this temporary duplication.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MSAL OAuth dance (BrowserWindow + loopback) | Electron main | — | Renderer cannot intercept loopback redirects; same pattern as Google |
| Token cache + refresh | Electron main (safeStorage) | — | Secrets never leave main process; mirrors Phase 1 / 2 |
| Graph HTTP requests | Electron main (sync engine, p-queue serialized) | — | Single-writer SQLite discipline + rate-limit serialization (Phase 2 L) |
| Delta cursor persistence | SQLite (`provider_sync_state` table) | — | CONTEXT D-§"Sync state" |
| Recurrence conversion (Graph ↔ RFC5545) | Pure module (`recurrence-graph.ts`) | — | Unit-testable; no I/O; mirrors Phase 4 `recurrence.ts` |
| Approval gate / chokepoint | Existing `applyCalendarChange` + `sendApprovedEmail` chokepoints, generalized over Provider | — | D-04-01 ratchet — never split write sites |
| Multi-account UI (account chip, color, label) | Renderer (React) | Main IPC for account list | CONTEXT §"Unified UI" |
| Provider failure isolation | Electron main scheduler (per-provider p-queue) | — | CONTEXT §"Failure isolation" |

## Standard Stack

### Core (additions for this phase)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@azure/msal-node` | ^3.x | OAuth (auth code + PKCE), token cache, refresh | Microsoft's official Node OAuth library; only sane way to handle MSA / AAD / B2C edge cases [CITED: learn.microsoft.com/en-us/entra/msal/node/] |
| `@microsoft/microsoft-graph-client` | ^3.x | Graph HTTP request builder, middleware, batch | Official SDK; aligns with CLAUDE.md tech stack pin |
| `isomorphic-fetch` (peer of graph-client) | ^3.x | Fetch implementation graph-client depends on | Graph SDK does not bundle fetch — Node 20 has global `fetch` but graph-client v3 still checks for it on import [ASSUMED — verify against graph-client v3 changelog at install time] |

### Already in repo, reused

| Library | Version | Reused for |
|---------|---------|------------|
| `rrule` | ^2.8.1 | RFC5545 ↔ Graph pattern conversion (parse + format) |
| `p-queue` | 8.x | Per-provider serialization queues (one queue per `providerKey:accountId`) |
| `node-cron` | 3.x | Outlook poll schedules (5 min mail / 15 min calendar — matches Google) |
| `better-sqlite3-multiple-ciphers` | 11.x | `provider_sync_state`, `provider_account`, normalized event/message rows |
| `electron` `safeStorage` | (Electron 41.6.1) | Per-provider keyring entries |

### Alternatives Considered (rejected — do not propose to user)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| `@azure/msal-node` | Manual OAuth 2.0 + `node-fetch` against `login.microsoftonline.com` | Cache/refresh + AAD edge cases is weeks of work; MSAL is non-negotiable [CITED: CLAUDE.md tech stack] |
| `@microsoft/microsoft-graph-client` | Raw `fetch` against `https://graph.microsoft.com/v1.0` | We lose middleware (retry, auth header injection, batch composition); but SDK is a thin shell — if we ever needed to drop it, the call sites are small |
| Native iCalendar lib (`ical.js`) | `rrule` | We already have `rrule`; iCal.js adds VEVENT-component parsing we don't need here |
| Graph subscriptions (webhooks) | — | DEFERRED in CONTEXT (`<deferred>`). Requires HTTPS public endpoint; tunnel infra not in v1 scope |

**Installation:**
```bash
npm install @azure/msal-node@^3 @microsoft/microsoft-graph-client@^3 isomorphic-fetch@^3
npm install --save-dev @types/microsoft-graph
```

**Version verification (run before plan-checker):**
```bash
npm view @azure/msal-node version
npm view @microsoft/microsoft-graph-client version
npm view @types/microsoft-graph version
```

Pin majors in `package.json`; CLAUDE.md tech stack snapshot already locks majors. [ASSUMED — minor versions current as of 2026-05; verify at install]

## Architecture Patterns

### System Architecture Diagram

```
                ┌────────────────────────────────────────────────┐
                │              Renderer (React)                  │
                │  - Settings/Integrations: Add account, status  │
                │  - ApprovalCard (provider-agnostic)            │
                │  - Unified calendar grid + briefing            │
                └────────────────┬───────────────────────────────┘
                                 │ IPC
                ┌────────────────▼───────────────────────────────┐
                │           Electron Main Process                │
                │                                                │
                │  ┌──────────────────────────────────────────┐  │
                │  │  ProviderRegistry                         │  │
                │  │  - Map<(providerKey, accountId), Provider>│  │
                │  │  - per-provider p-queue                  │  │
                │  └────┬──────────────────┬──────────────────┘  │
                │       │                  │                      │
                │  ┌────▼──────────┐  ┌────▼──────────┐           │
                │  │ GoogleProvider│  │OutlookProvider│ ← NEW     │
                │  │ (gmail+cal)   │  │ (mail+cal)    │           │
                │  └────┬──────────┘  └────┬──────────┘           │
                │       │                  │                      │
                │  ┌────▼──────────┐  ┌────▼──────────┐           │
                │  │googleapis SDK │  │ msal-node +   │           │
                │  │+ OAuth2Client │  │ graph-client  │           │
                │  └───────────────┘  └───────────────┘           │
                │                                                 │
                │  Cross-cutting (provider-agnostic):             │
                │   - applyCalendarChange  (chokepoint, dispatches│
                │     to provider.calendar.patchEvent)            │
                │   - sendApprovedEmail   (chokepoint, dispatches │
                │     to provider.mail.sendMessage)               │
                │   - SyncOrchestrator   (per-provider cron tick) │
                └────────────────┬───────────────────────────────┘
                                 │ encrypted at rest
                ┌────────────────▼───────────────────────────────┐
                │      SQLCipher SQLite + safeStorage            │
                │  Tables: provider_account, provider_sync_state,│
                │          calendar_event, message, approval, …  │
                │  Keyring: aria:tokens:{provider}:{accountId}   │
                └────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/main/integrations/
├── provider.ts                   # NEW — Provider interface + capability flags
├── registry.ts                   # NEW — ProviderRegistry, per-account dispatch
├── sync-orchestrator.ts          # NEW — per-(provider,account) tick scheduler
├── google/                       # existing — unchanged in plan 1; conformed in plan 2
│   ├── auth.ts
│   ├── calendar.ts
│   ├── gmail.ts
│   ├── recurrence.ts
│   ├── send.ts
│   ├── sync-calendar.ts
│   ├── sync-gmail.ts
│   ├── write-event.ts
│   └── provider-adapter.ts       # NEW (plan 2) — implements Provider over existing code
└── microsoft/                    # NEW
    ├── auth.ts                   # MSAL-node PKCE flow + token cache
    ├── client.ts                 # graph-client wrapper (auth provider injection)
    ├── mail.ts                   # listMessagesDelta, getMessage, sendMail
    ├── calendar.ts               # listEventsDelta, patchEvent, insertEvent
    ├── recurrence-graph.ts       # RRULE ↔ Graph pattern conversion
    ├── send.ts                   # mail send chokepoint adapter
    ├── sync-mail.ts              # delta cursor + upsert (mirrors sync-gmail.ts)
    ├── sync-calendar.ts          # delta cursor + upsert (mirrors sync-calendar.ts)
    ├── write-event.ts            # adapter (or generalized into shared chokepoint)
    └── provider-adapter.ts       # implements Provider for microsoft

src/main/secrets/
└── safeStorage.ts                # extended — providerTokens namespace (plan 1)

migrations/
├── 011_provider_accounts.sql     # provider_account, provider_sync_state
└── 012_message_provider_key.sql  # add providerKey/accountId to message + calendar_event
```

### Pattern 1: MSAL-node PKCE flow in Electron (mirrors Google `connectGoogle`)

**What:** Use `PublicClientApplication` with auth-code + PKCE, loopback redirect URI. Mirror the structure of `src/main/integrations/google/auth.ts`:

```typescript
// src/main/integrations/microsoft/auth.ts
import { PublicClientApplication, type Configuration } from '@azure/msal-node';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { URL } from 'node:url';

const SCOPES = {
  mail: ['Mail.Read', 'Mail.Send', 'offline_access', 'User.Read'],
  calendar: ['Calendars.ReadWrite', 'offline_access', 'User.Read'],
  // CONTEXT: both halves connect together as a single "Add account" flow
  all: ['Mail.Read', 'Mail.Send', 'Calendars.ReadWrite', 'offline_access', 'User.Read'],
} as const;

const TENANT = 'common'; // multi-tenant + personal accounts (MSA + AAD)
const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`;

export async function connectMicrosoft(): Promise<{
  ok: true;
  accountId: string;     // MSAL `homeAccountId` (= "<oid>.<tid>") — stable
  email: string;         // userPrincipalName fallback to mail
  displayName?: string;
}> {
  const clientId = process.env.MS_OAUTH_CLIENT_ID;
  if (!clientId) throw new OAuthConfigMissingError('MS_OAUTH_CLIENT_ID unset');

  // Public client — NO client secret (desktop app, PKCE-only)
  const config: Configuration = {
    auth: { clientId, authority: AUTHORITY },
    // System.web.* is browser-only; we provide our own token cache below.
  };
  const pca = new PublicClientApplication(config);

  // Loopback server identical to Google flow
  const { server, port, close: closeServer } = await createLoopback();
  const redirectUri = `http://localhost:${port}/callback`;
  const state = crypto.randomBytes(32).toString('hex');
  const pkce = await pca.getCryptoProvider().generatePkceCodes();

  const authUrl = await pca.getAuthCodeUrl({
    scopes: [...SCOPES.all],
    redirectUri,
    state,
    codeChallenge: pkce.challenge,
    codeChallengeMethod: 'S256',
    prompt: 'select_account', // multi-account UX — let user pick
  });

  const authWindow = openSandboxedBrowserWindow(authUrl);
  try {
    const { code } = await awaitLoopbackCode({ server, expectedState: state });
    const result = await pca.acquireTokenByCode({
      code,
      scopes: [...SCOPES.all],
      redirectUri,
      codeVerifier: pkce.verifier,
    });
    if (!result.account) throw new Error('MSAL returned no account');

    // Stable identifier for multi-account: homeAccountId = `${oid}.${tid}`
    const accountId = result.account.homeAccountId;
    const email = result.account.username; // UPN; primary mail via /me later if needed
    const displayName = result.account.name;

    // MSAL maintains its own token cache via the configured cache plugin
    // (see Pattern 2). The refresh token is INSIDE that cache — we serialize
    // the cache to safeStorage rather than extracting the refresh token.
    await persistMsalCache(accountId, pca);
    return { ok: true, accountId, email, displayName };
  } finally {
    authWindow.close();
    closeServer();
  }
}
```

**Why this shape:**
- MSAL deliberately does NOT expose the refresh token directly (it's an internal cache concern). We serialize the whole cache to safeStorage instead. [CITED: learn.microsoft.com/en-us/entra/identity-platform/msal-node-token-cache]
- `homeAccountId` is the canonical stable account key. `username` (UPN) can change; `id` on `/me` can in rare tenant migrations. `homeAccountId` is `<oid>.<tid>` — globally unique.
- `prompt: 'select_account'` makes "Add account" work cleanly — multi-account is first-class per CONTEXT.

### Pattern 2: MSAL token cache plugin → safeStorage

**What:** MSAL writes its cache JSON via a `ICachePlugin` interface. We wrap safeStorage:

```typescript
// src/main/integrations/microsoft/cache.ts
import { type ICachePlugin, type TokenCacheContext } from '@azure/msal-node';

export function createSafeStorageCachePlugin(accountId: string): ICachePlugin {
  const key = `microsoft:${accountId}`;
  return {
    async beforeCacheAccess(ctx: TokenCacheContext) {
      const blob = getProviderTokens(key); // returns decrypted string or null
      if (blob) ctx.tokenCache.deserialize(blob);
    },
    async afterCacheAccess(ctx: TokenCacheContext) {
      if (ctx.cacheHasChanged) {
        setProviderTokens(key, ctx.tokenCache.serialize());
      }
    },
  };
}
```

The cache plugin reads/writes the full MSAL cache (refresh + access tokens + account record) as a single encrypted blob per account. This is the documented pattern. [CITED: learn.microsoft.com/en-us/entra/msal/node/cache-plugin]

### Pattern 3: Graph client with MSAL auth provider

```typescript
// src/main/integrations/microsoft/client.ts
import { Client } from '@microsoft/microsoft-graph-client';
import 'isomorphic-fetch';

export function createGraphClient(accountId: string): Client {
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const pca = await getOrBuildPca(accountId); // restores cache
        const account = (await pca.getTokenCache().getAllAccounts())
          .find(a => a.homeAccountId === accountId);
        if (!account) throw new TokenInvalidError({ reason: 'revoked' });
        try {
          const result = await pca.acquireTokenSilent({
            account,
            scopes: ['https://graph.microsoft.com/.default'],
          });
          return result.accessToken;
        } catch (err) {
          // MSAL throws InteractionRequiredAuthError when refresh fails
          if (err.name === 'InteractionRequiredAuthError') {
            throw new TokenInvalidError({ reason: 'expired' });
          }
          throw err;
        }
      },
    },
    // Default middleware chain: RetryHandler (handles 429 with Retry-After),
    // RedirectHandler, AuthenticationHandler, HTTPMessageHandler.
  });
}
```

The default middleware chain already respects `Retry-After` on 429s. [CITED: github.com/microsoftgraph/msgraph-sdk-javascript — RetryHandler]

### Pattern 4: Delta query sync (mirrors `sync-calendar.ts` syncToken loop)

```typescript
// /me/mailFolders/Inbox/messages/delta — preferred over /me/messages/delta
//   because Inbox-only matches our Gmail behavior (we ingest inbox, not Sent)
//
// Initial call:    GET /me/mailFolders/Inbox/messages/delta?$select=…
// Subsequent:      GET <@odata.deltaLink from previous response>
// More pages:      GET <@odata.nextLink>  (still inside the same delta)
//
// Final response of a delta cycle includes @odata.deltaLink — that's the
// next cursor. Persist into provider_sync_state.cursor.

const page = await graph.api(deltaLinkOrInitialPath)
  .header('Prefer', 'outlook.body-content-type="text"') // strip HTML body
  .get();

// page.value          — message[] (or event[] for calendar)
// page['@odata.nextLink']   — more pages in this cycle
// page['@odata.deltaLink']  — next cycle's cursor (advance once exhausted)
```

**Critical**: persist the new `deltaLink` ONLY after all `nextLink` pages drain, then commit upserts + cursor advance in a single `db.transaction`. Same atomic-cursor-advance discipline as Pitfall 11 in `sync-calendar.ts`. [CITED: learn.microsoft.com/en-us/graph/delta-query-overview]

### Pattern 5: Calendar write through generalized chokepoint

CONTEXT D-04-01 + the static-grep ratchet at `tests/static/single-calendar-write-site.test.ts` is non-negotiable. Two options:

**Option A (recommended):** Keep `applyCalendarChange` as the sole chokepoint; inject the provider via `ProviderRegistry.get(approvalRow.providerKey, accountId).calendar`. The chokepoint stays single; the per-provider write strategy lives behind `provider.calendar.patchEvent(...)`.

**Option B:** Two chokepoints (`applyGoogleCalendarChange` / `applyOutlookCalendarChange`). Rejected — splits the ratchet, doubles audit-log scaffolding, splits `assertApproved` enforcement. Plan-checker will reject this.

Update the static-grep ratchet to allow `provider.calendar.patchEvent` calls and `provider.calendar.insertEvent` calls inside `write-event.ts` only — same enforcement, generalized vocabulary.

### Pattern 6: Mail send through generalized chokepoint

Mirror Pattern 5 for Phase 3's `sendApprovedEmail`. Graph's `sendMail` and Gmail's `messages.send` differ at the wire level (Graph takes a JSON `Message` object; Gmail takes base64url RFC822), but the chokepoint contract is identical: `(approvalId) → { ok, providerMessageId? }`.

Graph send: `POST /me/sendMail` with `{ message: { subject, body: { contentType: 'Text', content }, toRecipients: [...] }, saveToSentItems: true }`. No message id returned (202 Accepted with empty body) — log only the approval transition. [CITED: learn.microsoft.com/en-us/graph/api/user-sendmail]

### Anti-Patterns to Avoid

- **Calling `acquireTokenSilent` without first restoring the cache.** Returns `null` on no-account-found, looks like success. Always `getAllAccounts()` first and 404 if missing.
- **Using `@odata.type` discriminators to drive parse logic.** They're present on every entity; ignore them and use TypeScript types from `@types/microsoft-graph`.
- **Calling `/me/messages/delta` (whole mailbox) when only Inbox matters.** Pulls in Sent / Drafts / Junk — every reply the user types triggers a sync. Use `/me/mailFolders/Inbox/messages/delta`.
- **Treating `recurrence` as RRULE strings on Graph.** Graph's `event.recurrence` is `null` OR an object `{ pattern, range }` — never an array of RRULE strings. Conversion at the boundary, always.
- **Storing MSAL refresh tokens as bare strings.** MSAL's cache contains more than the refresh token (account record, tenant info, scope sets). Always serialize the cache, not a field.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth dance with AAD / MSA | Custom `node-fetch` to login.microsoftonline.com | `@azure/msal-node` | AAD/MSA/B2C divergence; token refresh edge cases; cache integrity |
| Graph request signing / auth header | Manual `Authorization: Bearer` injection | `graph-client` middleware | Auto-retry on 401-after-refresh; built-in batch endpoint composer |
| Retry on 429 | Custom backoff loop | graph-client's `RetryHandler` | Respects `Retry-After` (seconds OR HTTP-date format); exponential cap |
| Recurrence parsing (RRULE) | Hand-rolled BYDAY/BYMONTHDAY math | `rrule.js` (already in deps) | Already battle-tested in Phase 4 |
| Delta cursor management | Track `historyId`-style counters | Graph's `@odata.deltaLink` opaquely | Cursor is opaque; treat as black box; never parse |

## Capability Flags Table (Google ↔ Outlook divergences)

This table is the concrete output the planner uses to design the `Provider` interface.

| Capability | Google | Outlook | Flag |
|-----------|--------|---------|------|
| **Mail: delta cursor type** | `historyId` (numeric, exposed) | opaque `deltaLink` URL | `mail.cursorType: 'numeric' \| 'opaque-url'` |
| **Mail: backfill bootstrap** | List + record historyId | Initial delta call (returns deltaLink) | encapsulated in `mail.listMessagesDelta` |
| **Mail: thread key** | `threadId` | `conversationId` | `mail.threadIdField` — but normalized canonically as `threadId` on our `message` row |
| **Mail: label model** | flat label ids (system + user) | folders (tree) + categories (flat) | `mail.labelModel: 'labels' \| 'folders+categories'` |
| **Mail: HTML stripping** | Manual decode of payload parts | `Prefer: outlook.body-content-type="text"` header | `mail.preferTextHeader: true` (outlook only) |
| **Mail: send response** | Returns `Message` with id | 202 Accepted, no id (sendMail) OR id (createDraft + send) | `mail.sendReturnsId: false` for outlook |
| **Mail: draft model** | `drafts.create` returns Message id | `POST /me/messages` + later `send` action | `mail.draftFlow: 'oneCall' \| 'twoCall'` |
| **Calendar: event id stability** | Stable on series; instance id = `<parent>_<dtZ>` | Stable on series; instance id = different format (`<parentId>_<startTime>` URL-safe) | `calendar.instanceIdFormat: 'google' \| 'graph'` |
| **Calendar: recurrence format** | RRULE strings array | `{ pattern, range }` object | `calendar.recurrenceFormat: 'rrule' \| 'graph-pattern'` |
| **Calendar: etag header** | `etag` field on event + `If-Match` header | `@odata.etag` field on event + `If-Match` header | shape differs but pattern identical |
| **Calendar: cancellation tombstone** | `status: 'cancelled'` in delta | `@removed: { reason: 'changed' \| 'deleted' }` in delta | `calendar.tombstoneShape: 'status' \| 'odata-removed'` |
| **Calendar: sendUpdates** | `sendUpdates: 'none'/'externalOnly'/'all'` query param | No equivalent — Graph always sends invites; self-only enforced by attendee count | `calendar.supportsSendUpdates: true \| false` |
| **Calendar: RSVP propagation** | Yes via sendUpdates | Implicit on writes with attendees | self-only constraint (D-04-08) covers v1 |
| **Calendar: freeBusy** | `freebusy.query` (batched) | `POST /me/calendar/getSchedule` (batched) | `calendar.freeBusyMethod` — abstraction covers both |
| **Calendar: instance fetch** | `events.instances(eventId, timeMin, timeMax)` | `GET /me/events/{id}/instances?startDateTime=…&endDateTime=…` | `calendar.instancesByRange` — covered by abstraction |
| **Calendar: timezone of recurrence** | `RRULE` is timezone-naive; event has `timeZone` | `recurrenceTimeZone` on `range`; separate from event tz | extra conversion step; document loss case |
| **Auth: OAuth flow** | google-auth-library loopback | MSAL-node PKCE loopback | encapsulated in `connectGoogle` / `connectMicrosoft` |
| **Auth: account stable id** | email address (Google convention) | `homeAccountId` (`<oid>.<tid>`) | `accountId` is provider-specific opaque; never parsed |
| **Auth: token storage** | bare refresh_token | full MSAL cache blob | encapsulated in safeStorage helpers |
| **Throttling: signal** | 403 with reason='rateLimitExceeded' or 429 | 429 with `Retry-After` (more frequent) | RetryHandler middleware (Graph) + p-queue (Google) |

### Proposed `Provider` interface (TypeScript sketch)

```typescript
// src/main/integrations/provider.ts

export type ProviderKey = 'google' | 'microsoft';

export interface CanonicalMessage {
  externalId: string;          // Gmail message.id / Graph message.id
  threadId: string;            // Gmail threadId / Graph conversationId
  fromAddr: string;
  subject: string;
  snippet: string;
  receivedAtUtc: string;
  labels: string[];            // canonicalized; folders+categories flattened
  isUnread: boolean;
  isImportant: boolean;
  bodyText?: string;           // optional plaintext (Outlook fetched via Prefer header)
}

export interface CanonicalEvent {
  externalId: string;
  iCalUId?: string;
  parentExternalId?: string;
  summary: string;
  location?: string;
  description?: string;
  startUtc: string;
  endUtc: string;
  startDate?: string;          // YYYY-MM-DD for all-day
  timeZone?: string;
  recurrence?: string[];       // RFC5545 RRULE / RDATE / EXDATE — canonical
  organizerEmail?: string;
  organizerSelf?: boolean;
  attendees: Array<{ email: string; self?: boolean; responseStatus?: string }>;
  etag?: string;
  sequence?: number;
  status?: 'confirmed' | 'tentative' | 'cancelled';
}

export interface DeltaResult<T> {
  items: T[];
  tombstones: string[];        // ids that were deleted (canonical 'removed')
  cursor: string;              // opaque next cursor (deltaLink OR historyId OR syncToken)
  hadFullResync: boolean;
}

export interface MailCapability {
  /** Incremental sync. Cursor format is opaque (provider-specific). */
  listMessagesDelta(opts: { cursor: string | null }): Promise<DeltaResult<CanonicalMessage>>;
  getMessage(externalId: string): Promise<CanonicalMessage>;
  /** Send a message (NOT a draft). Subject to chokepoint approval gate. */
  sendMessage(args: {
    to: string[]; cc?: string[]; bcc?: string[];
    subject: string; bodyText: string;
    inReplyToExternalId?: string;
    fromAccountEmail: string;
  }): Promise<{ providerMessageId?: string }>;
}

export interface CalendarCapability {
  listEventsDelta(opts: { cursor: string | null }): Promise<DeltaResult<CanonicalEvent>>;
  listEventsWindow(opts: { timeMinUtc: string; timeMaxUtc: string }): Promise<CanonicalEvent[]>;
  getEvent(externalId: string): Promise<CanonicalEvent>;
  patchEvent(args: {
    externalId: string;
    parentExternalId?: string;
    ifMatch?: string;
    body: Partial<CanonicalEvent>;
  }): Promise<{ id: string; etag?: string }>;
  insertEvent(args: { body: Partial<CanonicalEvent> }): Promise<{ id: string; etag?: string }>;
  eventInstances(args: {
    parentExternalId: string;
    timeMinUtc: string;
    timeMaxUtc: string;
  }): Promise<CanonicalEvent[]>;
  freeBusy(args: { timeMinUtc: string; timeMaxUtc: string }): Promise<Array<{ start: string; end: string }>>;
}

export interface ProviderCapabilities {
  // Per-section flags — read by feature code that has provider-specific branches
  recurrenceFormat: 'rrule' | 'graph-pattern';      // wire format BEFORE canonicalization
  supportsSendUpdates: boolean;                      // google true / outlook false
  mailLabelModel: 'labels' | 'folders+categories';
  mailSendReturnsId: boolean;                        // false for outlook /sendMail
  // Add as needed; keep narrow.
}

export interface Provider {
  providerKey: ProviderKey;
  accountId: string;            // homeAccountId for ms, email for google (opaque to callers)
  accountEmail: string;         // for display only
  capabilities: ProviderCapabilities;
  mail?: MailCapability;
  calendar?: CalendarCapability;
}
```

### Pattern 7: Recurrence conversion (RFC5545 ↔ Graph pattern)

The full mapping table (read direction Graph → RRULE):

| Graph field | RRULE field | Notes |
|------------|------------|-------|
| `pattern.type = 'daily'` | `FREQ=DAILY` | + `INTERVAL=pattern.interval` |
| `pattern.type = 'weekly'` | `FREQ=WEEKLY;BYDAY=MO,TU,…` | `pattern.daysOfWeek` → BYDAY; `firstDayOfWeek` → `WKST` |
| `pattern.type = 'absoluteMonthly'` | `FREQ=MONTHLY;BYMONTHDAY=N` | `dayOfMonth` → BYMONTHDAY |
| `pattern.type = 'relativeMonthly'` | `FREQ=MONTHLY;BYDAY=N;BYSETPOS=k` | `index: first/second/third/fourth/last` → BYSETPOS=1/2/3/4/-1 |
| `pattern.type = 'absoluteYearly'` | `FREQ=YEARLY;BYMONTH=M;BYMONTHDAY=D` | |
| `pattern.type = 'relativeYearly'` | `FREQ=YEARLY;BYMONTH=M;BYDAY=…;BYSETPOS=k` | |
| `range.type = 'endDate'` | `UNTIL=YYYYMMDDTHHMMSSZ` | Convert local end date in `recurrenceTimeZone` → UTC for UNTIL |
| `range.type = 'numbered'` | `COUNT=N` | `numberOfOccurrences` → COUNT |
| `range.type = 'noEnd'` | (no UNTIL/COUNT) | infinite series |

**Lossy cases (refuse on write per CONTEXT):**
- RRULE with `BYHOUR`, `BYMINUTE`, `BYSECOND`, `BYWEEKNO`, `BYYEARDAY` — Graph has no equivalent; refuse
- RRULE with multiple `BYSETPOS` values — Graph allows single `index`; refuse
- RRULE `BYDAY` with prefixed weekday (e.g. `2MO` outside of monthly/yearly context) — partial support; refuse where ambiguous
- Compound RRULE + RDATE additions — Graph has no RDATE concept; canonical Aria event becomes the source-of-truth, RDATE-driven instances cannot round-trip to Graph

The refusal UI text already locked in CONTEXT: *"This recurrence pattern isn't supported in Aria — please edit it in {provider} directly."*

### Pattern 8: Per-provider failure isolation

```typescript
// src/main/integrations/registry.ts
class ProviderRegistry {
  private queues = new Map<string, PQueue>(); // key = `${providerKey}:${accountId}`
  private state = new Map<string, 'ok' | 'degraded' | 'needs-auth'>();

  async enqueue<T>(p: Provider, fn: () => Promise<T>): Promise<T> {
    const key = `${p.providerKey}:${p.accountId}`;
    const q = this.queues.get(key) ?? new PQueue({ concurrency: 1, intervalCap: 2, interval: 1000 });
    this.queues.set(key, q);
    return q.add(async () => {
      try {
        const r = await fn();
        this.state.set(key, 'ok');
        return r;
      } catch (err) {
        if (err instanceof TokenInvalidError) {
          this.state.set(key, 'needs-auth');
          // mark provider_account.status = 'needs-auth' in DB
        } else if (isTransient(err)) {
          this.state.set(key, 'degraded');
        }
        throw err;
      }
    });
  }
}
```

Other providers' queues never see this failure — exactly the CONTEXT-required hard-pause+soft-retry isolation.

## Multi-Account DB Schema (additions)

```sql
-- migrations/011_provider_accounts.sql

CREATE TABLE provider_account (
  account_id      TEXT PRIMARY KEY,          -- google: email; ms: homeAccountId
  provider_key    TEXT NOT NULL CHECK(provider_key IN ('google','microsoft')),
  display_email   TEXT NOT NULL,
  display_label   TEXT,                       -- user-editable, defaults to email handle
  display_color   TEXT,                       -- hex; auto-assigned
  capabilities    TEXT NOT NULL,              -- JSON: { mail: true, calendar: true }
  status          TEXT NOT NULL DEFAULT 'ok' CHECK(status IN ('ok','degraded','needs-auth','disconnected')),
  connected_at    TEXT NOT NULL,
  last_error      TEXT,
  last_error_at   TEXT
);

CREATE INDEX idx_provider_account_provider ON provider_account(provider_key);

CREATE TABLE provider_sync_state (
  account_id      TEXT NOT NULL,
  resource        TEXT NOT NULL CHECK(resource IN ('mail','calendar')),
  cursor          TEXT,                       -- opaque (deltaLink / historyId / syncToken)
  last_synced_at  TEXT,
  last_error      TEXT,
  last_error_at   TEXT,
  PRIMARY KEY (account_id, resource),
  FOREIGN KEY (account_id) REFERENCES provider_account(account_id) ON DELETE CASCADE
);

-- migrations/012_message_provider_key.sql

ALTER TABLE message ADD COLUMN provider_key TEXT;
ALTER TABLE message ADD COLUMN account_id TEXT;
CREATE INDEX idx_message_provider ON message(provider_key, account_id);

ALTER TABLE calendar_event ADD COLUMN provider_key TEXT;
ALTER TABLE calendar_event ADD COLUMN account_id TEXT;
CREATE INDEX idx_event_provider ON calendar_event(provider_key, account_id);

-- Backfill existing rows in the migration body:
-- UPDATE message SET provider_key='google', account_id=(SELECT email FROM gmail_account LIMIT 1) WHERE provider_key IS NULL;
-- UPDATE calendar_event SET provider_key='google', account_id=(SELECT email FROM calendar_account LIMIT 1) WHERE provider_key IS NULL;
```

`gmail_account` and `calendar_account` tables stay for Phase 2 backward compatibility through Plan 5-01 and 5-02; Plan 5-03 unification replaces them with views over `provider_account`. This is the temporary-duplication path CONTEXT explicitly authorizes.

## Per-Provider Keyring Namespacing (migration path)

**Current state** (`safeStorage.ts:googleTokens` subtree):
```json
{
  "googleTokens": {
    "gmail":    { "refreshTokenEnc": "<base64>", "email": "..." },
    "calendar": { "refreshTokenEnc": "<base64>", "email": "..." }
  }
}
```

**Target state** (post Plan 5-01):
```json
{
  "googleTokens": {                          // RETAINED for back-compat reads
    "gmail":    { "refreshTokenEnc": "...", "email": "..." },
    "calendar": { "refreshTokenEnc": "...", "email": "..." }
  },
  "providerTokens": {
    "google:gmail.calendar:user@gmail.com": { "refreshTokenEnc": "...", "email": "..." },
    "microsoft:user@contoso.com": { "msalCacheEnc": "<base64 of MSAL cache JSON>" }
  }
}
```

**Migration logic** (one-shot at app start, in `safeStorage.init`):

1. On read of `providerTokens.google:*` — if missing AND `googleTokens.gmail` present, synthesize entry from `googleTokens`.
2. On write of Google tokens via the new helper — write BOTH new format AND old `googleTokens` subtree (until Plan 5-04 deletes the legacy reader).
3. After all Phase 2 / Phase 3 code paths are conformed to the new helper, drop `googleTokens` subtree in a separate Plan 5-04 commit.

**Functions to add:**
```typescript
export function setProviderTokens(key: string, blob: string): void;
export function getProviderTokens(key: string): string | null;
export function clearProviderTokens(key: string): void;
export function listProviderTokenKeys(): string[];  // for "show all connected accounts"
```

`key` is `${providerKey}:${accountId}`. No parsing — keys are opaque to all callers except `ProviderRegistry`.

## Polling Cadence + powerMonitor Integration

CONTEXT locks the cadences: **Mail 5 min, Calendar 15 min**. Same for Outlook.

**Scheduler shape** (`src/main/integrations/sync-orchestrator.ts`):

```typescript
// One cron per (providerKey, resource) per account
// node-cron schedules: '*/5 * * * *' (mail), '*/15 * * * *' (calendar)
//
// On powerMonitor.on('suspend') → cancel all pending ticks; do NOT enqueue.
// On powerMonitor.on('resume')  → emit a one-shot "catch-up" tick per (account, resource)
//                                  via the ProviderRegistry queue. The delta cursor
//                                  naturally handles the gap.
```

**Interleaving with existing Google pollers:** the existing `ipc/gmail.ts` + `ipc/calendar.ts` cron handlers are replaced by `SyncOrchestrator.start()` which iterates all `provider_account` rows. In plan 5-01, the orchestrator can dispatch to BOTH the new shape (Outlook) AND the legacy shape (call into existing `GmailSync.tick()`) to avoid mid-phase regression. Plan 5-03 conforms Google onto the same Provider shape.

## Webhook vs Polling (why polling for v1)

Graph supports `POST /subscriptions` for change notifications. Requirements that make webhooks non-trivial:

1. **Public HTTPS endpoint required.** Graph will reject `localhost` / loopback URLs. Desktop apps need a tunnel (ngrok / Cloudflare Tunnel) or a relay service. CONTEXT defers tunnels.
2. **Subscription expires every ~3 days max** for mail (~30 days for calendar). Requires a renewal cron — adds infra without removing the polling code.
3. **Validation handshake at subscription create.** Graph posts a `validationToken` query param and expects a 200 OK with the token in the body within 10 seconds. Must be online + reachable.

**v1 decision (CONTEXT-locked):** stay on 15-minute polling. Document the subscription path in `## Open Questions` for a post-v1 follow-up. [CITED: learn.microsoft.com/en-us/graph/webhooks]

## Outlook Self-Only Gate (mapping from Phase 4)

Phase 4's `assertSelfOnly` predicate is two-part:
1. `organizer.email === userEmail`
2. `attendees.every(a => a.email === userEmail || a.self === true)`

**Graph mapping:**
- Graph events expose `isOrganizer: boolean` directly. PREFER that over comparing emails (avoids Phase 4 L-04-01 column-drift class of bug).
- `organizer.emailAddress.address` — same shape as Google `organizer.email`.
- `attendees[].emailAddress.address` and `attendees[].status.response`.
- **No `self` flag.** Graph doesn't tag attendees as "this is you". Compare against connected account's UPN (`account.username`).

**Risk:** UPN ≠ primary SMTP in some tenants (mail-enabled aliases). Use `/me` to pull the canonical email once at connect-time and store in `provider_account.display_email`; compare against that. [CITED: learn.microsoft.com/en-us/graph/api/user-get]

## Calendar Write Chokepoint — per-provider strategy injection

Generalized `applyCalendarChange`:

```typescript
// src/main/integrations/write-event.ts  (was google/write-event.ts)
export async function applyCalendarChange(db: Db, approvalId: string, deps?: ApplyDeps) {
  assertApproved(db, approvalId);        // ratchet — first executable line
  const row = getApproval(db, approvalId);

  // Dispatch to the right provider
  const provider = await deps?.getProvider?.(row.provider_key, row.account_id)
                  ?? await registry.get(row.provider_key, row.account_id);

  // Plan recurrence ops (provider-agnostic — operates on canonical RFC5545)
  const plan = computeRecurringWrite({
    scope: row.recurring_scope ?? 'this',
    event: parseBefore(row),
    change: row.after_json ? JSON.parse(row.after_json) : {},
  });

  // Pre-write audit (unchanged)
  logCalendarAction(db, { phase: 'pre_write', ... });

  try {
    for (const op of plan.ops) {
      if (op.kind === 'patch') {
        await provider.calendar.patchEvent({
          externalId: op.id, ifMatch: op.etag, body: op.body,
        });
      } else {
        await provider.calendar.insertEvent({ body: op.body });
      }
    }
  } catch (err) {
    // Provider-agnostic error: TokenInvalidError, EtagMismatchError both apply
    logCalendarAction(db, { phase: 'failed', error: ... });
    throw err;
  }

  logCalendarAction(db, { phase: 'post_write', ... });
  transitionTo(db, approvalId, 'sent', { sent_at: new Date().toISOString() });
}
```

**Critical adjustments:**

- `computeRecurringWrite` currently emits `requestBody` shapes that match Google's `events.patch` API (uses `start.dateTime`, `end.dateTime`, `recurrence: [...]`). For Outlook, the body shape is `start.dateTime` + `start.timeZone` (similar) BUT `recurrence: { pattern, range }` (different) and `subject` not `summary`. **Two options:**
  - (A) Have `computeRecurringWrite` emit a CANONICAL `Partial<CanonicalEvent>` body; each provider's `patchEvent` converts to its wire shape internally.
  - (B) Pass a provider-specific formatter into `computeRecurringWrite`.

  **Recommendation: Option A.** Keep the recurrence planner pure-canonical; do wire-format translation inside `provider.calendar.patchEvent`. This preserves Phase 4's L-04-06 lesson (pitfall guards scoped to actual concern) — the planner shouldn't carry Google-specific knowledge.

- L-04-05 fix (transition AFTER apply): preserved by the existing ordering. Same approach for Outlook.

## Mail Send Chokepoint — per-provider strategy

`sendApprovedEmail` (existing in `src/main/integrations/google/send.ts`) becomes provider-agnostic. Graph `sendMail` shape:

```typescript
// Inside provider.mail.sendMessage for microsoft:
await graph.api('/me/sendMail').post({
  message: {
    subject: args.subject,
    body: { contentType: 'Text', content: args.bodyText },
    toRecipients: args.to.map(email => ({ emailAddress: { address: email } })),
    ccRecipients: (args.cc ?? []).map(email => ({ emailAddress: { address: email } })),
    bccRecipients: (args.bcc ?? []).map(email => ({ emailAddress: { address: email } })),
    // In-reply-to: prefer createReply approach if continuing a thread,
    // since /sendMail with internetMessageHeaders requires extra perms (Mail.Send + adjust)
  },
  saveToSentItems: true,
});
return { providerMessageId: undefined }; // 202 returns no body
```

For thread replies on Outlook, the cleaner pattern is `POST /me/messages/{id}/createReply` then `POST /me/messages/{draftId}/send`. This is the "two-call" send flow captured in the capability flag `mail.draftFlow`. Plan 5-02 needs an internal branch on this flag; the chokepoint contract stays unchanged.

## Common Pitfalls

### Pitfall 1: Delta link 7-day expiration

**What goes wrong:** App is closed for 8+ days. On next sync, the `deltaLink` returns 410 Gone (`syncStateNotFound`). All cached events become potentially stale.

**Why it happens:** Graph evicts delta state after ~7 days of disuse (mail varies; calendar is somewhat longer but the 7-day floor is the safe assumption). [CITED: learn.microsoft.com/en-us/graph/delta-query-overview — "deltaLink can expire"]

**How to avoid:** Catch the 410 / `syncStateNotFound` error, drop the cursor, and execute a `fullResyncWindow` analogous to Phase 2's pattern. Same shape as `SyncTokenInvalidatedError` → `fullResyncWindow()` in `sync-calendar.ts:9`.

**Warning signs:** Suddenly empty delta responses, OR users reporting events that exist in Outlook but not in Aria after a long absence.

### Pitfall 2: `recurrenceTimeZone` ≠ event `timeZone`

**What goes wrong:** Graph allows `range.recurrenceTimeZone` to differ from the event's own `start.timeZone`. Naive RRULE conversion produces UNTIL timestamps in the wrong zone, causing series to end at the wrong instant.

**Why it happens:** RFC5545 `UNTIL` is timezone-naive (must be UTC for floating events). Graph stores the local-time recurrence end in `recurrenceTimeZone`. Conversion must explicitly resolve the local end date through the recurrence's tz, not the event's.

**How to avoid:** In `recurrence-graph.ts`, always use `pattern.recurrenceTimeZone` (NOT `event.start.timeZone`) when computing UNTIL. Add a unit test asserting this distinction.

**Warning signs:** Recurring series ending one day early or late after Outlook → Aria sync.

### Pitfall 3: Throttling burst on initial backfill

**What goes wrong:** First-time connect of a heavy mailbox: delta query paginates 100 messages/page × ~50 pages = sustained 50+ requests/minute. Graph throttles aggressively in early calls (especially in dev tenants), returning 429.

**Why it happens:** Graph throttling is per-app-per-tenant-per-resource; bursting on a single-user connect is exactly the pattern that trips it. [CITED: learn.microsoft.com/en-us/graph/throttling]

**How to avoid:**
1. Use graph-client's `RetryHandler` (default-enabled) — it respects `Retry-After`.
2. Set `intervalCap: 2, interval: 1000` on the per-account p-queue (max 2 req/sec sustained).
3. On initial backfill, prefer a narrow time window (`/me/mailFolders/Inbox/messages?$filter=receivedDateTime ge ...&$top=50&$select=...`) for the 7-day backfill, then start delta from the new state. This mirrors `sync-calendar.ts:fullResyncWindow()`.

**Warning signs:** Sustained 429s during connect; `RetryAfter` headers in the 30+ second range.

### Pitfall 4: `$select` and delta queries — once chosen, stuck

**What goes wrong:** Initial delta call uses `$select=subject,from`. After many subsequent delta calls with the same deltaLink, you discover you need `body` too. Adding it now returns a new full-resync.

**Why it happens:** Graph captures the `$select` projection into the delta state. You cannot evolve it without resetting the cursor. [CITED: learn.microsoft.com/en-us/graph/delta-query-overview]

**How to avoid:** Bake the FULL set of fields we ever need into the initial $select. For mail: `id,conversationId,subject,from,receivedDateTime,isRead,importance,bodyPreview,internetMessageId,categories,parentFolderId`. For events: `id,iCalUId,subject,body,start,end,location,organizer,attendees,recurrence,seriesMasterId,type,isOrganizer,isCancelled,showAs,recurrenceTimeZone,@odata.etag`.

**Warning signs:** Mid-development discovery of "I need this field but didn't request it" → leads to a forced full-resync of all users on update.

### Pitfall 5: Instance event id format (Outlook ≠ Google)

**What goes wrong:** Phase 4's chokepoint guard `eventId.includes('_')` was designed for Google's `<parent>_<dtZ>` format. Graph instance ids use a different (long base64-ish) format that may or may not contain underscores.

**Why it happens:** Pitfall 3 fix in Phase 4 (L-04-06) made the guard recurrence-aware. For Graph, the guard must use `parentExternalId` presence as the "is this an instance" signal — not a substring check on the id.

**How to avoid:** Replace the `_` check with `Boolean(before.parentExternalId)` in the generalized `applyCalendarChange`. Mark this in the Plan 5 task list as a small refactor of Phase 4 code.

**Warning signs:** Outlook recurring `scope='this'` patches silently hitting the series (the L-04-06 class of bug, but for Outlook).

### Pitfall 6: MSAL silent refresh after long idle

**What goes wrong:** `acquireTokenSilent` succeeds against a stale cached access token, but Graph 401s on the next call because the embedded token actually expired between MSAL's clock check and the request. App treats account as broken when it just needs one more refresh attempt.

**Why it happens:** Token clocks aren't atomic with network requests. MSAL's expiry check is approximate.

**How to avoid:** On a 401 from any Graph call, invalidate the cached access token (`pca.getTokenCache().removeAccount(account)` then `acquireTokenSilent({ forceRefresh: true, ... })`) ONCE before treating as auth failure. graph-client's `AuthenticationHandler` does some of this but does not call `forceRefresh: true` by default. Add a retry-on-401 wrapper in our `authProvider.getAccessToken`. [ASSUMED — pattern from MSAL docs; verify behavior in plan 5-01 spike]

**Warning signs:** Intermittent "Outlook needs re-auth" prompts that clear after the user clicks "Reconnect" without actually re-consenting.

### Pitfall 7: `Prefer: outlook.body-content-type="text"` not propagated to delta endpoints

**What goes wrong:** Setting the Prefer header on a singleton GET works; on `/messages/delta` the header may be silently ignored for some Graph SKUs. Result: bodyPreview is text but a later detail fetch returns HTML you didn't expect.

**Why it happens:** Prefer header semantics are documented for read endpoints; delta is implemented as a different code path. [ASSUMED — observed in community reports, not exhaustively verified]

**How to avoid:** Don't rely on body from the delta response. Use `$select=bodyPreview` (capped at 255 chars; always plaintext) in delta; fetch full body via a separate GET with the Prefer header when triage actually needs it.

**Warning signs:** Briefing snippets containing raw HTML for some messages.

### Pitfall 8: Mail-enabled aliases trip self-only

**What goes wrong:** User's UPN is `john.doe@contoso.onmicrosoft.com`; their primary SMTP is `john@contoso.com`. Calendar events sent to `john@contoso.com` have an organizer email that doesn't match `account.username`.

**Why it happens:** AAD UPN and SMTP can differ. `account.username` from MSAL returns UPN.

**How to avoid:** At connect time, also fetch `/me` and store `mail`, `userPrincipalName`, AND `proxyAddresses` (from `/me?$select=proxyAddresses`). Self-only gate matches against the full set. [CITED: learn.microsoft.com/en-us/graph/api/user-get]

**Warning signs:** UAT user reports "Aria refuses to move my own meeting".

## Code Examples

### Example: Full Outlook calendar sync tick (compressed)

```typescript
// src/main/integrations/microsoft/sync-calendar.ts
export async function tickCalendar(deps: { db: Db; provider: Provider; logger: Logger }) {
  const state = readSyncState(deps.db, deps.provider.accountId, 'calendar');
  let cursor = state.cursor;
  let hadFullResync = false;

  try {
    const result = await deps.provider.calendar!.listEventsDelta({ cursor });
    // result.items: CanonicalEvent[]
    // result.tombstones: string[]  (externalIds that were deleted)
    // result.cursor: new opaque deltaLink

    deps.db.transaction(() => {
      for (const ev of result.items) upsertEvent(deps.db, deps.provider, ev);
      for (const id of result.tombstones) deleteEvent(deps.db, deps.provider, id);
      advanceCursor(deps.db, deps.provider.accountId, 'calendar', result.cursor);
    })();
  } catch (err) {
    if (err instanceof TokenInvalidError) {
      markAccountNeedsAuth(deps.db, deps.provider.accountId, err.reason);
      throw err;
    }
    if (err instanceof DeltaExpiredError) {
      hadFullResync = true;
      await fullResyncWindow(deps);  // mirrors sync-calendar.ts:fullResyncWindow
      return;
    }
    throw err;
  }
}
```

### Example: RRULE → Graph pattern conversion

```typescript
// src/main/integrations/microsoft/recurrence-graph.ts
import { rrulestr, Frequency, Weekday } from 'rrule';

export function rruleToGraphRecurrence(
  recurrence: string[],
  eventStartLocal: { date: string; timeZone: string },
): GraphRecurrence | { unsupported: true; reason: string } {
  const rrule = rrulestr(recurrence.join('\n'), { forceset: false });
  if ('rrules' in rrule) {
    // RRuleSet — has RDATE / EXDATE. Graph has no equivalent. Refuse.
    return { unsupported: true, reason: 'RDATE/EXDATE not supported by Microsoft Calendar' };
  }
  const opts = rrule.origOptions;

  // BYHOUR/BYMINUTE/BYSECOND/BYWEEKNO/BYYEARDAY — refuse
  if (opts.byhour || opts.byminute || opts.bysecond || opts.byweekno || opts.byyearday) {
    return { unsupported: true, reason: 'Hour/minute/week-number patterns not supported' };
  }

  // ... build { pattern, range } from opts.freq, opts.byweekday, opts.bymonthday, etc.
  // (Full table above)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| MSAL-node 1.x callback-based cache | MSAL-node 3.x ICachePlugin (async) | MSAL v2 (~2022) | Confirm our cache wrapper uses async; we do |
| `microsoft-graph` (raw fetch) | `@microsoft/microsoft-graph-client` 3.x with middleware | graph-client 3 (~2023) | Use built-in RetryHandler instead of hand-rolled |
| Subscription validation via HTTP | Same — but lifecycle notifications added | 2023 | Not relevant to v1 (polling) |
| `prefer-async` header in graph delta | Inline (synchronous default) | n/a | Don't use prefer-async; default is fine |

**Deprecated/outdated:**
- Outlook REST API (`outlook.office.com/api/v2.0`): deprecated in favor of Graph. Do not use. [CITED: learn.microsoft.com/en-us/outlook/rest/compare-graph]
- `keytar` for token storage (CLAUDE.md already locks Electron safeStorage): rejected upstream.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@microsoft/microsoft-graph-client` v3 still needs `isomorphic-fetch` polyfill in Node 20 | Standard Stack | Low — install fails fast; remove if global fetch suffices |
| A2 | Graph delta cursor expiration is ~7 days for mail | Pitfall 1 | Low — handled by 410 fallback to full-resync regardless of actual TTL |
| A3 | `Prefer: outlook.body-content-type="text"` header may be ignored on delta | Pitfall 7 | Medium — verify in spike; current mitigation (avoid body in delta) is safe regardless |
| A4 | MSAL `acquireTokenSilent({ forceRefresh: true })` is the right 401-recovery path | Pitfall 6 | Medium — alternative: full re-auth on 401; verify in plan 5-01 |
| A5 | M365 Developer Program is free and provides a sandbox tenant suitable for test posture | Cross-cutting | Medium — if blocked, fallback is paid Business Basic seat ($6/mo); document in plan |
| A6 | Outlook instance event ids may or may not contain `_` (Graph format differs from Google) | Pitfall 5 | Low — fix is `parentExternalId` predicate, which is provider-agnostic anyway |
| A7 | UPN ≠ primary SMTP for some tenants requires `proxyAddresses` lookup | Pitfall 8 | Low — extra fetch is cheap; verified via Graph docs |
| A8 | Graph `RetryHandler` middleware respects `Retry-After` in seconds AND HTTP-date format | Standard Stack | Low — if not, wrap with custom middleware; observable behavior |
| A9 | Compound RRULE+RDATE patterns are uncommon enough that refuse-on-write covers v1 | Recurrence | Medium — if Outlook users commonly have these, refusal noise is high; CONTEXT already accepts this tradeoff |

## Open Questions

1. **M365 Developer Program cost + sandbox limits**
   - What we know: It exists; tied to a non-prod tenant; mail send may be sandboxed
   - What's unclear: 2026 cost (free vs paid since recent changes), seat count, whether sendMail is rate-limited differently from prod
   - Recommendation: Plan 5-01 first task = sign up + smoke-test; if blocked, plan owner provisions a $6/mo Business Basic seat

2. **Adapter unification scope — how invasive in plan 5-03?**
   - What we know: Phase 4's static-grep ratchet enforces one chokepoint; the generalized chokepoint can keep that property
   - What's unclear: How many Phase 2 / 3 / 4 call sites import Google-specific types vs. accept canonical
   - Recommendation: Plan 5-03 starts with a grep pass; if site count > 20, descope unification of mail-send to plan 5-04

3. **Single-flight refresh implementation**
   - What we know: Need to avoid duplicate refresh storms when N tabs/queues hit auth at the same time
   - What's unclear: Promise dedup map vs file lock — MSAL's cache plugin's `cacheHasChanged` flag may already handle this in-process
   - Recommendation: Default to in-process promise dedup keyed by `accountId`; document the assumption that single-Electron-instance (Phase 1 invariant) makes file locks unnecessary

4. **safeStorage on Linux without libsecret**
   - What we know: Phase 1 already warns user when backend is `basic_text`
   - What's unclear: Whether the existing warning surfaces in onboarding when Outlook adds tokens (separate code path)
   - Recommendation: Plan 5-01 verifies the warning fires on second-provider connect; if not, add it

5. **Recurring conversion — relative-monthly `weekIndex='last'` edge cases**
   - What we know: BYSETPOS=-1 is the RRULE encoding
   - What's unclear: Round-trip fidelity for "last weekday" patterns when month length varies
   - Recommendation: Add a property-based test in `recurrence-graph.test.ts` that round-trips every supported pattern over 12 months

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 20 LTS | All | ✓ (per CLAUDE.md) | 20.x | — |
| Electron + safeStorage | Token storage | ✓ (Phase 1) | 41.6.1 | — |
| better-sqlite3-multiple-ciphers | Storage | ✓ (Phase 1) | 11.x | — |
| `rrule` | Recurrence | ✓ (Phase 4) | 2.8.1 | — |
| Microsoft 365 Developer tenant | Integration testing | ✗ (must provision) | — | Paid $6/mo Business Basic seat |
| Azure AD app registration | OAuth client id | ✗ (must register) | — | Free; one-time at https://portal.azure.com |

**Missing dependencies with no fallback:** None blocking — both provisioning steps are one-time human actions.

**Missing dependencies with fallback:** M365 tenant (free dev program OR paid seat).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 2 (existing) + Playwright 1.48 (existing) + MSW 2 (existing) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run --reporter=dot` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| EMAIL-02 | Connect Outlook; ingest mail incrementally | integration | `npx vitest run src/main/integrations/microsoft/sync-mail.test.ts` | ❌ Wave 0 |
| EMAIL-02 | OAuth loopback flow with MSAL stubs | unit | `npx vitest run src/main/integrations/microsoft/auth.test.ts` | ❌ Wave 0 |
| CAL-02 | Connect Outlook Calendar; events synced | integration | `npx vitest run src/main/integrations/microsoft/sync-calendar.test.ts` | ❌ Wave 0 |
| CAL-02 | Patch event chokepoint dispatches to Outlook provider | integration | `npx vitest run src/main/integrations/write-event.test.ts` | ❌ Wave 0 |
| CAL-03 | Unified calendar view shows both accounts | e2e (Playwright) | `npx playwright test tests/e2e/multi-account-calendar.spec.ts` | ❌ Wave 0 |
| CAL-08 | RRULE → Graph round-trip for all 5 supported pattern types | unit | `npx vitest run src/main/integrations/microsoft/recurrence-graph.test.ts` | ❌ Wave 0 |
| CAL-08 | Refusal on unsupported pattern | unit | (same file) | ❌ Wave 0 |
| CROSS | Token-invalid on Outlook does not stop Gmail sync | integration | `npx vitest run src/main/integrations/registry-isolation.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=dot --changed`
- **Per wave merge:** `npx vitest run` + targeted Playwright spec
- **Phase gate:** `npm test` (full suite) green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/main/integrations/microsoft/__fixtures__/graph-responses.json` — recorded sample delta responses (mail + calendar)
- [ ] `tests/setup/msw-graph.ts` — MSW handlers for `graph.microsoft.com/v1.0/*`
- [ ] `tests/static/single-calendar-write-site.test.ts` — UPDATE existing ratchet to allow `provider.calendar.*` calls inside `write-event.ts` while still rejecting other call sites
- [ ] `tests/static/single-mail-send-site.test.ts` — analogous ratchet for `provider.mail.sendMessage`
- [ ] M365 Developer Program tenant — for live smoke tests outside CI

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | MSAL-node PKCE; CSRF state on loopback redirect (mirrors Google) |
| V3 Session Management | yes | MSAL token cache encrypted via safeStorage; access tokens never persisted outside cache |
| V4 Access Control | yes | Approval gate (`assertApproved`); self-only attendee check |
| V5 Input Validation | yes | Zod schemas on IPC inputs; Graph response types narrowed before write |
| V6 Cryptography | yes | safeStorage (DPAPI/Keychain/libsecret); SQLCipher whole-DB |

### Known Threat Patterns for Electron + Graph + MSAL

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token theft from disk | Information disclosure | safeStorage cache encryption + SQLCipher for DB; reject `basic_text` warning |
| OAuth state replay / CSRF | Spoofing | 32-byte random `state` validated on loopback callback (Phase 2 pattern) |
| Code injected via auth-window preload | Elevation of privilege | Sandboxed BrowserWindow: `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, NO preload (Phase 2 T-02-01-03) |
| Phishing of consent URL | Spoofing | URL is built locally with our client id; only login.microsoftonline.com domain shown to user |
| Approval bypass via direct API call | Tampering | `applyCalendarChange` / `sendApprovedEmail` chokepoints + `assertApproved` + static-grep ratchet (Phase 4 D-04-01) |
| Cross-account data leak in unified UI | Information disclosure | `provider_account.account_id` join key on every read; account chip always rendered (CONTEXT) |
| Refresh token exfiltration via logs | Information disclosure | Never log MSAL cache; log only `accountId` + redacted email handle (mirrors Phase 2 logging discipline) |

## Sources

### Primary (HIGH confidence)
- `CLAUDE.md` — locks `@azure/msal-node` 3.x + `@microsoft/microsoft-graph-client` 3.x as the stack
- `src/main/integrations/google/auth.ts` — existing OAuth loopback pattern to mirror
- `src/main/integrations/google/calendar.ts` — existing CalendarClient shape to generalize
- `src/main/integrations/google/write-event.ts` — existing chokepoint + ratchet pattern
- `.planning/phases/04-calendar-smart-scheduling-google/04-LEARNINGS.md` — L-04-01, L-04-04, L-04-05, L-04-06 directly applicable
- learn.microsoft.com/en-us/graph/delta-query-overview — delta semantics + cursor expiration
- learn.microsoft.com/en-us/graph/throttling — 429 + Retry-After
- learn.microsoft.com/en-us/entra/identity-platform/msal-node-token-cache — cache plugin pattern
- learn.microsoft.com/en-us/graph/api/user-sendmail — sendMail shape

### Secondary (MEDIUM confidence)
- learn.microsoft.com/en-us/entra/msal/node/ — MSAL-node v3 surface
- github.com/microsoftgraph/msgraph-sdk-javascript — graph-client middleware behavior
- learn.microsoft.com/en-us/graph/api/event-update — recurrence pattern object shape
- learn.microsoft.com/en-us/graph/webhooks — subscription requirements (used to justify deferral)

### Tertiary (LOW confidence — flagged in Assumptions Log)
- Community reports of Prefer header on delta endpoints (Pitfall 7)
- M365 Developer Program cost as of 2026 (Open Q 1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — locked by CLAUDE.md
- Architecture: HIGH — direct generalization of Phase 2/4 patterns we already shipped
- Recurrence mapping: MEDIUM — table is well-documented but property-based tests will surface edge cases at implementation time
- Pitfalls: HIGH on 1-5, MEDIUM on 6-8 (verify in spike)
- M365 dev tenant logistics: MEDIUM — verify at provisioning time

**Research date:** 2026-05-18
**Valid until:** 2026-06-17 (30 days for stable stack); 2026-05-25 for Graph SDK minor versions

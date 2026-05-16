# Phase 2: Gmail Ingest + Daily Briefing MVP — Research

**Researched:** 2026-05-16
**Domain:** Google Workspace OAuth + incremental sync; AI SDK 6 structured outputs; cron + power-event scheduling; SQLCipher schema extension
**Confidence:** HIGH on Google API mechanics and AI SDK shape; MEDIUM on the CASA unverified-app UX (depends on review state); MEDIUM-HIGH on RSS lib choice (rss-parser ecosystem is small, well-trodden, but old).

## Executive Summary

Phase 2 is the first integration phase. The risk profile is dominated by **Google API protocol correctness** (historyId invalidation, syncToken 410, refresh-token edge cases) and **cron correctness under sleep/wake**, not by any new framework choice. Every piece of Phase 1's infrastructure is reusable as-is — safeStorage holds OAuth refresh tokens the same way it holds frontier keys; migration 002 appends to `embedded.ts`; the briefing's one frontier LLM call uses `generateObject` through the existing router; node-cron + p-queue + powerMonitor already scaffolded in Phase 1.

**Primary recommendation:** Build a thin per-integration sync engine (`gmail/sync.ts`, `calendar/sync.ts`) that owns the change-token lifecycle and recovers from invalidation by full-resync. Treat the change-token as the only source-of-truth for "where are we"; never trust `received_at` timestamps for incrementality. Wrap every Google API call in p-queue with explicit `users.history.list` 404 / `events.list` 410 catch-and-resync branches.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Briefing layout:** sectioned doc (H2: Today's Calendar / Priority Email / News) with hard cap of top 3 per section. Item rows = title + 1-line rationale + back-link.
- **Tone:** terse executive ("Quarterly board call — you owe a slide.").
- **MVP priority email definition:** unread AND Gmail `IMPORTANT` label AND age ≤ 24h. No custom classifier in Phase 2.
- **News sources (3, in order):** Hacker News top stories API; user-pasted RSS aggregator; NG (Nigeria) country bundle JSON fixture (`src/main/news/bundles/ng.json`).
- **News picker UX:** new onboarding step after mnemonic confirm (country + 2–3 sectors); editable in Settings.
- **Ranking:** hybrid — sources provide top-N candidates; one frontier LLM call per morning ranks candidates against user context (persona + last-7-day calendar topics); returns top 3 + `{item_id, why}` pairs via `generateObject` + Zod.
- **Cadence:** Gmail every 5min via `users.history.list(historyId)`; Calendar every 15min via syncToken + force-refresh on briefing fire.
- **Backfill:** Gmail first-connect = last 7 days via `users.messages.list?q=newer_than:7d`, rate-limited via p-queue.
- **Stack (carried, no re-decision):** Electron 41.6.1 exact, AI SDK 6, ollama-ai-provider-v2, better-sqlite3-multiple-ciphers @ 12.9.0, safeStorage for OAuth tokens.
- **Briefing trigger:** node-cron, default 7am local TZ, user-configurable (BRIEF-01). Missed briefings on wake **defer to next scheduled time** (not back-fired).
- **Graceful degrade (BRIEF-06):** failed source renders inline warning ("Gmail unreachable — last sync 23m ago"); other sections unaffected.
- **Expired token UX (EMAIL-07):** banner inside affected section, not modal.
- **Status panel (XCUT-06):** extend existing Settings `StatusPanel.tsx` with Gmail + Calendar rows (sync state, queue depth, last error).
- **Timezones (XCUT-07):** store UTC in SQLCipher; render local via `Intl.DateTimeFormat`; cron resolves against local TZ.
- **News dismissal:** per-day, not permanent — row in `briefing_item_dismissed` keyed by (date, item_url_hash).

### Claude's Discretion

- IPC contract extension shape (add `briefing.*`, `gmail.*`, `calendar.*` namespaces).
- SQLCipher schema additions (migration 002 — see §7 below).
- File layout under `src/main/integrations/google/{auth,gmail,calendar}.ts`, `src/main/briefing/`, `src/main/news/`, `src/renderer/features/briefing/`, etc.
- Briefing-section LLM prompts (terse-executive, top-3, rationale-required).
- Error taxonomy → status-panel rows.
- Test strategy: vitest unit for parsers/rankers/schema; Playwright `_electron` e2e for "first launch → connect Gmail (mocked) → see briefing".

### Deferred Ideas (OUT OF SCOPE)

- More country bundles beyond NG (Phase 8 or v1.x).
- Cross-country sector subscriptions ("energy news from NG + UK + US").
- Adaptive polling (1min focused / 15min backgrounded).
- 30-day Gmail backfill for RAG (Phase 7).
- BRIEF-04 richer news topic configuration UI.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EMAIL-01 | OAuth-connect Gmail (read) + incremental ingest | §1 OAuth loopback, §2 history.list |
| EMAIL-07 | Expired token detection + re-auth prompt | §1 refresh-token lifecycle, §10 CASA UX |
| CAL-01 (read) | OAuth-connect Google Calendar + incremental ingest | §1 OAuth, §3 events.list syncToken |
| BRIEF-01 | Daily briefing at configurable local time | §6 node-cron + powerMonitor coalescing |
| BRIEF-03 | Briefing covers calendar / email / news | §4 generateObject schema |
| BRIEF-06 | Graceful degrade when source unavailable | Per-section error capture; see §8 |
| XCUT-01 | Sleep/wake — no cron storm | §6 powerMonitor pause + dedup on resume |
| XCUT-06 | Status panel | Extend `StatusPanel.tsx`; integration rows |
| XCUT-07 | Time zone correctness | §9 UTC store / local render / cron-tz |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary | Rationale |
|------------|-------------|-----------|-----------|
| OAuth loopback redirect handling | Main process | — | BrowserWindow + http.createServer listen 127.0.0.1; renderer cannot bind sockets |
| OAuth token storage | Main process (safeStorage) | — | DPAPI/Keychain access; identical pattern to frontier keys |
| Gmail / Calendar API calls | Main process | — | googleapis is Node-only; tokens must never reach renderer |
| Incremental sync state (historyId, syncToken) | SQLCipher (main) | — | Persistent across restarts; co-located with message rows |
| Message / event persistence | SQLCipher (main) | — | All user data encrypted at rest |
| Briefing generation | Main process (router) | — | Calls `generateObject` via Phase 1 router; result persisted to `briefing` table |
| Briefing schedule | Main process (node-cron + powerMonitor) | — | Single-instance trigger; cannot live in renderer |
| RSS / HN fetch | Main process | — | CORS-free; HTML decoding library is Node |
| Briefing UI | Renderer | — | Pure display layer; reads from IPC, never owns sync state |
| Country/sector onboarding step | Renderer | Main (persist to settings table) | UI selection + setting write |

## Standard Stack

### Core (additions for Phase 2)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `googleapis` | `^144.0.0` (current 171.x verified [VERIFIED: npm view 2026-05-16]) | Gmail + Calendar API client | Official Google-maintained Node SDK; all Phase-3+ Google work depends on it. CLAUDE.md pins `144+`; current registry version is 171.4.0 — pin `^144` and let semver float to 171 in install. |
| `google-auth-library` | `^9.0.0` (current 10.6.2 verified [VERIFIED]) | OAuth 2.0 client for loopback flow | Peer-dep of googleapis; owns `OAuth2Client` + refresh-token rotation. |
| `rss-parser` | `^3.13.0` (verified current [VERIFIED]) | RSS / Atom parsing for news bundle + user-pasted feeds | Most popular Node RSS lib; small surface; built on top of `xml2js`. See §5 for tradeoff vs. fast-xml-parser. |

[CITED: https://www.npmjs.com/package/googleapis]
[CITED: https://www.npmjs.com/package/google-auth-library]
[CITED: https://github.com/rbren/rss-parser]

**Installation:**
```bash
npm install googleapis@^144 google-auth-library@^9 rss-parser@^3.13
```

`googleapis` already provides everything for Gmail + Calendar; no separate `@google-cloud/local-auth` (that is a higher-level abstraction the loopback flow doesn't need).

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `rss-parser` | `fast-xml-parser` (5.8.0 [VERIFIED]) | fast-xml-parser is faster and more flexible but requires hand-writing RSS / Atom shape normalization. rss-parser bakes the RSS/Atom dialects (title/link/pubDate/contentSnippet) in. For 3 sources where the rationale is "show titles + URLs," the speed advantage is invisible and the dialect handling is the work. **Recommend rss-parser.** |
| `rss-parser` | `feedparser` | feedparser is stream-based, archived (last release 2020), heavier API. Reject. |
| `googleapis` REST | gaxios direct calls | Saves ~3MB but loses the typed Gmail/Calendar surface and resumable-token plumbing. Not worth it for Phase 2. |
| http.createServer for loopback | `@google-cloud/local-auth` | local-auth opens a server, browser, waits, hand-rolls token exchange. Same code we'd write. Prefer hand-rolled — gives full control over the unverified-app warning UX (§10). |

## Architecture Patterns

### System Architecture Diagram

```
                     ┌──────────────────────────────────────────────────────┐
                     │                  Main Process                        │
                     │                                                      │
   user clicks       │   OAuth loopback flow                                │
  "Connect Gmail" ──>│   ├─ BrowserWindow (auth URL)                        │
                     │   ├─ http.createServer 127.0.0.1:<random port>       │
                     │   ├─ receives ?code= → token exchange                │
                     │   └─ store refreshToken via safeStorage              │
                     │                                                      │
   every 5 min ─────>│   GmailSync.tick()                                   │
   (cron, paused     │   ├─ load historyId from gmail_account               │
    on suspend)      │   ├─ users.history.list(startHistoryId)              │
                     │   │     └─ 404 → full-resync via messages.list       │
                     │   ├─ for each new messageId: users.messages.get       │
                     │   │      format='metadata' (Phase 2)                 │
                     │   ├─ upsert gmail_message rows                       │
                     │   └─ update historyId atomic with insert (txn)       │
                     │                                                      │
   every 15 min ────>│   CalendarSync.tick()                                │
                     │   ├─ events.list(syncToken)                          │
                     │   │     └─ 410 GONE → full-resync (timeMin = now-1d) │
                     │   ├─ upsert calendar_event rows                      │
                     │   └─ persist nextSyncToken                           │
                     │                                                      │
   daily cron @ ────>│   BriefingGenerate.run(date)                         │
   user-set time     │   ├─ ForceRefresh CalendarSync                       │
   (local TZ)        │   ├─ Query: today's events / IMPORTANT+unread+≤24h  │
                     │   │         email / HN+RSS+NG news candidates       │
                     │   ├─ generateObject({...}, BriefingSchema)            │
                     │   │     via router (FRONTIER, source='generic')      │
                     │   ├─ persist briefing row                            │
                     │   └─ emit IPC 'briefing:updated' to renderer         │
                     │                                                      │
                     │   powerMonitor.on('suspend') → pause cron registry   │
                     │   powerMonitor.on('resume')  → resume + skip overdue │
                     │                                                      │
                     │              SQLCipher (aria.db)                     │
                     │              - gmail_account / gmail_message         │
                     │              - calendar_account / calendar_event     │
                     │              - briefing / briefing_item_dismissed    │
                     │              - news_source                           │
                     └──────────────────────────────────────────────────────┘
                                 │                  ▲
                                 ▼ IPC              │
                     ┌──────────────────────────────────────────────────────┐
                     │ Renderer: BriefingScreen + SectionCalendar/Email/News│
                     │ + IntegrationsSection + NewsSourcesSection           │
                     │ + CountrySectorPicker (onboarding new step)          │
                     └──────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/main/
├── integrations/google/
│   ├── auth.ts           # OAuth2Client factory + loopback flow + refresh persist
│   ├── gmail.ts          # GmailClient wrapper (history/messages/get + retry)
│   ├── calendar.ts       # CalendarClient wrapper (events.list + sync token)
│   ├── sync-gmail.ts     # GmailSync.tick() (cron-driven)
│   └── sync-calendar.ts  # CalendarSync.tick() (cron-driven + force-refresh)
├── briefing/
│   ├── generate.ts       # The one generateObject call per day
│   ├── schedule.ts       # cron.schedule + powerMonitor coalescing per BRIEF-01
│   └── persist.ts        # briefing + briefing_item_dismissed CRUD
├── news/
│   ├── hn.ts             # Hacker News top stories
│   ├── rss.ts            # rss-parser wrapper with timeout + retry
│   ├── country-bundle.ts # loads bundles/<country>.json + dispatches to rss.ts
│   └── bundles/
│       └── ng.json       # 3–5 Nigerian gov/finance feeds (build-time fixture)
└── ipc/
    ├── gmail.ts          # gmail:* IPC handlers
    ├── calendar.ts       # calendar:* IPC handlers
    └── briefing.ts       # briefing:* IPC handlers

src/renderer/features/
├── briefing/
│   ├── BriefingScreen.tsx
│   ├── SectionCalendar.tsx
│   ├── SectionEmail.tsx
│   └── SectionNews.tsx
├── onboarding/
│   └── CountrySectorPicker.tsx     # new step after MnemonicConfirm
└── settings/
    ├── IntegrationsSection.tsx     # Connect Gmail / Calendar; reauth banner
    └── NewsSourcesSection.tsx      # country/sector + paste RSS URL
```

### Pattern: OAuth Loopback Flow (Desktop)

```typescript
// src/main/integrations/google/auth.ts (shape)
import { OAuth2Client } from 'google-auth-library';
import { BrowserWindow } from 'electron';
import http from 'node:http';
import { URL } from 'node:url';

const SCOPES = {
  gmail: ['https://www.googleapis.com/auth/gmail.readonly'],
  calendar: ['https://www.googleapis.com/auth/calendar.readonly'],
};

export async function connectGoogle(kind: 'gmail' | 'calendar'): Promise<{ refreshToken: string; email: string }> {
  const client = new OAuth2Client({
    clientId: GOOGLE_OAUTH_CLIENT_ID,        // public for Desktop app type — no secret
    clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,// installed-app secret (not actually secret per RFC 8252)
    redirectUri: 'http://127.0.0.1:0/oauth/callback', // port assigned at runtime
  });
  // 1. Listen on ephemeral port
  const { port, codePromise } = await startLoopbackListener();
  client.redirectUri = `http://127.0.0.1:${port}/oauth/callback`;
  // 2. Build URL with PKCE (loopback IP per RFC 8252 + Google's "Desktop app" requirement)
  const codeVerifier = generatePkceVerifier();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',                       // forces refresh_token issuance
    scope: SCOPES[kind],
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: 'S256',
  });
  // 3. Open browser window (NOT system browser — keeps app in foreground; Electron BrowserWindow with no-node)
  const authWin = new BrowserWindow({ width: 500, height: 700, webPreferences: { nodeIntegration: false } });
  await authWin.loadURL(url);
  // 4. Wait for redirect on loopback
  const code = await codePromise;
  authWin.close();
  // 5. Exchange code → tokens
  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) throw new Error('NO_REFRESH_TOKEN');
  // 6. Resolve user email via tokeninfo OR a one-shot gmail.users.getProfile / calendar.calendarList.get
  // 7. Persist refresh_token via safeStorage; access_token stays in memory
  return { refreshToken: tokens.refresh_token, email: /* from getProfile */ };
}
```

**Notes:**
- `access_type: 'offline'` + `prompt: 'consent'` are both required to *reliably* get a `refresh_token`. Without `prompt: 'consent'`, repeated consent for the same user/scopes returns access_token only and breaks long-lived sync. [CITED: https://developers.google.com/identity/protocols/oauth2/web-server#offline]
- Use **PKCE** on the loopback flow even for Desktop app type — RFC 8252 §6 recommends it, and Google accepts (recently required) it. `code_challenge_method=S256`.
- Refresh tokens for Workspace accounts can be revoked if **unused for 6 months**, on **password change**, or after **N concurrent tokens for the same client** (Google rotates the oldest). [CITED: https://developers.google.com/identity/protocols/oauth2#expiration]
- `google-auth-library`'s `OAuth2Client` exposes a `'tokens'` event that fires when access tokens auto-refresh. Hook this to persist the new `refresh_token` if Google rotates it (rare but happens).

### Pattern: Gmail history.list with Invalidation Fallback

```typescript
// src/main/integrations/google/sync-gmail.ts (shape)
async function tickGmail(client, db, queue) {
  const acct = db.prepare('SELECT history_id FROM gmail_account WHERE id=1').get();
  try {
    const res = await queue.add(() => client.users.history.list({
      userId: 'me',
      startHistoryId: acct.history_id,
      historyTypes: ['messageAdded'],
      maxResults: 500,
    }));
    if (!res.data.history) return;       // nothing new
    for (const h of res.data.history) {
      for (const m of h.messagesAdded ?? []) {
        const full = await queue.add(() => client.users.messages.get({
          userId: 'me', id: m.message.id, format: 'metadata',
          metadataHeaders: ['Subject','From','Date'],
        }));
        upsertGmailMessage(db, full.data);
      }
    }
    db.prepare('UPDATE gmail_account SET history_id=? WHERE id=1').run(res.data.historyId);
  } catch (err) {
    if (err.code === 404 || err.errors?.[0]?.reason === 'notFound') {
      // historyId invalidated — perform a bounded backfill and reset
      await fullResync7d(client, db, queue);
    } else {
      throw err;
    }
  }
}
```

**Notes:**
- `users.history.list` returns 404 / `notFound` when `startHistoryId` is older than Google's retention window (typically 7 days but undocumented and variable). Must fall back to `messages.list?q=newer_than:7d`. [CITED: https://developers.google.com/gmail/api/guides/sync]
- The response's `historyId` is the **point you must store next** — not the max historyId of any message. Always persist the value from `res.data.historyId`, atomically with the row inserts in a single DB transaction.
- Gmail's **per-user-per-second quota**: 250 quota units/user/second. `history.list` costs 2, `messages.get(metadata)` costs 5, `messages.get(full)` costs 5, `messages.list` costs 5. [CITED: https://developers.google.com/gmail/api/reference/quota]. Concurrency=1 p-queue with no delay handles 7-day backfill well within budget for any realistic inbox.
- Choose **`format='metadata'` for Phase 2 ingest** — gives headers (Subject/From/Date) and `labelIds` (so we can detect `IMPORTANT`/`UNREAD`) without body cost. `format='full'` is for Phase 3 drafting/summarization. Storing only metadata in Phase 2 also keeps the briefing-MVP's storage footprint tiny.

### Pattern: Calendar events.list with syncToken + 410 GONE Fallback

```typescript
async function tickCalendar(client, db, queue) {
  const acct = db.prepare('SELECT sync_token FROM calendar_account WHERE id=1').get();
  try {
    let pageToken: string | undefined;
    let nextSyncToken: string | undefined;
    do {
      const res = await queue.add(() => client.events.list({
        calendarId: 'primary',
        syncToken: acct.sync_token,
        pageToken,
        // when using syncToken, you may NOT also pass timeMin/timeMax/orderBy/q/iCalUID/etc.
      }));
      for (const ev of res.data.items ?? []) upsertCalendarEvent(db, ev);
      pageToken = res.data.nextPageToken;
      nextSyncToken = res.data.nextSyncToken;
    } while (pageToken);
    if (nextSyncToken) {
      db.prepare('UPDATE calendar_account SET sync_token=? WHERE id=1').run(nextSyncToken);
    }
  } catch (err) {
    if (err.code === 410) {
      // syncToken invalidated — start over with a bounded window
      await fullResyncCalendar(client, db, queue);
    } else throw err;
  }
}
```

**Notes:**
- A **410 GONE** on `events.list` with a `syncToken` is the documented invalidation signal. Cause: token older than ~30 days, calendar ACL change, or server-side compaction. Must fall back to `events.list` without syncToken (with `timeMin = now - 1d`, `timeMax = now + 30d` for Phase 2 — we only care about today's briefing). [CITED: https://developers.google.com/calendar/api/guides/sync]
- **MUST NOT** combine `syncToken` with `timeMin`/`timeMax`/`orderBy`/`q`/`singleEvents` modifiers — Google returns 400.
- For a personal Gmail user the primary calendar is `primary`. For Workspace users with multiple calendars, Phase 2 still ships **primary only** (matches CONTEXT.md scope); `calendarList.list` is a Phase-5/4 follow-up.
- **All-day events** use `event.start.date` (YYYY-MM-DD, no time) instead of `event.start.dateTime` (RFC3339 with offset). Renderer must check for both shapes. Persisted columns: `start_date` (nullable, all-day) + `start_at_utc` (nullable, timed). Exactly one is populated per event.
- **Recurring events**: with `singleEvents=false` (default and required when using syncToken), Calendar returns the master event + any exception instances. Phase 2 only displays "today's events" so for the briefing we run a **separate** read query with `singleEvents=true, timeMin/timeMax = today` against the cached `calendar_event` table OR re-call the API in the briefing path. Recommend the latter: at briefing-fire we call `events.list(singleEvents=true, timeMin, timeMax)` *without* syncToken purely for read; the syncToken loop continues to own the cache for change detection. Phase 4 will normalize recurring properly.

### Pattern: AI SDK 6 `generateObject` + Zod for the Briefing

```typescript
// src/main/briefing/generate.ts (shape)
import { generateObject } from 'ai';
import { z } from 'zod';
import { getFrontierModel } from '../llm/providers';
import { LLMRouter } from '../llm/router';

const BriefingSchema = z.object({
  calendar: z.array(z.object({
    id: z.string(),           // calendar_event.id
    title: z.string(),
    why: z.string().max(140),
  })).max(3),
  email: z.array(z.object({
    id: z.string(),           // gmail_message.id
    title: z.string(),
    why: z.string().max(140),
  })).max(3),
  news: z.array(z.object({
    id: z.string(),           // url-hash for dismiss lookup
    title: z.string(),
    why: z.string().max(140),
    source_kind: z.enum(['hn','rss','bundle']),
    url: z.string().url(),
  })).max(3),
});

const decision = await router.classify({ prompt: briefingPrompt, source: 'generic' });
// decision.route === 'FRONTIER' expected (no PII; news ranking is generic)
const model = decision.route === 'FRONTIER'
  ? await getFrontierModel(decision.provider as ProviderId)
  : getLocalModel();
const { object } = await generateObject({
  model,
  schema: BriefingSchema,
  prompt: briefingPrompt,    // includes candidate JSON + persona + last-7d topics
});
// persist + writeRoutingLog same as Phase 1's ask.ts pattern
```

**Notes:**
- AI SDK 6's `generateObject` is verified working on **Anthropic, OpenAI, Google** (all use native structured-output / tool-mode under the hood). [CITED: https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object]
- For **ollama-ai-provider-v2** in AI SDK 6, `generateObject` works but quality varies by model. Recommend Llama 3.1 8B with `mode: 'json'` (the default) for graceful degrade. [ASSUMED: Phase 1's router-based Ask Aria has only exercised `generateText`, not `generateObject`, on the local provider; explicit smoke test recommended in Plan 2-3].
- Routing decision will be `FRONTIER` with `reason='generic-source-frontier-active'` when an Anthropic/OpenAI/Google key is configured. If no frontier key is configured, falls through to local with `reason='frontier-not-configured'` — the briefing still works, just lower quality.

### Pattern: node-cron + powerMonitor Coalescing

```typescript
// src/main/briefing/schedule.ts (shape)
import cron from 'node-cron';
import { powerMonitor } from 'electron';

let task: cron.ScheduledTask | null = null;
let lastFiredDate: string | null = null;   // YYYY-MM-DD in local TZ

export function scheduleBriefing(expr: string, tz: string, run: () => Promise<void>) {
  if (task) task.stop();
  task = cron.schedule(expr, async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); // YYYY-MM-DD
    if (lastFiredDate === today) return;    // dedup — already fired today
    lastFiredDate = today;
    await run();
  }, { timezone: tz });
}

powerMonitor.on('suspend', () => task?.stop());
powerMonitor.on('resume',  () => {
  task?.start();
  // CONTEXT decision: do NOT back-fire on resume. Just let the next scheduled
  // tick happen. The lastFiredDate guard means waking after the cron fired
  // never re-fires for the same day; waking BEFORE the cron fired today still
  // fires when the cron's next minute boundary arrives.
});
```

**Notes:**
- node-cron 4.x is **timezone-aware** via the `timezone` option ([CITED: https://www.npmjs.com/package/node-cron]). Use the user's IANA TZ (`Intl.DateTimeFormat().resolvedOptions().timeZone`); persist it in `settings.briefing.tz`.
- **DST edge case**: if the user's briefing is set for 07:00 and the clock skips 02:00→03:00 (spring forward) or repeats 02:00 (fall back), 07:00 is not affected. Only if the user picks a time *inside* the DST gap (e.g. 02:30 in US locales) does node-cron's behavior become locale-dependent. For Phase 2 the user picker UI defaults to 07:00; lock the picker to whole-hour steps and reject minutes in 02:00–03:00 on transition days OR ignore (the user almost certainly won't pick 02:30 for a daily briefing). Recommend: **just whole-hour steps in the UI**; documents the edge case in TODOs.
- The **`lastFiredDate` guard** is the dedup mechanism: a cron that fires more than once in a day (e.g. clock jumps from sleep) only triggers the briefing job for the first fire. This is the simplest possible coalescing strategy and is what XCUT-01 requires.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth 2.0 token exchange + refresh | Manual `fetch` to `/token` | `google-auth-library` OAuth2Client | Token rotation, clock skew, expiry math is finicky |
| Gmail API REST plumbing | hand fetch + sign | `googleapis` Gmail client | Pagination + quota handling + typed responses |
| Calendar incremental sync | timeMin/timeMax windowing | `events.list` with `syncToken` | syncToken is the only correct change-detection mechanism |
| RSS / Atom parsing | hand-rolled xml2js | `rss-parser` | Atom vs RSS 2.0 vs RDF dialect handling; relative URL resolution |
| Cron schedule + TZ | `setInterval` | `node-cron` with `timezone` | DST, clock-jump on resume, leap-second behavior |
| LLM JSON output | manual prompt + JSON.parse | `generateObject` + Zod | Provider-native structured-output coercion; retry on validation fail |
| PKCE challenge | manual SHA-256 | google-auth-library's built-in | Already correct in the library |

## Common Pitfalls

> Extends the Phase-1 Pitfalls list (1–10 in `01-RESEARCH.md`). New entries numbered 11+.

### Pitfall 11: historyId / syncToken treated as cache, not state

**What goes wrong:** Engineer caches the latest message timestamp, queries Gmail with "give me messages after this timestamp" on next tick. Misses messages that arrived out of order or were unhid by user.
**Why it happens:** Mental model is timestamp-based; Google's incremental APIs are *change-token*-based.
**How to avoid:** historyId / syncToken IS the cursor. Never compute incremental position from row timestamps. Store the change token in the same transaction as the rows it represents.
**Warning sign:** Missing messages in the inbox during morning briefing.

### Pitfall 12: Forgetting `prompt: 'consent'` on first OAuth → no refresh_token

**What goes wrong:** First connect works. App restart can't refresh. User has to re-OAuth daily.
**Why it happens:** Google omits `refresh_token` from the response if the user has previously consented to the same scope set for the same client.
**How to avoid:** Pass `prompt: 'consent'` AND `access_type: 'offline'` on the auth URL. Verify `tokens.refresh_token` is non-empty before persisting; if not, raise a clear "Please re-authorize and grant offline access" error.
**Warning sign:** EMAIL-07 banner appears every app launch.

### Pitfall 13: Storing OAuth tokens in SQLCipher instead of safeStorage

**What goes wrong:** Tokens leak in DB backups; tokens unusable cross-machine (the whole point of backup portability).
**Why it happens:** SQLCipher feels like "the secure store."
**How to avoid:** Mirror Phase 1's frontier-key pattern. **OAuth refresh tokens go in safeStorage** (one entry per integration, e.g. `secrets.json` extended with a `googleTokens: { gmail?, calendar? }` block). `gmail_account` / `calendar_account` rows in SQLCipher hold only non-sensitive metadata (email, historyId, syncToken, last_synced_at, last_error).

### Pitfall 14: combining syncToken with timeMin/orderBy/singleEvents

**What goes wrong:** Calendar API returns 400 `Bad Request`. Easy to write reflexively because most `events.list` examples use `timeMin`/`singleEvents=true`.
**Why it happens:** Two incompatible modes in one method.
**How to avoid:** Two separate code paths — `tickCalendar()` uses only `syncToken` (+ paging); `readTodaysEvents()` uses only `timeMin`/`timeMax`/`singleEvents=true` from the cache OR a fresh API call.

### Pitfall 15: Per-source briefing failure tanks the whole briefing

**What goes wrong:** RSS fetch times out, briefing generation throws, user sees nothing at 7am.
**Why it happens:** Naive `await Promise.all([cal, email, news])`.
**How to avoid:** `Promise.allSettled` for the three candidate-gathering calls. Each section independently sets `{ items: […] }` or `{ error: 'unreachable', last_ok_at: ISO }`. The LLM call only receives the successful sections; the renderer shows inline warnings for failed sections (BRIEF-06).

### Pitfall 16: cron-fired briefing during DB lock from another writer

**What goes wrong:** Briefing tries to write `briefing` row while a `gmail_message` upsert is in progress; SQLite hits BUSY.
**Why it happens:** Multiple writers, no single-writer discipline.
**How to avoid:** Phase 1's `p-queue` (concurrency=1) in `scheduler.ts` is the right place — route ALL DB writes (gmail sync, calendar sync, briefing persist) through it. Reads do not need to queue (SQLCipher with WAL allows concurrent reads).

### Pitfall 17: RSS feed publishes relative URLs

**What goes wrong:** "Read more" links in the briefing 404 because the parser returned `/article/123` instead of `https://example.com/article/123`.
**Why it happens:** Some publishers ship relative `<link>` elements.
**How to avoid:** rss-parser exposes the raw entry; resolve `new URL(entry.link, entry.feedUrl).href` before persisting. (rss-parser doesn't do this automatically.)

### Pitfall 18: Browsing the OAuth window with `nodeIntegration: true`

**What goes wrong:** Google's consent page can call back into Node context (would be), or remote URL exploits the renderer.
**Why it happens:** Copy-paste from Phase 1 BrowserWindow config.
**How to avoid:** OAuth `BrowserWindow` MUST set `webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }`. No preload. The flow only needs DOM rendering of Google's pages.

### Pitfall 19: `event.start.dateTime` parsed via Date() across DST

**What goes wrong:** Event at 09:00 Lagos time displays as 10:00 in the briefing on certain dates.
**Why it happens:** `new Date(rfc3339)` loses the original tz; downstream `.toLocaleString()` re-applies the system tz.
**How to avoid:** Persist both `start_at_utc` (computed) and original `start_timezone` from `event.start.timeZone`. Render via `Intl.DateTimeFormat(undefined, { timeZone: storedTimezone })`. For Phase 2 the user's local tz almost always matches the event tz; the columns earn their keep in Phase 5 (Outlook cross-tz).

## Runtime State Inventory

> N/A — Phase 2 is greenfield additive (new tables, new IPC channels, new files). No renames or migrations of Phase-1 state. The only thing that *extends* is `secrets.json` (safeStorage), which gets a new `googleTokens` subtree; Phase-1 fields are untouched.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — schema is additive (migration 002). | — |
| Live service config | None. | — |
| OS-registered state | None new. node-cron registry is in-process only. | — |
| Secrets/env vars | OAuth `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` need to be embedded in the app (Desktop OAuth client; "secret" not actually secret per RFC 8252). Recommend `import.meta.env` injection at build time via electron-vite `define`. CASA intake §1 already calls these out as TODOs. | One-time GCP project setup |
| Build artifacts | None new. | — |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| GCP project + OAuth Client ID | Gmail/Calendar OAuth | ✗ | — | **BLOCKS Plan 2-1**. User action per CASA intake §1. |
| Privacy policy URL | OAuth consent screen verification | ✗ | — | Phase 2 ships with the unverified-app warning (§10) until user publishes. **Not blocking** dev; blocking distribution. |
| `googleapis` package | All Google API calls | ✗ | — | `npm install` adds it; no system dep. |
| `rss-parser` package | News section | ✗ | — | `npm install`. |
| Anthropic / OpenAI / Google API key | Briefing LLM call | Optional | — | Falls through to local Ollama (router branch 5); briefing still produced, lower quality. |
| Ollama (for local fallback) | Briefing LLM call when no frontier key | User-dependent | — | If neither frontier nor Ollama → briefing degrades to "no rationale" mode (still shows top-3 candidates by source ordering). |
| Internet | Sync ticks + news fetch | User-dependent | — | Per-source error path (Pitfall 15); briefing still generated from cached calendar/email + stale-news warning. |

**Missing dependencies with no fallback:** GCP project + OAuth Client ID — must be created by user before Plan 2-1 runs (it's already an open CASA-intake TODO).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest@4 (unit, main project = node) + playwright@1.60 `_electron` (e2e) |
| Config file | `vitest.config.ts` (two-project), `playwright.config.ts` |
| Quick run command | `npm run test:unit -- tests/unit/main/integrations tests/unit/main/briefing tests/unit/main/news` |
| Full suite command | `npm run test:unit && npm run test:e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| EMAIL-01 | history.list happy path + 404→full-resync | unit (mocked googleapis) | `vitest tests/unit/main/integrations/sync-gmail.spec.ts` | Wave 0 |
| EMAIL-01 | first-connect 7d backfill via messages.list | unit | same file | Wave 0 |
| EMAIL-07 | expired refresh_token surfaces EMAIL-07 banner | unit (renderer) + e2e | `vitest tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx` + `playwright tests/e2e/oauth-reauth.spec.ts` | Wave 0 |
| CAL-01 | events.list syncToken happy path + 410→full-resync + all-day events | unit | `vitest tests/unit/main/integrations/sync-calendar.spec.ts` | Wave 0 |
| BRIEF-01 | cron fires at configured local time; respects tz | unit (fake timers) | `vitest tests/unit/main/briefing/schedule.spec.ts` | Wave 0 |
| BRIEF-03 | generateObject returns valid BriefingSchema | unit (mocked AI SDK) | `vitest tests/unit/main/briefing/generate.spec.ts` | Wave 0 |
| BRIEF-06 | failed source renders inline warning, others survive | unit | `vitest tests/unit/main/briefing/generate.spec.ts` (allSettled path) | Wave 0 |
| XCUT-01 | suspend pauses cron; resume does not back-fire same-day | unit | `vitest tests/unit/main/briefing/schedule.spec.ts` (lastFiredDate guard) | Wave 0 |
| XCUT-06 | status panel rows render sync state + last error | unit (renderer) | `vitest tests/unit/renderer/features/settings/StatusPanel.spec.tsx` | partial — extend existing |
| XCUT-07 | all-day event renders in local-TZ day | unit | `vitest tests/unit/main/integrations/calendar-tz.spec.ts` | Wave 0 |
| e2e gate | first launch → mock OAuth → see briefing | e2e | `playwright tests/e2e/briefing.spec.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npm run test:unit -- <area>` (under 30s for any single area)
- **Per wave merge:** `npm run test:unit` (~ 2–5 min full)
- **Phase gate:** Full suite green before `/gsd-verify-work`. Note: the same Phase-1 SQLCipher-ABI sensitivity applies to any test that opens the encrypted DB; gate-on `npm run rebuild:native` first.

### Wave 0 Gaps
- [ ] `tests/unit/main/integrations/sync-gmail.spec.ts` — covers EMAIL-01
- [ ] `tests/unit/main/integrations/sync-calendar.spec.ts` — covers CAL-01
- [ ] `tests/unit/main/integrations/calendar-tz.spec.ts` — covers XCUT-07
- [ ] `tests/unit/main/briefing/{schedule,generate}.spec.ts` — covers BRIEF-01/03/06, XCUT-01
- [ ] `tests/unit/main/news/{hn,rss,country-bundle}.spec.ts` — covers news sources
- [ ] `tests/unit/renderer/features/settings/IntegrationsSection.spec.tsx` — covers EMAIL-07 banner
- [ ] `tests/e2e/briefing.spec.ts` + OAuth mock fixture — e2e gate
- [ ] **Mocking fixture** for googleapis: see "Mocking Strategy" below
- [ ] **News fixture** for offline test runs: snapshotted HN top-stories JSON + a fixture RSS XML

### Mocking Strategy (Phase 2 specific)

The googleapis package exposes a fluent builder (`google.gmail({ version: 'v1', auth })`) that's awkward to mock at the boundary. Three options researched:

| Option | Approach | Verdict |
|--------|----------|---------|
| `vi.mock('googleapis', …)` | Replace the top-level module | **Recommend.** Mirrors Phase-1's `vi.doMock('electron', …)` style. Each test injects a tiny `gmailMock = { users: { history: { list: vi.fn() }, messages: { list: vi.fn(), get: vi.fn() } } }`. Tests can shape responses per case (404, partial page, success). |
| Inject a `GmailClient` interface | Define `interface GmailClient { listHistory, getMessage, … }` in `gmail.ts`; real impl wraps googleapis, tests pass a fake. | More boilerplate; better long-term hygiene; **adopt this for Phase 2** because we'll need it for Phase-5 Outlook parity (the same interface). |
| nock / msw at HTTP layer | Intercept `googleapis.com` requests | Too much surface area for unit; reserve for the one e2e oauth-reauth test. |

**Recommendation:** Combine 2 and 1. Define a thin `GmailClient` and `CalendarClient` interface in `integrations/google/{gmail,calendar}.ts`; real implementations wrap googleapis; vitest tests inject fakes directly into `GmailSync` / `CalendarSync` constructors (no module mock needed). The one `vi.mock('googleapis')` test exists in `gmail.spec.ts` to verify the **wrapper** translates googleapis errors to our shape (404 → `HistoryInvalidatedError`).

For Playwright e2e: stand up a local mock OAuth server (express + 50 LOC) that returns canned tokens and seeds `gmail_account` directly via a test-only IPC channel. Pattern is identical to Phase 1's `ARIA_E2E` env-gated hook in `onboarding.ts`.

## SQLCipher Migration 002 — Recommended Shape

Append as `EMBEDDED_MIGRATIONS[1]` in `src/main/db/migrations/embedded.ts` (also a `002_phase2.sql` source-of-truth file for the drift test). All columns are encrypted at rest by SQLCipher whole-DB encryption — no per-column work needed.

```sql
-- 002_phase2.sql

CREATE TABLE gmail_account (
  id           INTEGER PRIMARY KEY CHECK (id = 1),     -- v1: single account
  email        TEXT    NOT NULL,
  history_id   TEXT,                                   -- null until first successful sync
  last_synced_at TEXT,                                 -- ISO8601 UTC
  last_error   TEXT,
  connected_at TEXT NOT NULL
);

CREATE TABLE gmail_message (
  id           TEXT PRIMARY KEY,                       -- Gmail message id
  thread_id    TEXT NOT NULL,
  from_addr    TEXT NOT NULL,
  subject      TEXT NOT NULL DEFAULT '',
  snippet      TEXT NOT NULL DEFAULT '',
  received_at  TEXT NOT NULL,                          -- ISO8601 UTC (derived from internalDate ms-since-epoch)
  label_ids    TEXT NOT NULL,                          -- JSON array string ['INBOX','UNREAD','IMPORTANT', …]
  is_unread    INTEGER NOT NULL DEFAULT 0,             -- derived bool, indexed
  is_important INTEGER NOT NULL DEFAULT 0,             -- derived bool, indexed
  history_id   TEXT,                                   -- the historyId this row was learned from (debugging)
  fetched_at   TEXT NOT NULL
);
CREATE INDEX idx_gmail_message_recv ON gmail_message(received_at DESC);
CREATE INDEX idx_gmail_message_priority
  ON gmail_message(is_unread, is_important, received_at DESC);

CREATE TABLE calendar_account (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  email         TEXT    NOT NULL,
  calendar_id   TEXT    NOT NULL DEFAULT 'primary',
  sync_token    TEXT,
  last_synced_at TEXT,
  last_error    TEXT,
  connected_at  TEXT NOT NULL
);

CREATE TABLE calendar_event (
  id            TEXT PRIMARY KEY,                      -- event.id
  calendar_id   TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  location      TEXT,
  start_at_utc  TEXT,                                  -- nullable: timed events
  end_at_utc    TEXT,
  start_date    TEXT,                                  -- nullable: all-day events (YYYY-MM-DD)
  end_date      TEXT,
  start_timezone TEXT,                                 -- preserved from event.start.timeZone
  attendees     TEXT NOT NULL DEFAULT '[]',            -- JSON array of {email,response}
  status        TEXT NOT NULL DEFAULT 'confirmed',     -- confirmed | tentative | cancelled
  recurring_id  TEXT,                                  -- event.recurringEventId
  updated_at    TEXT NOT NULL,                         -- event.updated
  fetched_at    TEXT NOT NULL,
  CHECK ((start_at_utc IS NOT NULL) OR (start_date IS NOT NULL))
);
CREATE INDEX idx_calendar_event_start ON calendar_event(start_at_utc);
CREATE INDEX idx_calendar_event_start_date ON calendar_event(start_date);

CREATE TABLE briefing (
  date         TEXT PRIMARY KEY,                       -- YYYY-MM-DD in user's local TZ
  generated_at TEXT NOT NULL,                          -- ISO8601 UTC
  tz           TEXT NOT NULL,                          -- IANA tz at generation
  sections     TEXT NOT NULL,                          -- JSON: {calendar:[…], email:[…], news:[…], errors:{…}}
  route        TEXT NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
  model        TEXT NOT NULL,
  latency_ms   INTEGER NOT NULL,
  ok           INTEGER NOT NULL CHECK (ok IN (0,1))
);

CREATE TABLE news_source (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  kind      TEXT NOT NULL CHECK (kind IN ('hn','rss','bundle')),
  country   TEXT,                                       -- ISO 3166-1 alpha-2; 'NG' for bundle
  sector    TEXT,                                       -- 'gov' | 'finance' | 'tech' | 'energy' | …
  url       TEXT,                                       -- null for 'hn'; bundle entries are pre-seeded
  title     TEXT,
  enabled   INTEGER NOT NULL DEFAULT 1,
  added_at  TEXT NOT NULL
);

CREATE TABLE briefing_item_dismissed (
  date        TEXT NOT NULL,                            -- YYYY-MM-DD local
  url_hash    TEXT NOT NULL,                            -- SHA-256 hex of item.url
  dismissed_at TEXT NOT NULL,
  PRIMARY KEY (date, url_hash)
);
```

**Notes:**
- `CHECK (id = 1)` on `gmail_account` / `calendar_account` enforces single-account-per-integration for Phase 2; Phase 5 will relax this. Avoids the multi-account UX work now.
- `label_ids TEXT (JSON)` over a `gmail_message_label` join table: Phase 2 only reads `IMPORTANT`/`UNREAD`, derived columns `is_important` / `is_unread` are indexable. Avoid the join table until Phase 3 needs full label CRUD.
- `briefing` keyed on `date` (one briefing per day) — idempotent retries from cron coalescing won't dup-insert.
- `briefing_item_dismissed.url_hash`: hash the resolved absolute URL post-relative-resolution (Pitfall 17), not the raw entry link.

## Time-Zone Handling

| Aspect | Decision |
|--------|----------|
| DB storage | All timestamps `TEXT` ISO8601 UTC. All-day events use `start_date` (YYYY-MM-DD) in the **event's** stated TZ (not user's). |
| Renderer display | `Intl.DateTimeFormat(undefined, { timeZone: userTz, … })`. `userTz = Intl.DateTimeFormat().resolvedOptions().timeZone`. |
| Cron schedule | `cron.schedule(expr, fn, { timezone: userTz })`. Persist `userTz` in `settings.briefing_tz` so a settings change overrides Intl detection. |
| "Today" for the briefing | `new Intl.DateTimeFormat('en-CA', { timeZone: userTz }).format(new Date())` → `YYYY-MM-DD`. Used as `briefing.date` primary key. |
| DST | Whole-hour cron times only in the picker UI (avoids 02:30 spring-forward edge case). Existing event rows unaffected — UTC is the canonical store. |
| Cross-TZ event display (e.g. event scheduled in NY, user in Lagos) | Phase 2: render in **user's** TZ (Phase 5 will add per-event TZ display for Outlook parity). `start_timezone` column captured now for the future. |

## CASA / Unverified-App UX

While CASA Tier 2 is in flight (Phase 1 deferred state), the **OAuth consent screen will show an unverified-app warning** to the user. Concretely:

1. User clicks "Connect Gmail" in `IntegrationsSection`.
2. Aria's BrowserWindow opens Google's consent URL.
3. Google displays:
   - **For unverified clients accessing sensitive scopes** (gmail.readonly, calendar.readonly are sensitive): a "Google hasn't verified this app" screen with an "Advanced → Go to Aria (unsafe)" link. User must click through.
   - **Once OAuth consent is published in Testing** with the user as a test user: a different, less alarming "This app is in testing" screen. **Recommended pre-launch state.**
4. After Tier 2 LoA + verification: standard consent screen (no warning).

**Recommendation:** Add a **pre-OAuth modal** in Aria itself before opening the BrowserWindow, that explains: *"Google will show a warning that Aria hasn't been verified. This is expected during Aria's beta — click 'Advanced' then 'Go to Aria' to continue. Aria reads your email only, never sends or modifies, and stores everything locally."* — and a "Continue" / "Cancel" button. This converts the scary Google warning into expected behavior for the user.

[CITED: https://support.google.com/cloud/answer/7454865 — Sensitive/restricted scope verification states]

Also: while in **Testing** publishing status, Google restricts the OAuth client to **100 test users** and refresh tokens **expire after 7 days**. Aria must catch the 7-day expiry as EMAIL-07 and re-prompt. Once published (after verification), refresh tokens are stable. This is a real production gotcha worth a TODO in the integration error taxonomy.

[CITED: https://developers.google.com/identity/protocols/oauth2#expiration]

## Patterns from Phase 1 to Extend

| Phase 1 file | Phase 2 extension |
|--------------|-------------------|
| `src/shared/ipc-contract.ts` | Add namespaces: `GMAIL_CONNECT`, `GMAIL_STATUS`, `GMAIL_DISCONNECT`, `CALENDAR_CONNECT`, `CALENDAR_STATUS`, `CALENDAR_DISCONNECT`, `BRIEFING_TODAY`, `BRIEFING_HISTORY`, `BRIEFING_DISMISS_NEWS_ITEM`, `NEWS_LIST_SOURCES`, `NEWS_ADD_RSS`, `NEWS_SET_BUNDLE`. Mirror in `CHANNEL_METHODS` map. |
| `src/main/secrets/safeStorage.ts` | Add `setGoogleTokens({ kind, refreshToken, email })` / `getGoogleTokens(kind)` / `clearGoogleTokens(kind)`. Mirror the existing provider-keyed pattern. Same `secrets.json`, new `googleTokens` subtree. |
| `src/main/db/migrations/embedded.ts` | Append version 2 entry. Do NOT touch version 1. |
| `src/main/llm/router.ts` | No changes — briefing call goes through unchanged. `source: 'generic'` triggers FRONTIER when active provider configured. |
| `src/main/llm/providers.ts` | No changes — `getFrontierModel(provider)` already returns a model compatible with `generateObject`. |
| `src/main/lifecycle/powerMonitor.ts` | Extend: accept an `onSuspend` / `onResume` callback set so the briefing scheduler can register pause/resume hooks. Phase 1 only logs; this is the first real consumer. |
| `src/main/lifecycle/scheduler.ts` | The p-queue is the **single writer queue** for Phase 2. All Gmail sync writes, Calendar sync writes, and briefing persistence go through `schedulerHandle.queue.add(…)`. The `cronRegistry` map gets entries: `'gmail-sync'`, `'calendar-sync'`, `'briefing'`. |
| `src/main/ipc/index.ts` | Add `registerGmailHandlers`, `registerCalendarHandlers`, `registerBriefingHandlers`, `registerNewsHandlers` to the chained register pattern. Same shape as Phase 1's secrets / ollama registration. |
| `src/main/log/redact.ts` | Add OAuth bearer-token patterns to redaction; ensure Gmail message bodies (Phase 3) never log — Phase 2 only logs message IDs + label_ids. |
| `src/renderer/features/settings/StatusPanel.tsx` | Add `<IntegrationStatusRow kind="gmail" />` + `<IntegrationStatusRow kind="calendar" />` that poll `gmailStatus()` / `calendarStatus()` every 10s. |
| `src/renderer/features/settings/SettingsScreen.tsx` | Mount new `IntegrationsSection` and `NewsSourcesSection` routes alongside existing sections. |
| `src/renderer/features/onboarding/OnboardingWizard.tsx` | Add a 4th step `CountrySectorPicker` after `MnemonicConfirm`. Persists to `news_source` table via IPC. |
| `tests/setup.ts` | Reuse `createTempUserDataDir()`; add a `mockGoogleapis()` helper that returns a configured `GmailClient` / `CalendarClient` fake. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | AI SDK 6 `generateObject` works on ollama-ai-provider-v2 for Llama 3.1 8B | §4 / Pattern: generateObject | Briefing local-fallback path lower quality than expected; add explicit smoke test in Plan 2-3 to verify; fallback degrade-mode = "no rationale" (still render candidates). |
| A2 | Gmail history.list 404 retention window is "typically 7 days" | Pitfall 11, §2 | Google does not publish an exact number; we should plan to fall through to 7d backfill on ANY 404, not assume an exact age. |
| A3 | Test-mode OAuth refresh tokens expire after 7 days | §10 CASA UX | Documented but worth observing in our specific GCP project; treat as production gotcha. |
| A4 | `Intl.DateTimeFormat` is available + correct in Electron 41's Chromium 146 | §9 TZ | LOW RISK — Chromium has full Intl support, tz data is current. |
| A5 | rss-parser handles all 3 NG bundle feeds without dialect surprises | §5 RSS | Sample the actual feeds during Plan 2-3 implementation; fall back to fast-xml-parser only if needed (rare). |

## Open Questions

1. **GCP project ID + OAuth client must exist before any code can OAuth.** Same as the CASA-intake §1 TODO. Planner should either treat as Wave-0 user-action prerequisite or stub a `GOOGLE_OAUTH_CLIENT_ID` env-var fallback for dev (using a personal OAuth client) and document the swap for distribution.
   - **Recommendation:** Document a dev-time `.env.local` with personal OAuth client IDs; production build embeds the Aria-org client IDs at electron-vite build-time via `define`. Planner: include a Wave-0 setup task with the GCP instructions.

2. **Should briefing missed-on-sleep ever back-fire on resume?** CONTEXT.md decision = no. But: if the user wakes the machine at 9am and the 7am briefing was missed, they get nothing until tomorrow. UX worth revisiting at Plan-checker — possibly fire a "missed briefing — generate now?" button in the renderer instead of auto-firing.

3. **News candidate count budget** for the LLM ranking call. With 3 sources × top-N each + last-7-day calendar topics + persona, prompt size matters. Recommend: HN top-30, RSS user-feeds top-10 per feed, NG bundle top-5 per feed → cap candidate count at 50 with explicit per-source fairness. Verify token count fits within Claude Sonnet's context cheaply (it does — ~5K tokens — but worth measuring).

4. **`gmail.metadata` scope vs `gmail.readonly`** — `gmail.metadata` is *less* sensitive (header-only, no body access) and could support Phase 2's metadata-only ingest. But Phase 3 needs `gmail.readonly` (full body for summarization) and *also* `gmail.send` — switching scopes mid-product reissues CASA paperwork. **Recommend stick with `gmail.readonly` from Phase 2** to keep the consent ladder monotonic.

5. **Recurring events for "today"** — Phase 2 strategy says "re-call API with `singleEvents=true, timeMin/timeMax = today`" at briefing time. This adds one API call per briefing — fine. Alternative: expand recurrence in-process. Reject (recurrence semantics are subtle; Phase 4 is the right place).

## Sources

### Primary (HIGH confidence)
- Gmail API guides — Sync: https://developers.google.com/gmail/api/guides/sync (history.list invalidation contract)
- Calendar API guides — Sync: https://developers.google.com/calendar/api/guides/sync (syncToken 410 contract)
- Google Identity — OAuth 2.0: https://developers.google.com/identity/protocols/oauth2 (refresh token lifecycle, test-mode 7d expiry)
- Google Identity — Server-side: https://developers.google.com/identity/protocols/oauth2/web-server#offline (access_type/prompt for refresh_token)
- Gmail API quota: https://developers.google.com/gmail/api/reference/quota
- Vercel AI SDK 6 — generateObject: https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-object
- node-cron README: https://www.npmjs.com/package/node-cron
- rss-parser README: https://github.com/rbren/rss-parser
- npm registry — package versions verified 2026-05-16:
  - googleapis@171.4.0 (npm view)
  - google-auth-library@10.6.2 (npm view)
  - rss-parser@3.13.0 (npm view)
  - fast-xml-parser@5.8.0 (npm view)

### Secondary (MEDIUM confidence)
- Google CASA / Sensitive-scope verification states: https://support.google.com/cloud/answer/7454865
- RFC 8252 (OAuth 2.0 for Native Apps; loopback IP + PKCE guidance)

### Tertiary (LOW confidence)
- "Gmail history.list 404 happens ~7d after issuance" — community lore; Google does not publish an exact threshold. Treat as: catch 404, fall back to backfill, do not assume an age.

## Metadata

**Confidence breakdown:**
- Google OAuth / Gmail / Calendar API mechanics: HIGH — official docs are clear and current; the patterns are well-trodden.
- AI SDK 6 generateObject across providers: HIGH on Anthropic/OpenAI/Google, MEDIUM on ollama-ai-provider-v2 for structured output (worth a smoke test in Plan 2-3).
- node-cron + powerMonitor coalescing: HIGH for the lastFiredDate guard pattern; the only remaining risk is the DST/clock-jump edge case which is contained by whole-hour-only picker UI.
- RSS library choice (rss-parser): MEDIUM-HIGH — the most common Node RSS parser, but its main release is from 2023; alternative `fast-xml-parser` is the fallback if a real-world NG feed misbehaves.
- CASA / unverified-app UX: MEDIUM — depends on GCP project publishing state which is user-action-dependent (CASA intake TODOs).
- SQLCipher schema additions: HIGH — same pattern as Phase 1 migration 001; additive only.

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days; Google API surfaces are stable, but watch for AI SDK 6 minor releases that change generateObject semantics).

---
phase: 02-gmail-ingest-daily-briefing-mvp
plan: 04
type: execute
wave: 4
depends_on: ["02-gmail-ingest-daily-briefing-mvp/03"]
files_modified:
  - src/shared/ipc-contract.ts
  - src/main/db/migrations/embedded.ts
  - src/main/db/migrations/005_briefing.sql
  - src/main/briefing/generate.ts
  - src/main/briefing/schedule.ts
  - src/main/briefing/persist.ts
  - src/main/briefing/redact.ts
  - src/main/ipc/briefing.ts
  - src/main/ipc/index.ts
  - src/renderer/features/briefing/BriefingScreen.tsx
  - src/renderer/features/briefing/SectionCalendar.tsx
  - src/renderer/features/briefing/SectionEmail.tsx
  - src/renderer/features/briefing/SectionNews.tsx
  - src/renderer/features/briefing/GenerateNowAffordance.tsx
  - src/renderer/features/settings/BriefingSettingsSection.tsx
  - src/renderer/features/settings/SettingsScreen.tsx
  - src/renderer/app/router.tsx
  - tests/unit/main/briefing/generate.spec.ts
  - tests/unit/main/briefing/schedule.spec.ts
  - tests/unit/main/briefing/persist.spec.ts
  - tests/unit/main/briefing/redact.spec.ts
  - tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx
  - tests/unit/renderer/features/settings/BriefingSettingsSection.spec.tsx
  - tests/e2e/briefing.spec.ts
autonomous: true
requirements: [BRIEF-01, BRIEF-03, BRIEF-06, XCUT-01]
tags: [briefing, ai-sdk, generateObject, zod, node-cron, power-monitor, pii-redaction, e2e]

must_haves:
  truths:
    - "Daily briefing cron fires at user-configured local time (default 07:00) in their IANA TZ; lastFiredDate guard prevents double-fire same day (BRIEF-01 + XCUT-01)"
    - "powerMonitor 'suspend' stops the briefing cron registry entry; 'resume' restarts it WITHOUT back-firing missed days (XCUT-01); BriefingScreen renders a 'Generate today's briefing now?' affordance when no briefing row exists for today's local date"
    - "Briefing generation produces ONE row in `briefing` keyed on YYYY-MM-DD local; idempotent — repeated triggers same day do not duplicate"
    - "Briefing payload contains three sections (Today's Calendar, Priority Email, News), each capped at top-3 items, each item carrying a one-line 'why' rationale ≤140 chars (BRIEF-03 + SC2)"
    - "Briefing LLM call goes through Phase 1's LLMRouter.classify({source:'generic'}) → generateObject(BriefingSchema) via AI SDK 6; writes ONE row to routing_log"
    - "Candidate gathering uses Promise.allSettled — any single failed source (cal/email/news) renders an inline warning in that section and does NOT block the other two (BRIEF-06 + Pitfall 15)"
    - "News candidate pool = top 20 HN + top 15 RSS user feeds + top 15 NG bundle, deduplicated by URL-hash, capped at 50 total"
    - "News items are dismissible per-day, persisted in `briefing_item_dismissed` keyed by (date, url_hash); dismissed items disappear from BriefingScreen"
    - "Briefing trigger time picker exposes whole-hour-only options (avoids DST 02:00–03:00 edge case)"
    - "**M1 PII redaction:** before constructing the briefing prompt, every raw sender email address is replaced with `<EMAIL>`; the assembled prompt string contains no match for `\\S+@\\S+\\.\\S+` regex. The router routes the redacted prompt with `source='generic'` → FRONTIER (since classifier sees no PII)."
    - "**B4 SC2 fallback:** when `gatherEmail` returns 0 rows AND `gmail_message` has unread rows in the last 24h (i.e. user's account has unread mail but none flagged IMPORTANT by Gmail), the §Priority Email section renders the exact empty-state copy: 'No mail flagged Important by Gmail. Phase 3 adds Aria's own priority classifier.' This is NOT a BRIEF-06 error — it is the documented Phase-2 limitation."
    - "**L2 cron registry size:** scheduler.cronRegistry size remains 3 (`gmail-sync`, `calendar-sync`, `briefing`) across one suspend/resume cycle; no cron back-fires (XCUT-01 hardening)"
  artifacts:
    - path: "src/main/briefing/generate.ts"
      provides: "runBriefing(date, deps) — Promise.allSettled gather + PII redaction + generateObject + routing_log write + persist"
      exports: ["runBriefing", "BriefingSchema", "buildBriefingPrompt"]
    - path: "src/main/briefing/redact.ts"
      provides: "redactEmailsInBriefingInput(candidates) — strips raw email addresses before prompt assembly (M1)"
      exports: ["redactEmailsInBriefingInput", "EMAIL_TOKEN_REGEX"]
    - path: "src/main/briefing/schedule.ts"
      provides: "scheduleBriefing(expr, tz, run) + lastFiredDate dedup + powerMonitor.registerLifecycleCallbacks hook"
      exports: ["scheduleBriefing", "stopBriefingSchedule"]
    - path: "src/main/briefing/persist.ts"
      provides: "upsert/read briefing row + dismiss-news-item CRUD"
      exports: ["upsertBriefing", "readBriefing", "dismissNewsItem", "isNewsItemDismissed"]
    - path: "src/main/db/migrations/005_briefing.sql"
      provides: "briefing + briefing_item_dismissed tables"
    - path: "src/renderer/features/briefing/BriefingScreen.tsx"
      provides: "Sectioned doc UI + GenerateNowAffordance + per-section error/empty states + dismiss-news action + SC2 fallback for no-IMPORTANT-label accounts"
    - path: "src/renderer/features/settings/BriefingSettingsSection.tsx"
      provides: "Whole-hour time picker + tz dropdown + Generate now button + last-briefing status"
  key_links:
    - from: "src/main/briefing/generate.ts"
      to: "src/main/briefing/redact.ts"
      via: "redactEmailsInBriefingInput called BEFORE buildBriefingPrompt"
      pattern: "redactEmailsInBriefingInput"
    - from: "src/main/briefing/generate.ts"
      to: "src/main/llm/router.ts + ai@^6 generateObject"
      via: "router.classify({source:'generic'}) → getFrontierModel OR getLocalModel → generateObject({model, schema, prompt})"
      pattern: "generateObject\\("
    - from: "src/main/briefing/schedule.ts"
      to: "src/main/lifecycle/powerMonitor.ts (registerLifecycleCallbacks API from Plan 02-01 Task 3)"
      via: "onSuspend → task.stop(); onResume → task.start() (no back-fire)"
      pattern: "registerLifecycleCallbacks"
    - from: "src/renderer/features/briefing/BriefingScreen.tsx"
      to: "window.aria.briefingToday + briefingDismissNewsItem + briefingGenerateNow"
      via: "preload IPC bridge"
      pattern: "window\\.aria\\.briefing"
---

<objective>
## Phase Goal

**As a** solo-dev SMB-exec who has connected Gmail (Plan 02-01), Calendar (Plan 02-02), and picked news sources (Plan 02-03), **I want to** wake up at 7am to a sectioned daily briefing — top 3 calendar events, top 3 priority emails, top 3 external news items, each with a one-line "why this mattered" — and have the ability to generate today's briefing on demand if I missed the cron fire, **so that** Aria proves its core value as my daily chief-of-staff layer.

Purpose: Closes the Phase 2 MVP. Delivers BRIEF-01 (daily briefing at configurable local time), BRIEF-03 briefing-engine half (calendar + email + news rendering), BRIEF-06 (graceful degrade), and XCUT-01 (sleep/wake cron coalescing). Demonstrates that Phase 1's LLM router + AI SDK 6 + `generateObject` + Zod stack can drive a real product surface, end-to-end through the e2e gate.

Output: Migration 005 with `briefing` + `briefing_item_dismissed` tables; PII redaction module stripping raw email addresses before prompt assembly (M1); `runBriefing()` engine doing Promise.allSettled gather → redact → `generateObject(BriefingSchema)` → persist + routing_log write; node-cron scheduler with powerMonitor pause/resume + lastFiredDate dedup; BriefingScreen renderer with sectioned doc + GenerateNowAffordance + per-section error banners + per-day news dismissal + the SC2 no-IMPORTANT-label fallback (B4); BriefingSettingsSection with whole-hour-only time picker; Playwright e2e proving the whole walking skeleton end-to-end.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@CLAUDE.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md
@.planning/phases/01-foundation/01-04-llm-router-SUMMARY.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-01-SUMMARY.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-02-SUMMARY.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-03-SUMMARY.md
@src/shared/ipc-contract.ts
@src/main/llm/router.ts
@src/main/llm/providers.ts
@src/main/llm/routingLog.ts
@src/main/integrations/google/sync-calendar.ts
@src/main/lifecycle/scheduler.ts
@src/main/lifecycle/powerMonitor.ts
@src/main/news/hn.ts
@src/main/news/rss.ts
@src/main/news/country-bundle.ts
@src/renderer/app/router.tsx

<interfaces>
<!-- New IPC channels (CHANNELS map): -->
<!-- BRIEFING_TODAY: 'aria:briefing:today'                       ({ date?: string }) => BriefingPayload | { error: string; lastOkDate?: string } -->
<!-- BRIEFING_GENERATE_NOW: 'aria:briefing:generate-now'         () => { ok: boolean; date?: string; error?: string } -->
<!-- BRIEFING_DISMISS_NEWS_ITEM: 'aria:briefing:dismiss-news-item' ({ date, urlHash }) => { ok: true } -->
<!-- BRIEFING_HISTORY: 'aria:briefing:history'                   ({ limit?: number }) => { entries: BriefingSummary[] } -->
<!-- BRIEFING_GET_SETTINGS: 'aria:briefing:get-settings'         () => { time: 'HH:00', tz: string } -->
<!-- BRIEFING_SET_SETTINGS: 'aria:briefing:set-settings'         ({ time: 'HH:00', tz: string }) => { ok: true } -->
<!-- export interface BriefingPayload { -->
<!--   date: string; generatedAt: string; tz: string; -->
<!--   calendar: BriefingItem[]; email: BriefingItem[]; news: BriefingNewsItem[]; -->
<!--   errors: { calendar?: string; email?: string; news?: string }; -->
<!--   emailEmptyStateReason?: 'no-important-label' | undefined;  // B4: distinguishes "no candidates" from "source failed" -->
<!--   route: 'LOCAL'|'FRONTIER'; reason: string; model: string; -->
<!-- } -->
<!-- export interface BriefingItem { id: string; title: string; why: string } -->
<!-- export interface BriefingNewsItem extends BriefingItem { url: string; sourceKind: 'hn'|'rss'|'bundle'; dismissed: boolean } -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Migration 005 + ipc-contract briefing channels + PII redaction module (M1) + persist layer</name>
  <files>src/shared/ipc-contract.ts, src/main/db/migrations/embedded.ts, src/main/db/migrations/005_briefing.sql, src/main/briefing/redact.ts, src/main/briefing/persist.ts, tests/unit/main/briefing/redact.spec.ts, tests/unit/main/briefing/persist.spec.ts</files>
  <read_first>
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"SQLCipher Migration 002 — Recommended Shape" (briefing + briefing_item_dismissed subset only)
    - src/main/db/migrations/embedded.ts (state after Plan 02-03 — append version 5)
    - src/main/log/redact.ts (Phase 1 redact patterns — reuse the EMAIL pattern)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md "Briefing layout & content density"
  </read_first>
  <behavior>
    - Migration 005 ships `briefing` + `briefing_item_dismissed` tables verbatim per RESEARCH.
    - `CHANNELS` gains 6 new briefing.* channel literals. Type exports per `<interfaces>`.
    - **M1 redaction module (`src/main/briefing/redact.ts`):**
      - Exports `EMAIL_TOKEN_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g` (the canonical email shape used by Phase 1 classifier).
      - Exports `redactEmailsInBriefingInput(candidates)`: walks the email-candidate list AND any string fields in calendar/news candidates; replaces every regex match with the literal token `<EMAIL>`. Does NOT touch the news candidate `url` field (URLs are not PII inputs for the classifier — they're rendered as-is in the UI). Preserves the original sender display-name (e.g. "Adex Samson <adex@example.com>" → "Adex Samson <EMAIL>"). Returns a NEW candidate object — does not mutate input.
      - Idempotent: running redact twice produces the same output as once.
    - `persist.ts`:
      - `upsertBriefing(db, row)` runs `INSERT OR REPLACE INTO briefing (...) VALUES (...)`.
      - `readBriefing(db, date)` returns the row (null if absent); JSON.parses sections; populates `news[i].dismissed` by joining `briefing_item_dismissed`.
      - `dismissNewsItem(db, { date, urlHash })` runs `INSERT OR IGNORE INTO briefing_item_dismissed (date, url_hash, dismissed_at)`.
      - `isNewsItemDismissed(db, date, urlHash)` returns boolean.
  </behavior>
  <action>
    Create `src/main/db/migrations/005_briefing.sql` with:
    ```
    CREATE TABLE briefing (
      date TEXT PRIMARY KEY,
      generated_at TEXT NOT NULL,
      tz TEXT NOT NULL,
      sections TEXT NOT NULL,
      route TEXT NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
      model TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL CHECK (ok IN (0,1))
    );
    CREATE TABLE briefing_item_dismissed (
      date TEXT NOT NULL,
      url_hash TEXT NOT NULL,
      dismissed_at TEXT NOT NULL,
      PRIMARY KEY (date, url_hash)
    );
    ```
    Append `EMBEDDED_MIGRATIONS[4] = { version: 5, file: '005_briefing.sql', sql: <verbatim above> }`.

    Extend `src/shared/ipc-contract.ts` with 6 new briefing.* channel literals and the type exports (BriefingPayload, BriefingItem, BriefingNewsItem). Include the `emailEmptyStateReason` optional field on BriefingPayload (B4).

    Create `src/main/briefing/redact.ts` per behavior block.

    Create `src/main/briefing/persist.ts` exporting `upsertBriefing`, `readBriefing`, `dismissNewsItem`, `isNewsItemDismissed`. All writes happen inside `scheduler.queue.add(...)` (Pitfall 16 — single-writer queue).

    Create `tests/unit/main/briefing/redact.spec.ts`:
    1. Single email in subject: `"Re: contract from foo@bar.com"` → `"Re: contract from <EMAIL>"`.
    2. Display-name preserved: `"Adex Samson <adex@example.com>"` → `"Adex Samson <EMAIL>"`.
    3. Multiple emails in one string: both replaced.
    4. No email in string: unchanged.
    5. News candidate `url` field: NOT redacted (assert `mailto:` URLs in news titles remain — but raw addresses in titles ARE redacted).
    6. Idempotent: `redact(redact(x)) === redact(x)`.
    7. **B4 redacted prompt invariant:** given a candidate set with several emails, run redact + buildBriefingPrompt (imported from generate.ts via dependency — OR replicate the prompt-assembly logic in this spec) → assert `/\S+@\S+\.\S+/.test(prompt) === false`.

    Create `tests/unit/main/briefing/persist.spec.ts` against temp SQLCipher DB with migrations 001+002+003+004+005 applied:
    1. `upsertBriefing` inserts a row; `readBriefing(date)` returns it with sections JSON parsed.
    2. Re-running `upsertBriefing` with same `date` replaces the row (idempotent).
    3. `dismissNewsItem({date:'2026-05-20', urlHash:'abc'})` writes; `isNewsItemDismissed(db, '2026-05-20', 'abc')` returns true; same urlHash on `2026-05-21` returns false (per-day, not permanent).
    4. `readBriefing(date)` populates `news[i].dismissed: true` for any item whose url_hash matches a row in `briefing_item_dismissed` for that date.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/briefing/redact.spec.ts tests/unit/main/briefing/persist.spec.ts tests/unit/main/db</automated>
  </verify>
  <acceptance_criteria>
    - All redact.spec.ts (7) + persist.spec.ts (4) cases pass.
    - `grep -c "version: 5" src/main/db/migrations/embedded.ts` returns ≥ 1.
    - `grep -c "CREATE TABLE briefing" src/main/db/migrations/005_briefing.sql` returns ≥ 1.
    - `grep -c "CREATE TABLE briefing_item_dismissed" src/main/db/migrations/005_briefing.sql` returns 1.
    - `grep -v '^\s*//' src/shared/ipc-contract.ts | grep -c "aria:briefing:"` returns 6.
    - `grep -c "EMAIL_TOKEN_REGEX\\|<EMAIL>" src/main/briefing/redact.ts` returns ≥ 2.
    - `grep -v '^[[:space:]]*//' src/main/briefing/persist.ts | grep -c "INSERT OR REPLACE INTO briefing\\|INSERT INTO briefing\\b"` returns ≥ 1.
    - `grep -v '^[[:space:]]*//' src/main/briefing/persist.ts | grep -c "INSERT OR IGNORE INTO briefing_item_dismissed"` returns ≥ 1.
  </acceptance_criteria>
  <done>Migration 005 ships briefing + briefing_item_dismissed, ipc-contract reserves the 6 briefing.* channels with B4 fallback type, M1 PII redaction module is implemented and tested with the regex-zero invariant.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Briefing engine (generate.ts) — Promise.allSettled gather, M1 redact, generateObject(BriefingSchema), B4 SC2 fallback, schedule.ts with powerMonitor coalescing</name>
  <files>src/main/briefing/generate.ts, src/main/briefing/schedule.ts, tests/unit/main/briefing/generate.spec.ts, tests/unit/main/briefing/schedule.spec.ts</files>
  <read_first>
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Pattern: AI SDK 6 generateObject + Zod for the Briefing" (BriefingSchema shape — calendar/email/news arrays of {id,title,why}, news adds {sourceKind, url}, all max(3), why max(140))
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Pattern: node-cron + powerMonitor Coalescing" (lastFiredDate, cron.schedule with timezone, suspend stop + resume start WITHOUT back-fire)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Common Pitfalls" 15, 16
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md Resolutions (candidate-pool budget; missed-on-sleep policy — Generate now affordance, NOT auto-fire)
    - src/main/llm/router.ts + src/main/llm/providers.ts + src/main/llm/routingLog.ts (Plan 01-04 — reuse verbatim)
    - src/main/integrations/google/sync-calendar.ts (readTodaysEvents helper — Plan 02-02 export)
    - src/main/lifecycle/powerMonitor.ts (registerLifecycleCallbacks API — extended in Plan 02-01 Task 3)
    - src/main/news/hn.ts, src/main/news/rss.ts, src/main/news/country-bundle.ts (Plan 02-03 exports)
  </read_first>
  <behavior>
    - `BriefingSchema` (Zod) exported from `generate.ts`:
      ```
      z.object({
        calendar: z.array(z.object({ id: z.string(), title: z.string(), why: z.string().max(140) })).max(3),
        email:    z.array(z.object({ id: z.string(), title: z.string(), why: z.string().max(140) })).max(3),
        news:     z.array(z.object({ id: z.string(), title: z.string(), why: z.string().max(140),
                                     source_kind: z.enum(['hn','rss','bundle']), url: z.string().url() })).max(3),
      })
      ```
    - `runBriefing({ db, date, userTz, calendarClient, scheduler, router, logger })`:
      1. Promise.allSettled over three gather functions:
         - `gatherCalendar()` → `readTodaysEvents(calendarClient, userTz)` → normalize to `{ id, title, startsAt, allDay, location }`.
         - `gatherEmail(db)` → `SELECT id, subject, from_addr, snippet, received_at FROM gmail_message WHERE is_unread=1 AND is_important=1 AND received_at >= datetime('now','-24 hours') ORDER BY received_at DESC LIMIT 20`.
         - `gatherNews(db)` → reads `news_source` rows; calls `fetchHnTopStories(20)`, `fetchRssFeed` for each enabled rss row (limit 5 each, capped at 15 total), `fetchBundleCandidates({country, sectors}, 15)`; deduplicates by sha256(url) and caps at 50; filters out items whose url_hash is in `briefing_item_dismissed` for `date`.
      2. **B4 SC2 fallback detection (before LLM call):** if `gatherEmail` returned 0 rows, run a probe query: `SELECT COUNT(*) FROM gmail_message WHERE is_unread=1 AND received_at >= datetime('now','-24 hours')`. If probe > 0 (account has unread mail but none flagged IMPORTANT), set `emailEmptyStateReason = 'no-important-label'` on the payload. This flag drives the renderer's distinct empty-state copy. Document in `<out_of_scope>` that Phase 3's classifier replaces this.
      3. For each rejected promise: record the error in `errors[section]` and pass an empty candidate set for that section to the LLM.
      4. **M1 redaction (BEFORE prompt assembly):** `const redacted = redactEmailsInBriefingInput({calendar, email, news})`. Assert in debug mode: `assert(!EMAIL_TOKEN_REGEX.test(JSON.stringify(redacted)))`.
      5. Build prompt via `buildBriefingPrompt(persona, last7dTopics, redacted)`. The prompt input MUST contain no `\S+@\S+\.\S+` match (testable invariant).
      6. `decision = await router.classify({ prompt, source: 'generic' })` (Phase 1 router — should return FRONTIER if a key is configured, else LOCAL with reason `frontier-not-configured`). Because emails are redacted, the classifier will NOT flag PII; routing to FRONTIER is preserved per CONTEXT cost expectation (~$0.10/day).
      7. `model = decision.route === 'FRONTIER' ? getFrontierModel(decision.provider) : getLocalModel()`.
      8. `const start = performance.now(); const { object } = await generateObject({ model, schema: BriefingSchema, prompt }); const latency_ms = Math.round(performance.now() - start)`.
      9. On `generateObject` throw → write routing_log row with `ok=0, reason='generateObject-failed:<class>'` and return a degraded payload (each section's items = raw candidates capped at 3 with `why = '(rationale unavailable)'`). BRIEF-06 + Pitfall 15.
      10. `writeRoutingLog(db, { ts, route, reason, source: 'generic', prompt_hash: hashPrompt(prompt), model, latency_ms, ok: 1 })`.
      11. `upsertBriefing(db, { date, generatedAt: now, tz: userTz, sections: JSON.stringify({calendar, email, news, errors, emailEmptyStateReason}), route, model, latency_ms, ok: 1 })`.
      12. Return the `BriefingPayload`.
    - `schedule.ts`:
      - `scheduleBriefing(expr, tz, run)`:
        1. Stops any prior task in `cronRegistry.get('briefing')`.
        2. Creates cron task per RESEARCH pattern (with `lastFiredDate` guard, IANA tz).
        3. Stores in `cronRegistry.set('briefing', task)`.
        4. Registers callbacks via `powerMonitor.registerLifecycleCallbacks({ onSuspend: () => task.stop(), onResume: () => task.start() })` — NO back-fire on resume.
      - `stopBriefingSchedule()` cleans up registered callbacks.
      - **L2 invariant:** after `scheduleBriefing` returns, `scheduler.cronRegistry.size === 3` (gmail-sync from 02-01 + calendar-sync from 02-02 + briefing from this plan). A suspend→resume cycle leaves the size unchanged AND does not invoke `run` for the suspended interval (no back-fire).
  </behavior>
  <action>
    Create `src/main/briefing/generate.ts` exporting `runBriefing`, `BriefingSchema`, `buildBriefingPrompt`. Use the LLM stack EXACTLY as Plan 01-04's `src/main/ipc/ask.ts` — same router class, same providers factory, same routingLog write. Difference: `generateObject` instead of `generateText` (Phase 2 smoke-tests Assumption A1 for local-model structured output — if `generateObject` against local Ollama fails non-recoverably, log `reason: 'generateObject-failed:local-structured-output-unsupported'` and degrade to no-rationale; do NOT throw to caller).

    Create `src/main/briefing/schedule.ts` exporting `scheduleBriefing` and `stopBriefingSchedule`. `lastFiredDate` is module-scoped.

    Create `tests/unit/main/briefing/generate.spec.ts` (no real network, no real LLM). Cases:
    1. **Happy path (FRONTIER mocked active)** — `vi.mock('ai')` so `generateObject` returns a valid `BriefingSchema` payload; `runBriefing()` returns the payload, writes 1 briefing row, writes 1 routing_log row with `route='FRONTIER'`, `reason='generic-source-frontier-active'`, `ok=1`.
    2. **News source fails (BRIEF-06 + Pitfall 15)** — `gatherNews` rejects; cal+email succeed; `errors.news` set; LLM call still happens with empty news candidates; payload `news:[]` + `errors.news` populated.
    3. **All sources fail** — Promise.allSettled returns 3 rejections; LLM call SKIPPED (no candidates); `briefing.ok=0`; routing_log row has `reason='no-candidates'`, `ok=0`.
    4. **generateObject throws** — mocked `generateObject` rejects; returns degraded payload with `why='(rationale unavailable)'`; routing_log has `reason='generateObject-failed:...'`, `ok=0`; briefing row STILL upserted.
    5. **No frontier configured** — `router.classify` returns `{route:'LOCAL', reason:'frontier-not-configured'}`; mocked `generateObject` returns valid schema → briefing persisted with `route='LOCAL'`, `reason='frontier-not-configured'`.
    6. **M1 PII redaction in prompt** — seed candidates containing `from_addr='Adex <adex@example.com>'`; assert the captured prompt passed to `generateObject` contains NO match for `/\S+@\S+\.\S+/`; assert routing decision is `route='FRONTIER'` (NOT downgraded to LOCAL because the classifier sees no PII post-redaction); assert `from_addr` in the persisted briefing.sections.email[].title shows `<EMAIL>` token, not the raw address.
    7. **Top-3 cap enforced** — gatherers return 10 candidates each; mocked `generateObject` returns 3 of each; persisted sections each have exactly 3 entries.
    8. **Dismissed news filtered from candidates** — seed `briefing_item_dismissed` with one url_hash for today's date; `gatherNews` candidate pool excludes that url_hash (asserted via spy on prompt builder input).
    9. **Idempotency** — call `runBriefing` twice for same date → exactly 1 briefing row, 2 routing_log rows.
    10. **B4 SC2 fallback** — seed `gmail_message` with 3 rows where `is_unread=1, is_important=0, received_at >= now-24h` (unread but NOT IMPORTANT); `gatherEmail` returns []; `runBriefing` payload has `emailEmptyStateReason === 'no-important-label'`; the email section in the persisted briefing.sections is `[]` (NOT degraded mode — empty by design).
    11. **B4 NOT triggered when no unread mail at all** — `gmail_message` has 0 unread rows in last 24h → `emailEmptyStateReason === undefined` (the empty state means "nothing to surface", not "Phase 2 limitation").

    Create `tests/unit/main/briefing/schedule.spec.ts` using `vi.useFakeTimers()` + mocked `node-cron` + mocked `electron.powerMonitor`:
    1. **Cron fires at configured time** — `scheduleBriefing('0 7 * * *', 'America/New_York', run)`; invoking the mock cron task asserts `run('2026-05-20')` called once for the user's local date.
    2. **lastFiredDate guard** — invoking the cron task twice same day → `run` called exactly once (XCUT-01 dedup).
    3. **Suspend stops the cron** — register, fire `powerMonitor` suspend → `task.stop()` called.
    4. **Resume restarts the cron WITHOUT back-firing** — suspend, advance 24h, resume → `task.start()` called; `run` NOT invoked from resume handler.
    5. **TZ correctness** — `scheduleBriefing('0 7 * * *', 'Africa/Lagos', run)`; advance to 06:59 UTC where Lagos is UTC+1 (07:59 Lagos) → asserts `today` computed in Lagos TZ.
    6. **stopBriefingSchedule** — after stop, registered powerMonitor callbacks are unregistered (no leak).
    7. **L2 cronRegistry size** — pre-seed `scheduler.cronRegistry` with `gmail-sync` and `calendar-sync` placeholder tasks; call `scheduleBriefing(...)` → `scheduler.cronRegistry.size === 3`. Fire suspend → still size 3 (only `.stop()` called, not deletion). Fire resume → still size 3. `run` NOT invoked during the suspend→resume cycle.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/main/briefing/generate.spec.ts tests/unit/main/briefing/schedule.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - All generate.spec.ts (11) + schedule.spec.ts (7) cases pass.
    - `grep -c "generateObject" src/main/briefing/generate.ts` returns ≥ 1.
    - `grep -c "BriefingSchema" src/main/briefing/generate.ts` returns ≥ 1.
    - `grep -c "Promise.allSettled" src/main/briefing/generate.ts` returns ≥ 1.
    - `grep -c "redactEmailsInBriefingInput" src/main/briefing/generate.ts` returns ≥ 1 (M1).
    - `grep -c "no-important-label" src/main/briefing/generate.ts` returns ≥ 1 (B4).
    - `grep -c "writeRoutingLog" src/main/briefing/generate.ts` returns ≥ 2 (success + ok=0 failure paths).
    - `grep -c "hashPrompt" src/main/briefing/generate.ts` returns ≥ 1.
    - `grep -c "router.classify" src/main/briefing/generate.ts` returns ≥ 1.
    - `grep -c "lastFiredDate" src/main/briefing/schedule.ts` returns ≥ 1.
    - `grep -c "registerLifecycleCallbacks" src/main/briefing/schedule.ts` returns ≥ 1.
    - `grep -c "timezone:" src/main/briefing/schedule.ts` returns ≥ 1.
    - `grep -cE "logger\\.(info|debug).*prompt\\b" src/main/briefing/generate.ts` returns 0 (never log raw prompt).
  </acceptance_criteria>
  <done>Briefing engine reads candidates resiliently, redacts emails BEFORE prompt assembly (M1 — preserves FRONTIER routing per CONTEXT cost expectation), calls Phase 1's router → generateObject(BriefingSchema) once per briefing, surfaces the B4 SC2 fallback flag when applicable, writes one routing_log + one briefing row idempotently, scheduler honors lastFiredDate + L2 cronRegistry size invariant + no-back-fire-on-resume.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Briefing IPC handlers (10th) + BriefingScreen UI with SC2 fallback (B4) + BriefingSettingsSection + Playwright e2e</name>
  <files>src/main/ipc/briefing.ts, src/main/ipc/index.ts, src/renderer/features/briefing/BriefingScreen.tsx, src/renderer/features/briefing/SectionCalendar.tsx, src/renderer/features/briefing/SectionEmail.tsx, src/renderer/features/briefing/SectionNews.tsx, src/renderer/features/briefing/GenerateNowAffordance.tsx, src/renderer/features/settings/BriefingSettingsSection.tsx, src/renderer/features/settings/SettingsScreen.tsx, src/renderer/app/router.tsx, tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx, tests/unit/renderer/features/settings/BriefingSettingsSection.spec.tsx, tests/e2e/briefing.spec.ts</files>
  <read_first>
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md "Briefing layout & content density" + Resolutions §"Briefing missed-on-sleep policy"
    - src/renderer/app/router.tsx (Phase 1 side-nav + routes — add `/briefing` route as default landing)
    - src/main/ipc/index.ts (after Plan 02-03, count is 9; this plan adds the 10th = registerBriefingHandlers)
    - Plan 01-04 SUMMARY (Diagnostics composite pattern)
  </read_first>
  <behavior>
    - `registerBriefingHandlers(ipcMain, deps)` registers 6 briefing.* channels:
      - `BRIEFING_TODAY({ date? })`: computes `date` from userTz if absent; reads `briefing` row; returns `BriefingPayload` (null if absent → renderer shows GenerateNowAffordance).
      - `BRIEFING_GENERATE_NOW()`: invokes `runBriefing(...)` for today.
      - `BRIEFING_DISMISS_NEWS_ITEM({ date, urlHash })`: writes dismissed row.
      - `BRIEFING_HISTORY({ limit })`: SELECT last N briefing rows.
      - `BRIEFING_GET_SETTINGS()` / `BRIEFING_SET_SETTINGS({ time, tz })`: reads/writes `settings` table keys `briefing.time` (HH:00 whole-hour validated server-side) and `briefing.tz`. On set, re-invokes `scheduleBriefing(`0 ${HH} * * *`, tz, run)` — this re-registration is what the BriefingSettingsSection spec asserts (M3).
    - On app startup AFTER Plans 02-01/02-02 cron registration: read briefing settings (default `{time:'07:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone}`), call `scheduleBriefing(...)`.
    - BriefingScreen layout:
      - H1 "Today's Briefing — <weekday>, <date>"
      - If no briefing for today → `<GenerateNowAffordance>` ("No briefing yet for today — generate now?" + "Generate" button).
      - Three sections: SectionCalendar / SectionEmail / SectionNews.
      - Each section: H2, items as rows = title + 1-line rationale + back-link.
      - News items have a per-day "Dismiss" button.
      - **B4 SC2 fallback in SectionEmail:** if `payload.emailEmptyStateReason === 'no-important-label'`, render the EXACT copy: "No mail flagged Important by Gmail. Phase 3 adds Aria's own priority classifier." (NOT the generic "No items today." placeholder, NOT a yellow error banner — it's a documented limitation, not an error).
      - If `errors[section]` is set → yellow inline warning bar at top of that section.
      - Empty section (no candidates AND no error AND no SC2 fallback): "No items today." placeholder.
    - Side-nav (`src/renderer/app/router.tsx`): add `/briefing` route; `/` redirects to `/briefing` post-onboarding.
    - BriefingSettingsSection: time picker (whole-hour `<select>` 00:00–23:00), tz dropdown, "Generate now" button, "Last briefing: <date>" status. Mount in `SettingsScreen.tsx` under `data-testid="settings-briefing"`.
  </behavior>
  <action>
    Create `src/main/ipc/briefing.ts` exporting `registerBriefingHandlers(ipcMain, deps)`. Deps: `{logger, dbHolder, scheduler, router, calendarClientFactory, userTzFn}`. On `registerBriefingHandlers` call, ALSO invoke `scheduleBriefing(...)` with current settings.

    Update `src/main/ipc/index.ts` `registerHandlers` to append `registerBriefingHandlers` as the 10th call.

    Create the renderer components per behavior block. `SectionEmail.tsx` MUST branch on `payload.emailEmptyStateReason === 'no-important-label'` and render the exact B4 copy.

    Update `src/renderer/app/router.tsx` to add `/briefing` route + `/` → `/briefing` redirect for onboarded users.

    Update `src/renderer/features/settings/SettingsScreen.tsx` to mount `<BriefingSettingsSection />`. Time picker is `<select>` with 24 whole-hour options.

    Create `tests/unit/renderer/features/briefing/BriefingScreen.spec.tsx`. Cases:
    1. **No briefing for today** → renders `<GenerateNowAffordance>` with "Generate" button.
    2. **Briefing exists, all sections populated** → 3 sections, 3 items each, rationales visible.
    3. **Top-3 cap visible** — backend returns 5 items in calendar, renderer slices to 3.
    4. **News dismiss** — clicking "Dismiss" calls `briefingDismissNewsItem({date, urlHash})` + item disappears within one tick.
    5. **Per-section error (BRIEF-06)** — `errors.email = 'Gmail unreachable'` → yellow warning in SectionEmail; cal+news unaffected.
    6. **All-day calendar event (XCUT-07)** — item with `allDay: true` renders "All day" tag.
    7. **Route badge visible** — route='FRONTIER' renders `[FRONTIER]` badge; route='LOCAL' renders `[LOCAL]`.
    8. **B4 SC2 fallback (no-important-label)** — payload has `emailEmptyStateReason: 'no-important-label'`, `email: []`, no `errors.email`. SectionEmail renders EXACT copy "No mail flagged Important by Gmail. Phase 3 adds Aria's own priority classifier." — does NOT render the yellow error bar (it's not an error) AND does NOT render the generic "No items today." placeholder.
    9. **Empty SectionEmail when nothing unread** — payload has `email: []`, no `emailEmptyStateReason`, no `errors.email`. SectionEmail renders "No items today." (the generic empty state).

    **Create `tests/unit/renderer/features/settings/BriefingSettingsSection.spec.tsx` (M3):**
    1. Renders 24 whole-hour `<option>` elements (00:00–23:00).
    2. Renders a tz dropdown defaulted to `Intl.DateTimeFormat().resolvedOptions().timeZone`.
    3. Changing the time `<select>` from '07:00' to '06:00' fires `briefingSetSettings({time:'06:00', tz})` exactly once.
    4. After successful response, the section displays "Last briefing: <date>" if a row exists.
    5. **M3 reinstantiation assertion** — when `BRIEFING_SET_SETTINGS` returns ok, the spec asserts that the underlying handler (mocked) was called AND that the e2e flow (Test 7 in briefing.spec.ts) covers `scheduler.scheduleBriefing` reinstantiation. This unit spec covers the renderer dispatch; the actual reinstantiation is exercised in the e2e (cross-reference noted in the test description).

    Create `tests/e2e/briefing.spec.ts` with seeded fixture. Test flow:
    1. Launch Electron with seeded userData (onboarded; gmail_account + 3 unread+important `gmail_message`; calendar_account + 3 today events; news_source HN row; mocked fetch for HN + mocked `ai.generateObject`).
    2. Verify default landing route is `/briefing`.
    3. BriefingScreen renders `<GenerateNowAffordance>` (no row yet).
    4. Click "Generate". Wait for sectioned doc.
    5. Assert: 3 calendar items, 3 email items, 3 news items; each with non-empty `[data-testid="rationale"]` ≤140 chars; route badge `LOCAL` (since seeded userData has no frontier key); reason `frontier-not-configured`.
    6. Click "Dismiss" on first news item; assert it disappears within 1s; assert `briefing_item_dismissed` has 1 row (via test-only IPC).
    7. Navigate to Settings → Briefing; change time from '07:00' to '06:00'; assert `settings.briefing.time === '06:00'` AND assert (via spy on test-only IPC) that `scheduler.cronRegistry.get('briefing')` was replaced (i.e. `scheduleBriefing` was re-invoked — M3 reinstantiation).
    8. Visit Settings → Diagnostics → routing-log panel; assert a new row exists with `source='generic'`, `route='LOCAL'`, `reason='frontier-not-configured'`, `ok=1`.
    9. **M1 PII check in routing_log**: assert the `prompt_hash` was computed over a prompt that does NOT contain raw emails. (Cannot inspect prompt directly, but can verify: seed an `is_important=1` message with `from_addr='evil@hacker.com'`; after Generate, query routing_log; the hash differs from the hash of an unredacted prompt — this is implicitly covered by Task 2 case 6 at the unit level. E2E version: assert no log file in `<userData>/logs/aria.log` contains `evil@hacker.com` after the briefing run.)
    10. Phase-1 e2e regression: `hello-aria.spec.ts` still passes (run as part of `npm run test:e2e`).
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/renderer/features/briefing tests/unit/renderer/features/settings/BriefingSettingsSection.spec.tsx tests/unit/main/briefing && npm run build && npm run test:e2e -- tests/e2e/briefing.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - All BriefingScreen.spec.tsx (9) + BriefingSettingsSection.spec.tsx (5) cases pass.
    - `tests/e2e/briefing.spec.ts` passes (or cleanly skips ONLY if SQLCipher native rebuild blocks — document in SUMMARY).
    - `grep -c "registerBriefingHandlers" src/main/ipc/index.ts` returns ≥ 1.
    - **B1 grep gate (final):** `grep -cE '^\s*register[A-Za-z]+Handlers\(ipcMain' src/main/ipc/index.ts` returns 10 (Phase 1 baseline 6 + Gmail (02-01) + Calendar (02-02) + News (02-03) + Briefing (02-04)).
    - `grep -c "GenerateNowAffordance" src/renderer/features/briefing/BriefingScreen.tsx` returns ≥ 1.
    - `grep -c "No briefing yet for today" src/renderer/features/briefing/GenerateNowAffordance.tsx` returns ≥ 1.
    - **B4 copy locked:** `grep -c "No mail flagged Important by Gmail. Phase 3 adds Aria's own priority classifier." src/renderer/features/briefing/SectionEmail.tsx` returns ≥ 1.
    - `grep -c "Dismiss" src/renderer/features/briefing/SectionNews.tsx` returns ≥ 1.
    - `grep -c "redirect" src/renderer/app/router.tsx` returns ≥ 1 (`/` → `/briefing`).
    - `grep -c "data-testid=\"settings-briefing\"" src/renderer/features/settings/SettingsScreen.tsx` returns ≥ 1.
    - `grep -cE "<option [^>]*value=\"0[0-9]:00\"" src/renderer/features/settings/BriefingSettingsSection.tsx` returns ≥ 10 (whole-hour dropdown).
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>End-to-end Phase 2 MVP is live: user lands on `/briefing`, sees sectioned doc or GenerateNowAffordance, sees the B4 SC2 fallback copy when account has unread mail but none IMPORTANT, can dismiss news per-day, can reconfigure daily time with M3-asserted scheduler reinstantiation, and Playwright e2e proves the whole walking skeleton including the M1 PII-redaction invariant.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Main → Frontier API (briefing LLM call) | TLS; key in safeStorage; **M1: raw email addresses redacted to `<EMAIL>` BEFORE prompt assembly so the prompt contains no PII pattern; routes FRONTIER per CONTEXT cost expectation** |
| Main → SQLCipher briefing | Whole-DB AES; raw prompt NEVER persisted (only `prompt_hash` in routing_log) |
| Renderer ↔ Main briefing handlers | Only structured `BriefingPayload` crosses; no raw LLM prompt; no OAuth tokens; URL strings sanitized for href |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-04-01 | Information Disclosure | Sender email addresses sent to FRONTIER LLM | mitigate (HIGH; M1) | `redactEmailsInBriefingInput` strips all `\S+@\S+\.\S+` matches BEFORE prompt assembly; display names preserved; redact.spec case 7 + generate.spec case 6 enforce the regex-zero invariant |
| T-02-04-02 | Information Disclosure | Raw briefing prompt persisted | mitigate (HIGH) | Only `prompt_hash` in routing_log; briefing.sections stores model output |
| T-02-04-03 | Tampering | Malicious RSS URL rendered as executable href | mitigate (HIGH) | Renderer guard: `<a target="_blank" rel="noopener noreferrer">` + href must match `http(s):` scheme |
| T-02-04-04 | Denial of Service | Slow source blocks briefing | mitigate (HIGH; BRIEF-06) | 10s per-feed timeout + Promise.allSettled |
| T-02-04-05 | Denial of Service | Cron storm on resume (XCUT-01) | mitigate (HIGH) | lastFiredDate guard + powerMonitor.registerLifecycleCallbacks without back-fire; schedule.spec case 4 + 7 (L2) enforce |
| T-02-04-06 | Repudiation | Briefing decision not auditable | mitigate (HIGH) | One routing_log row per briefing call with verbatim reason string |
| T-02-04-07 | Tampering | generateObject returns >3 items | mitigate (LOW) | Zod `.max(3)` rejects; renderer slices to 3 (BriefingScreen spec case 3) |
| T-02-04-08 | Information Disclosure | Local LLM (Ollama) sees email subjects → leaves machine? | accept (NONE) | Ollama runs on localhost only; classifier-redacted prompt also protects against accidental egress |
| T-02-04-09 | Tampering | Cron fires twice in one day after clock jump | mitigate (HIGH; XCUT-01) | lastFiredDate guard |
| T-02-04-10 | Spoofing | User dismisses news permanently → confused next day | mitigate (LOW) | Dismissals per-day; persist.spec case 3 enforces |
</threat_model>

<verification>
- All `<automated>` commands pass on Windows 11 with Electron 41.6.1 + patched SQLCipher
- Playwright e2e passes end-to-end (or skips with documented reason)
- Phase-1 e2e + Plans 02-01/02-02/02-03 unit tests all pass
- Manual: with Gmail + Calendar connected + NG bundle picked, at configured local time the briefing fires; BriefingScreen shows 3+3+3 with rationales ≤140 chars; routing_log shows new row with `source='generic'`
- Manual: kill internet → click "Generate now" → calendar (cached) + email (cached) succeed; news fails → 2 normal sections + yellow warning in News
- Manual: user with unread mail but no IMPORTANT labels → SectionEmail shows the exact B4 copy
- Manual: suspend laptop overnight, resume at 09:00 → no auto-fire; GenerateNowAffordance shows; click "Generate" → briefing appears
- Manual: change briefing time 07:00→06:00 → next-day cron fires at 06:00 AND scheduler.cronRegistry.size remains 3 (L2)
</verification>

<success_criteria>
Plan 02-04 closes BRIEF-01, BRIEF-03 briefing-engine half, BRIEF-06, and XCUT-01. Combined with 02-01, 02-02, 02-03 — all 5 Phase 2 ROADMAP success criteria are satisfied:
1. SC1 — new mail within 5 min — Plan 02-01 mechanic + Plan 02-04 BriefingScreen surface
2. SC2 — 7am briefing covers cal + email + news with rationale — Plan 02-04 (with B4 fallback for accounts without IMPORTANT labels)
3. SC3 — expired-token banner; other features unaffected — Plan 02-01 + 02-02
4. SC4 — sleep/wake → no cron storm — Plan 02-04 (lastFiredDate + L2 cronRegistry-size invariant + powerMonitor coalescing)
5. SC5 — news guardrails: bounded sources, no auto-action, dismissible — Plan 02-03 (bounded) + Plan 02-04 (dismissible, no auto-action)
</success_criteria>

<out_of_scope>
- BRIEF-02 (top 3-5 priorities with full prose) — Phase 8
- BRIEF-04 (richer news topic configuration UI) — Phase 8
- BRIEF-05 (feedback "more like / skip") — Phase 8
- **Aria's own email priority classifier — Phase 3 (Plan 3-3). The B4 SC2 fallback (`emailEmptyStateReason='no-important-label'`) is the Phase-2 placeholder for accounts whose Gmail does not auto-flag IMPORTANT.**
- INSIGHT-01..03 — Phase 8
- Calendar write (Phase 4)
- Outlook (Phase 5)
- Weekly recap (Phase 8)
- More country bundles beyond NG (Phase 8 / v1.x)
- 30-day Gmail backfill (Phase 7 RAG)
</out_of_scope>

<handoff>
Phase 3 (Approval Queue + Sensitivity Router + Email Triage/Drafting/Send) inherits all four Gmail/Calendar IPC handlers and the briefing engine. Phase 3 will:
- Upgrade the priority-email heuristic (currently `is_unread AND is_important AND ≤24h`) with a real local-LLM classifier via `generateObject` (Plan 3-3 sensitivity router). When this lands, the B4 SC2 fallback message disappears — Aria classifies independently of Gmail's IMPORTANT flag.
- Add `gmail.send` scope (CASA Tier 2 already in flight) + approval queue.
- Replace the briefing's "Priority Email" why-strings with classifier-derived rationales.
Phase 4 (Calendar Smart-Scheduling) reuses `connectGoogle('calendar')` + OAuth tokens, upgrading scope to write.
</handoff>

<output>
After completion, create `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-04-SUMMARY.md` describing:
- Confirmation `generateObject` works against the user's configured frontier (or local Ollama) — Assumption A1
- Sample briefing row from a real dogfood run (sections JSON with `<EMAIL>` tokens visible in email[].title — proves M1 redaction in production)
- Sample routing_log row (route, reason, model, latency_ms) — confirms FRONTIER routing preserved post-M1
- Manual verification of B4 SC2 fallback rendering on an account without IMPORTANT-flagged mail
- Confirmation L2 cronRegistry size remains 3 across one observed suspend/resume cycle
- Confirmation all five Phase 2 ROADMAP success criteria are demonstrably met (table)
- Confirmation 10 handler-registration functions are wired in `src/main/ipc/index.ts`
- E2E status (passed / skipped — and why if skipped)
- Open issues to forward to Phase 3 / Phase 4
</output>
</content>
</invoke>
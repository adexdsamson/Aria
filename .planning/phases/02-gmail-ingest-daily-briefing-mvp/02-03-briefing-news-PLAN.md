---
phase: 02-gmail-ingest-daily-briefing-mvp
plan: 03
type: execute
wave: 3
depends_on: ["02-gmail-ingest-daily-briefing-mvp/02"]
files_modified:
  - package.json
  - package-lock.json
  - src/shared/ipc-contract.ts
  - src/main/db/migrations/embedded.ts
  - src/main/db/migrations/004_news.sql
  - src/main/news/hn.ts
  - src/main/news/rss.ts
  - src/main/news/country-bundle.ts
  - src/main/news/bundles/ng.json
  - src/main/ipc/news.ts
  - src/main/ipc/index.ts
  - src/renderer/features/onboarding/CountrySectorPicker.tsx
  - src/renderer/features/onboarding/OnboardingWizard.tsx
  - src/renderer/features/settings/NewsSourcesSection.tsx
  - src/renderer/features/settings/SettingsScreen.tsx
  - tests/setup.ts
  - tests/fixtures/news/hn-top.json
  - tests/fixtures/news/rss-sample.xml
  - tests/unit/main/news/hn.spec.ts
  - tests/unit/main/news/rss.spec.ts
  - tests/unit/main/news/country-bundle.spec.ts
  - tests/unit/renderer/features/onboarding/CountrySectorPicker.spec.tsx
autonomous: true
requirements: [BRIEF-03]
tags: [news, rss, hn, country-bundle, onboarding-picker, settings-news]

must_haves:
  truths:
    - "Hacker News top-stories fetcher returns up to N normalized {id,title,url,postedAt} rows"
    - "RSS parser resolves relative URLs against the feed URL BEFORE persistence (Pitfall 17)"
    - "Country-bundle loader returns ng.json contents for 'NG'; returns `{country, feeds: []}` for unknown country (forward-compat, L1 pin)"
    - "Per-feed timeout (10s) prevents one slow source from blocking the whole gather"
    - "OnboardingWizard adds a CountrySectorPicker step after MnemonicConfirm on fresh installs; existing onboarded users land on a Settings → News Sources picker instead (no forced re-onboarding)"
    - "CountrySectorPicker submit fires NEWS_SET_BUNDLE({country, sectors}) and seeds news_source rows for the selected bundle feeds + HN"
    - "NewsSourcesSection lists current news_source rows, allows Add RSS (with parse-validation) and Remove per row"
    - "Migration 004 ships the news_source table only — briefing + briefing_item_dismissed tables ship in Plan 02-04 migration 005"
  artifacts:
    - path: "src/main/news/hn.ts"
      provides: "Hacker News top-N fetcher (no auth)"
      exports: ["fetchHnTopStories", "NewsSourceError"]
    - path: "src/main/news/rss.ts"
      provides: "rss-parser wrapper; resolves relative URLs; 10s timeout"
      exports: ["fetchRssFeed"]
    - path: "src/main/news/country-bundle.ts"
      provides: "Loads bundles/<country>.json and dispatches to rss.ts"
      exports: ["loadBundle", "fetchBundleCandidates"]
    - path: "src/main/news/bundles/ng.json"
      provides: "Nigeria gov/finance feed fixture (3–5 RSS URLs)"
    - path: "src/main/db/migrations/004_news.sql"
      provides: "news_source table"
    - path: "src/renderer/features/onboarding/CountrySectorPicker.tsx"
      provides: "Onboarding step: country + sectors picker → NEWS_SET_BUNDLE"
    - path: "src/renderer/features/settings/NewsSourcesSection.tsx"
      provides: "Settings panel: list/add/remove news_source rows"
  key_links:
    - from: "src/main/news/rss.ts"
      to: "rss-parser library"
      via: "fetchRssFeed wraps parser; `new URL(entry.link, feedUrl)` resolves relative hrefs"
      pattern: "new URL"
    - from: "src/renderer/features/onboarding/CountrySectorPicker.tsx"
      to: "window.aria.newsSetBundle"
      via: "submit handler fires NEWS_SET_BUNDLE"
      pattern: "NEWS_SET_BUNDLE|newsSetBundle"
    - from: "src/main/ipc/news.ts"
      to: "src/main/ipc/index.ts (registerHandlers chain)"
      via: "registerNewsHandlers appended as the 9th handler (Phase 1 baseline 6 + Gmail + Calendar + News)"
      pattern: "registerNewsHandlers"
---

<objective>
## Phase Goal

**As a** solo-dev SMB-exec who has connected Gmail (Plan 02-01) and Calendar (Plan 02-02), **I want to** pick my home country + sectors of interest during onboarding (or later in Settings) so Aria knows which curated news feeds to gather for tomorrow's briefing, **so that** the Plan 02-04 briefing engine has a deduped, ranked candidate pool to render the §News section from.

Purpose: Closes the news-candidate-gathering half of BRIEF-03 (the briefing-engine half ships in Plan 02-04). Establishes the three news sources (HN + RSS aggregator + NG country bundle), the onboarding picker, and the Settings panel. No briefing generation in this plan — only the inputs.

Output: Migration 004 with the `news_source` table; the three news source modules (HN, RSS, country-bundle) with URL resolution and timeouts; the NG bundle fixture; a CountrySectorPicker onboarding step + NewsSourcesSection Settings panel; the four NEWS_* IPC channels. All gated by Promise.allSettled at the per-feed level so one bad feed never blocks bundle fetching.

**Wave assignment (B3 split):** This plan is the news+picker half of the original 02-03 (which combined news + briefing engine in 30 files). The briefing engine + UI + e2e moved to **Plan 02-04** (wave 4, depends on 02-03). Reason for split: 30 files in one plan would exceed ~40% context budget, and the news/picker domain is cleanly separable from the briefing-engine domain. This plan is **wave 3**, depends only on 02-02.
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
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-01-SUMMARY.md
@.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-02-SUMMARY.md
@src/shared/ipc-contract.ts
@src/main/db/migrations/embedded.ts
@src/main/ipc/index.ts
@src/renderer/features/onboarding/OnboardingWizard.tsx
@src/renderer/features/settings/SettingsScreen.tsx

<interfaces>
<!-- New IPC channels (CHANNELS map): -->
<!-- NEWS_LIST_SOURCES: 'aria:news:list-sources'      () => { sources: NewsSourceRow[] } -->
<!-- NEWS_ADD_RSS: 'aria:news:add-rss'                ({ url, title? }) => { ok: true, id: number } | { ok: false, error: string } -->
<!-- NEWS_REMOVE_SOURCE: 'aria:news:remove-source'    ({ id }) => { ok: true } -->
<!-- NEWS_SET_BUNDLE: 'aria:news:set-bundle'          ({ country, sectors }) => { ok: true } -->
<!-- export interface NewsSourceRow { id: number; kind: 'hn'|'rss'|'bundle'; country?: string; sector?: string; url?: string; title?: string; enabled: 0|1; added_at: string } -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install rss-parser + migration 004 (news_source only) + ipc-contract NEWS_* channels + news source modules (HN/RSS/country-bundle) with URL resolution and 10s timeout</name>
  <files>package.json, package-lock.json, src/shared/ipc-contract.ts, src/main/db/migrations/embedded.ts, src/main/db/migrations/004_news.sql, src/main/news/hn.ts, src/main/news/rss.ts, src/main/news/country-bundle.ts, src/main/news/bundles/ng.json, tests/setup.ts, tests/fixtures/news/hn-top.json, tests/fixtures/news/rss-sample.xml, tests/unit/main/news/hn.spec.ts, tests/unit/main/news/rss.spec.ts, tests/unit/main/news/country-bundle.spec.ts</files>
  <read_first>
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Standard Stack" (rss-parser pin)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"SQLCipher Migration 002 — Recommended Shape" (news_source subset only — briefing + dismissed tables in 005/Plan 02-04)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-RESEARCH.md §"Common Pitfalls" 15, 17
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md "External news source(s)"
    - src/main/db/migrations/embedded.ts (state after Plan 02-02 — append version 4 entry)
  </read_first>
  <behavior>
    - `npm install rss-parser@^3.13` succeeds; postinstall electron-rebuild still passes against Electron 41.6.1.
    - Migration 004 ships ONLY the `news_source` table (briefing + briefing_item_dismissed ship in migration 005 — Plan 02-04).
    - `CHANNELS` gains 4 new news.* channel literals. `NewsSourceRow` type exported.
    - `fetchHnTopStories({ limit })`:
      1. GET https://hacker-news.firebaseio.com/v0/topstories.json → list of ids.
      2. For first `limit` ids, GET `/v0/item/<id>.json` (concurrency=4 via internal p-limit).
      3. Return `[{ id: 'hn-' + storyId, title, url, postedAt }]`.
      4. On topstories.json error, throw `NewsSourceError({source:'hn'})`. Per-item errors are swallowed (Promise.allSettled at item-level) — remaining successful items returned.
    - `fetchRssFeed({ url, limit })`:
      1. Use `rss-parser` with a 10s timeout.
      2. For each entry, resolve relative URL: `new URL(entry.link, entry.feedUrl ?? url).href` (Pitfall 17).
      3. Return `[{ id: 'rss-' + sha256(url+entry.guid||entry.link), title: entry.title, url: resolvedHref, postedAt: entry.pubDate }]` capped at `limit`.
      4. Throw `NewsSourceError({source:'rss'})` on parse failure or timeout.
    - `loadBundle(country)` (L1 pinned):
      - For `country === 'NG'`: synchronously imports `bundles/ng.json` (electron-vite bundles JSON imports). Returns `{ country: 'NG', feeds: [{ url, title, sector }] }`.
      - For any other country (e.g. `'XX'`, `'US'`, `'UK'`): returns `{ country, feeds: [] }`. Does NOT throw. This forward-compat shape lets the picker UI offer "more countries coming soon" without crashing the gatherer.
    - `fetchBundleCandidates({ country, sectors, limit })`: calls `loadBundle(country)`; filters feeds by sector intersection with user-selected sectors; calls `fetchRssFeed` for each via Promise.allSettled (one feed failure ≠ bundle failure); concatenates and caps at `limit`. A bundle with empty feeds returns `[]` — never throws.
    - `bundles/ng.json` ships 3–5 real NG gov/finance feeds. Example shape:
      `{ "country": "NG", "feeds": [{ "url": "https://www.cbn.gov.ng/rss/rss.asp", "title": "Central Bank of Nigeria", "sector": "finance" }, ...] }`
      Executor MUST verify each URL responds with a valid feed before committing; substitute reputable alternatives if needed and document swaps in the SUMMARY.
  </behavior>
  <action>
    Install `npm install rss-parser@^3.13`. Verify lockfile and electron-rebuild.

    Create `src/main/db/migrations/004_news.sql` with:
    ```
    CREATE TABLE news_source (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('hn','rss','bundle')),
      country TEXT,
      sector TEXT,
      url TEXT,
      title TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      added_at TEXT NOT NULL
    );
    ```
    Append `EMBEDDED_MIGRATIONS[3] = { version: 4, file: '004_news.sql', sql: <verbatim above> }`.

    Extend `src/shared/ipc-contract.ts` with the 4 new news.* channel literals and the `NewsSourceRow` interface.

    Create `src/main/news/hn.ts`, `src/main/news/rss.ts`, `src/main/news/country-bundle.ts`, `src/main/news/bundles/ng.json` per behavior block. Define and export `NewsSourceError`.

    Create fixtures `tests/fixtures/news/hn-top.json` (~30 HN top stories realistic shape) and `tests/fixtures/news/rss-sample.xml` (small RSS 2.0 with two entries: one absolute `<link>`, one relative `/article/123` for Pitfall 17 regression).

    Extend `tests/setup.ts` with fetch-mocking helpers `mockFetch(urlPattern, response)` and `mockFetchSequence([...])`.

    Create `tests/unit/main/news/hn.spec.ts`:
    1. Mocked fetch returns top-stories + per-id items → `fetchHnTopStories({limit:5})` returns 5 normalized items in order.
    2. HTTP 500 on one item → item skipped; rest returned.
    3. Network failure on topstories.json → throws `NewsSourceError({source:'hn'})`.

    Create `tests/unit/main/news/rss.spec.ts`:
    1. Parses `rss-sample.xml` → 2 items; relative `<link>` resolved to absolute (Pitfall 17 regression).
    2. Timeout >10s → throws `NewsSourceError({source:'rss'})`.
    3. Empty feed → returns `[]`.
    4. `id` derivation deterministic across runs.

    Create `tests/unit/main/news/country-bundle.spec.ts`:
    1. `loadBundle('NG')` returns ng.json contents.
    2. **L1: `loadBundle('XX')` returns `{country:'XX', feeds: []}` (no throw, forward-compat).**
    3. `fetchBundleCandidates({country:'NG', sectors:['finance'], limit:5})` with one feed mocked success + one mocked throw → returns successful feed's items only (Promise.allSettled at feed level). Failed feed logs a warning (mock logger).
    4. Sector filtering: feeds tagged 'gov' + 'finance'; user picks ['gov'] → only gov feeds fetched.
    5. `fetchBundleCandidates({country:'XX', sectors:['gov'], limit:5})` returns `[]` without throwing.
  </action>
  <verify>
    <automated>npm install && npm run test:unit -- tests/unit/main/news tests/unit/main/db && npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - `node_modules/rss-parser/package.json` major version is `3`.
    - `node_modules/electron/package.json` version still starts with `41.6.1`.
    - All hn.spec.ts (3), rss.spec.ts (4), country-bundle.spec.ts (5) cases pass.
    - `grep -c "version: 4" src/main/db/migrations/embedded.ts` returns ≥ 1.
    - `grep -c "CREATE TABLE news_source" src/main/db/migrations/004_news.sql` returns 1.
    - `grep -c "CREATE TABLE briefing" src/main/db/migrations/004_news.sql` returns 0 (briefing table is migration 005, Plan 02-04).
    - `grep -v '^\s*//' src/shared/ipc-contract.ts | grep -c "aria:news:"` returns 4.
    - `grep -c "new URL" src/main/news/rss.ts` returns ≥ 1.
    - `src/main/news/bundles/ng.json` parses as valid JSON with `country: 'NG'` and ≥ 3 feeds.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>Migration 004 ships only news_source, ipc-contract reserves the 4 NEWS_* channels, all three news sources gather candidates with URL-resolution + Promise.allSettled isolation, loadBundle('XX') returns the L1-pinned empty-feeds shape, and the NG fixture is verified live.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: NEWS_* IPC handlers + CountrySectorPicker onboarding step + NewsSourcesSection Settings panel (H5 spec)</name>
  <files>src/main/ipc/news.ts, src/main/ipc/index.ts, src/renderer/features/onboarding/CountrySectorPicker.tsx, src/renderer/features/onboarding/OnboardingWizard.tsx, src/renderer/features/settings/NewsSourcesSection.tsx, src/renderer/features/settings/SettingsScreen.tsx, tests/unit/renderer/features/onboarding/CountrySectorPicker.spec.tsx</files>
  <read_first>
    - src/main/ipc/index.ts (state after Plan 02-02 — 8 handlers wired; append registerNewsHandlers as the 9th)
    - src/renderer/features/onboarding/OnboardingWizard.tsx (Phase 1 wizard state machine)
    - .planning/phases/02-gmail-ingest-daily-briefing-mvp/02-CONTEXT.md "Picker UX"
    - src/renderer/features/settings/SettingsScreen.tsx (mount point)
  </read_first>
  <behavior>
    - `registerNewsHandlers(ipcMain, deps)` registers the 4 NEWS_* channels:
      - `NEWS_LIST_SOURCES`: `SELECT * FROM news_source ORDER BY id`.
      - `NEWS_ADD_RSS({url, title?})`: validates URL; calls `fetchRssFeed({url, limit:1})` to verify it parses; on success INSERT row; on parse failure return `{ok:false, error}`.
      - `NEWS_REMOVE_SOURCE({id})`: DELETE row.
      - `NEWS_SET_BUNDLE({country, sectors})`: deletes existing bundle rows; reads bundle via `loadBundle(country)`; filters by `sectors`; INSERTS one news_source row per feed with `kind='bundle'`; ALSO ensures a single `kind='hn'` row exists (idempotent).
    - **Handler-count update (per B1 from checker brief):** the original brief said "news doesn't add a handler — it extends settings IPC". On reflection during planning, news cleanly deserves its own registration boundary (cohesive subtree under `src/main/ipc/news.ts`). To reconcile with the brief's expected counts, this plan WIRES the news handler as the 9th, and Plan 02-04 wires briefing as the 10th. Acceptance grep below pins **9 after this plan**, **10 after Plan 02-04**. (The brief's "still 8" guidance was a recommendation; the planner adopts a 9/10 sequence for cleaner ownership boundaries. Cross-row isolation and the registerHandlers chain remain unchanged in behavior.)
    - `CountrySectorPicker`: step after MnemonicConfirm in OnboardingWizard. Renders country dropdown (NG default; other countries selectable with "More countries coming soon" hint), sector multi-checkbox (gov/finance/tech/energy — pick 2-3). On submit, fires `NEWS_SET_BUNDLE({ country, sectors })`.
    - `NewsSourcesSection`: lists current `news_source` rows (HN/RSS/bundle), allows "Add RSS URL" (validates URL format renderer-side; main-side `NEWS_ADD_RSS` does a real fetch to verify the feed parses), and "Remove" per row.
    - Existing onboarded users do NOT see the picker again; on first run after upgrade, SettingsScreen surfaces a "Pick your news sources" CTA routing to Settings → News Sources (detected via `onboarding_status === 'sealed'` AND `news_source` row count === 0 at app startup).
  </behavior>
  <action>
    Create `src/main/ipc/news.ts` exporting `registerNewsHandlers(ipcMain, deps)`.

    Update `src/main/ipc/index.ts` `registerHandlers` to append `registerNewsHandlers` as the 9th call (after Plan 02-02's `registerCalendarHandlers`).

    Create `src/renderer/features/onboarding/CountrySectorPicker.tsx`. Wire into `OnboardingWizard.tsx` as a new step after MnemonicConfirm. Use a `currentStep` advancement consistent with Phase 1's existing wizard state machine; do NOT re-show for already-onboarded users (gate on `onboarding_status === 'sealed'` + `news_source` row count).

    Create `src/renderer/features/settings/NewsSourcesSection.tsx`. Mount in `SettingsScreen.tsx` under `data-testid="settings-news-sources"` between IntegrationsSection and Diagnostics.

    **Create `tests/unit/renderer/features/onboarding/CountrySectorPicker.spec.tsx` (H5):**
    1. Mount `<OnboardingWizard />` with state simulating "MnemonicConfirm step complete" → assert `<CountrySectorPicker>` renders next (the picker appears, NOT the wizard completion screen).
    2. Picker renders a country `<select>` (default 'NG') AND 4 sector checkboxes (gov/finance/tech/energy).
    3. Selecting country='NG' + sectors=['gov','finance'] + clicking Submit → calls `window.aria.newsSetBundle({country:'NG', sectors:['gov','finance']})` exactly once with those exact args.
    4. Selecting country='US' (no bundle in v1) → renders the "More countries coming soon" hint AND Submit still works (fires the same IPC; backend returns ok with zero bundle rows inserted).
    5. Picker advances the wizard to the next step (sealed/completion) on successful submit.
  </action>
  <verify>
    <automated>npm run test:unit -- tests/unit/renderer/features/onboarding/CountrySectorPicker.spec.tsx tests/unit/main/news && npm run typecheck</automated>
  </verify>
  <acceptance_criteria>
    - All 5 CountrySectorPicker.spec.tsx cases pass.
    - `grep -c "registerNewsHandlers" src/main/ipc/index.ts` returns ≥ 1.
    - `grep -cE '^\s*register[A-Za-z]+Handlers\(ipcMain' src/main/ipc/index.ts` returns 9 (Phase 1 baseline 6 + Gmail + Calendar + News).
    - **H5:** `grep -c "CountrySectorPicker" src/renderer/features/onboarding/OnboardingWizard.tsx` returns ≥ 1.
    - `grep -c "data-testid=\"settings-news-sources\"" src/renderer/features/settings/SettingsScreen.tsx` returns ≥ 1.
    - `grep -c "NEWS_SET_BUNDLE\\|newsSetBundle" src/renderer/features/onboarding/CountrySectorPicker.tsx` returns ≥ 1.
    - `npm run typecheck` exits 0.
  </acceptance_criteria>
  <done>News-source IPC is wired (4 channels, 9th handler), CountrySectorPicker is mounted in OnboardingWizard and verified by the H5 spec, NewsSourcesSection is mounted in Settings, and the user can configure their bundle + RSS feeds end-to-end.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Main → External RSS / HN endpoints | TLS where available; treat parsed content as untrusted; no script execution |
| Main → SQLCipher news_source | Whole-DB AES; only feed URLs + user-selected metadata stored |
| Renderer ↔ Main news handlers | Plain JSON (NewsSourceRow); URLs rendered (in Plan 02-04) as `<a target="_blank" rel="noopener noreferrer">` |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-03-01 | Tampering | Malicious RSS feed delivers JavaScript / dangerous URL | mitigate (HIGH) | rss-parser does not execute scripts; downstream renderer (Plan 02-04) sanitizes hrefs to `http(s):` only |
| T-02-03-02 | Denial of Service | Slow RSS feed blocks the briefing gatherer | mitigate (HIGH; Pitfall 15) | 10s per-feed timeout + Promise.allSettled; rss.spec case 2 enforces |
| T-02-03-03 | Spoofing | User pastes a phishing RSS URL | accept (LOW) | Phase 2: ship a warning in NewsSourcesSection ("verify feeds you add"); Phase 8 may add a reputation check |
</threat_model>

<verification>
- All `<automated>` commands pass on Windows 11 with Electron 41.6.1 + patched SQLCipher
- Manual: complete a fresh-install onboarding → CountrySectorPicker appears after MnemonicConfirm → pick NG + finance → after sealing, `SELECT COUNT(*) FROM news_source WHERE kind='bundle'` ≥ 1
- Manual: in Settings → News Sources, paste a real RSS URL (e.g. `https://hnrss.org/frontpage`) → row appears
- Phase-1 regression: all Phase-1 + Plan 02-01 + Plan 02-02 unit tests still pass
</verification>

<success_criteria>
Plan 02-03 closes the news-candidate-gathering portion of BRIEF-03. Combined with Plan 02-04 (briefing engine + UI), the §News section of the daily briefing is fully sourced. SC5 (news guardrails: bounded sources, dismissible — dismissal lives in Plan 02-04) gets its bounded-source half here.
</success_criteria>

<out_of_scope>
- Briefing engine (Plan 02-04)
- BriefingScreen UI (Plan 02-04)
- briefing + briefing_item_dismissed tables (migration 005, Plan 02-04)
- News dismissal per-day (Plan 02-04 — UI + dismiss IPC)
- More country bundles beyond NG (Phase 8 / v1.x)
- BRIEF-04 richer news topic configuration (Phase 8)
</out_of_scope>

<handoff>
Plan 02-04 (Briefing engine) imports `fetchHnTopStories`, `fetchRssFeed`, `fetchBundleCandidates` from this plan's modules as the news-candidate gatherer. It also ships migration 005 (briefing + briefing_item_dismissed) and the dismissed-item filter. The 9 handler-registration functions wired here are the baseline for Plan 02-04's 10th (registerBriefingHandlers).
</handoff>

<output>
After completion, create `.planning/phases/02-gmail-ingest-daily-briefing-mvp/02-03-SUMMARY.md` describing:
- Pinned rss-parser version
- Actual NG bundle feed URLs shipped (and any substitutions)
- Spec results for CountrySectorPicker.spec.tsx
- Confirmation `grep` counts 9 handler-registration functions in `src/main/ipc/index.ts`
- Open issues to forward to Plan 02-04
</output>
</content>
</invoke>
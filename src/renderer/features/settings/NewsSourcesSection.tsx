/**
 * Plan 02-03 Task 2 — Settings → News Sources.
 *
 * Lists the current `news_source` rows (HN / RSS / bundle) and exposes:
 *   - Add RSS URL (renderer-side format validation; main-side parse-check)
 *   - Remove per row
 *
 * Existing onboarded users who upgraded past Plan 02-03 land here for first-
 * time bundle setup: SettingsScreen surfaces a "Pick your news sources" CTA
 * when `onboarding_status === 'sealed'` AND `news_source` rows === 0. The CTA
 * is the empty-state copy in this component.
 */
import { useCallback, useEffect, useState } from 'react';
import type { NewsSourceRow, IpcError } from '../../../shared/ipc-contract';

const ADD_FEED_WARNING =
  "Verify any RSS URL you paste — Aria will fetch it on a 5–15 minute cadence as part of your daily briefing pipeline.";

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

export function NewsSourcesSection(): JSX.Element {
  const [rows, setRows] = useState<NewsSourceRow[] | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await window.aria.newsListSources();
    if (isErr(res)) {
      setError(res.error);
      setRows([]);
      return;
    }
    setRows((res as { sources: NewsSourceRow[] }).sources);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addRss(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const url = urlDraft.trim();
      const title = titleDraft.trim() || undefined;
      const res = (await window.aria.newsAddRss({ url, title })) as
        | { ok: true; id: number }
        | { ok: false; error: string }
        | IpcError;
      if (isErr(res) || ('ok' in res && !res.ok)) {
        setError(isErr(res) ? res.error : (res as { error: string }).error);
        setBusy(false);
        return;
      }
      setUrlDraft('');
      setTitleDraft('');
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number): Promise<void> {
    setBusy(true);
    try {
      await window.aria.newsRemoveSource({ id });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section data-testid="settings-news-sources" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>News sources</h2>
      <p style={{ opacity: 0.85 }}>
        Aria's daily briefing pulls news candidates from these sources. Hacker
        News and your country bundle are pre-configured; add additional RSS
        feeds below.
      </p>

      {rows === null && <p>Loading…</p>}

      {rows !== null && rows.length === 0 && (
        <p data-testid="news-sources-empty">
          No news sources yet — your briefing will skip the News section. Add an
          RSS URL below or revisit onboarding to pick a country bundle.
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <ul data-testid="news-sources-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows.map((r) => (
            <li
              key={r.id}
              data-testid={`news-source-row-${r.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '6px 0',
                borderBottom: '1px solid var(--aria-border, #ddd)',
              }}
            >
              <span style={{ fontWeight: 600, minWidth: 60 }}>{r.kind}</span>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.title ?? r.url ?? '(no title)'}
              </span>
              <button
                data-testid={`news-source-remove-${r.id}`}
                disabled={busy}
                onClick={() => remove(r.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ marginTop: 24 }}>Add an RSS feed</h3>
      <p style={{ fontSize: 13, opacity: 0.75 }}>{ADD_FEED_WARNING}</p>
      <input
        type="url"
        data-testid="news-add-rss-url"
        placeholder="https://example.com/feed.xml"
        value={urlDraft}
        onChange={(e) => setUrlDraft(e.target.value)}
        style={{ width: '100%', padding: 8, marginTop: 4 }}
      />
      <input
        type="text"
        data-testid="news-add-rss-title"
        placeholder="Optional title"
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        style={{ width: '100%', padding: 8, marginTop: 8 }}
      />
      {error && (
        <p data-testid="news-add-rss-error" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      <button
        data-testid="news-add-rss-submit"
        disabled={busy || !urlDraft.trim()}
        onClick={addRss}
        style={{ marginTop: 8, padding: '6px 12px' }}
      >
        {busy ? 'Verifying…' : 'Add feed'}
      </button>
    </section>
  );
}

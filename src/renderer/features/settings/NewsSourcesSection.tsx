/**
 * NewsSourcesSection — Settings → News sources.
 *
 * Phase 9 design-ref `app-screen-settings.jsx > NewsSources` parity pass:
 *   - "SETTING · V" gold mono eyebrow + h1 "News sources"
 *   - Playfair italic body
 *   - "ACTIVE FEEDS" mono eyebrow + per-row layout: green dot + Playfair
 *     title + mono URL subline + kind pill (RSS / HN / BUNDLE) + Remove link
 *   - "Add custom RSS feed" gold button at the bottom that expands the
 *     paste-form inline
 *
 * Catalog picker: a curated list of 234 feeds across 15 categories
 * sourced from https://github.com/plenaryapp/awesome-rss-feeds and bundled
 * as src/renderer/assets/news-catalog.json (no runtime fetch).
 *
 * Skipped from design-ref intentionally: HOME COUNTRY pill toggle (5 country
 * codes) + SECTORS OF INTEREST checkbox grid — neither lives on the
 * `NewsSourceRow` DTO nor on the news IPC. Re-skin invariant honored.
 *
 * IPC + state + data-testids preserved verbatim.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { NewsSourceRow, IpcError } from '../../../shared/ipc-contract';
import { Modal } from '../../components/editorial/Modal';
import { SkeletonRoot, SkeletonLine } from '../../components/Skeleton';
import CATALOG_RAW from '../../assets/news-catalog.json';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

const ADD_FEED_WARNING =
  "Verify any RSS URL you paste — Aria will fetch it on a 5–15 minute cadence as part of your daily briefing pipeline.";

interface CatalogFeed { title: string; url: string }
interface CatalogCategory { category: string; feeds: CatalogFeed[] }
const CATALOG = CATALOG_RAW as CatalogCategory[];

function isErr(v: unknown): v is IpcError {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

function prettyUrl(url: string | null | undefined): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

function kindLabel(kind: string): string {
  if (kind === 'hn') return 'HN';
  if (kind === 'bundle') return 'Bundle';
  return 'RSS';
}

export function NewsSourcesSection(): JSX.Element {
  const [rows, setRows] = useState<NewsSourceRow[] | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [activeCat, setActiveCat] = useState<string>(CATALOG[0]?.category ?? '');
  const [addedUrls, setAddedUrls] = useState<Set<string>>(new Set());
  const [addingUrl, setAddingUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await window.aria.newsListSources();
    if (isErr(res)) {
      setError(res.error);
      setRows([]);
      return;
    }
    const sources = (res as { sources: NewsSourceRow[] }).sources;
    setRows(sources);
    setAddedUrls(new Set(sources.map((s) => s.url ?? '').filter(Boolean)));
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
      setFormOpen(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addCatalogFeed(feed: CatalogFeed): Promise<void> {
    if (addedUrls.has(feed.url) || addingUrl === feed.url) return;
    setAddingUrl(feed.url);
    try {
      const res = (await window.aria.newsAddRss({ url: feed.url, title: feed.title })) as
        | { ok: true; id: number }
        | { ok: false; error: string }
        | IpcError;
      if (!isErr(res) && 'ok' in res && res.ok) {
        await refresh();
      }
    } finally {
      setAddingUrl(null);
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

  const hasRows = useMemo(() => rows !== null && rows.length > 0, [rows]);
  const currentCatFeeds = useMemo(
    () => CATALOG.find((c) => c.category === activeCat)?.feeds ?? [],
    [activeCat],
  );

  return (
    <section
      data-testid="settings-news-sources"
      style={{
        padding: '32px 40px 80px',
        maxWidth: '64rem',
        margin: '0 auto',
        background: 'var(--paper)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 8,
        }}
      >
        Setting · V
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 14,
          lineHeight: 1.05,
        }}
      >
        News sources
      </h2>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 36px 0',
          maxWidth: '54em',
          lineHeight: 1.6,
        }}
      >
        Aria's daily briefing pulls news candidates from these sources. Hacker News and your
        country bundle are pre-configured; add additional RSS feeds below.
      </p>

      {/* Active feeds */}
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 4,
        }}
      >
        Active feeds
      </div>

      {rows === null && (
        <SkeletonRoot style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '16px 1fr auto auto',
                gap: 14,
                alignItems: 'center',
                padding: '14px 8px',
                borderTop: '1px solid var(--rule)',
                borderBottom: i === 3 ? '1px solid var(--rule)' : 'none',
              }}
            >
              <SkeletonLine width={8} height={8} style={{ borderRadius: '50%' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <SkeletonLine width={`${50 + i * 12}%`} height={14} />
                <SkeletonLine width={`${30 + i * 8}%`} height={10} />
              </div>
              <SkeletonLine width={38} height={22} style={{ borderRadius: 4 }} />
              <SkeletonLine width={48} height={22} style={{ borderRadius: 4 }} />
            </div>
          ))}
        </SkeletonRoot>
      )}

      {rows !== null && rows.length === 0 && (
        <p
          data-testid="news-sources-empty"
          style={{
            margin: '24px 0',
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            color: 'var(--gray)',
            lineHeight: 1.55,
          }}
        >
          No news sources yet — your briefing will skip the News section. Add an RSS URL below or
          revisit onboarding to pick a country bundle.
        </p>
      )}

      {hasRows && (
        <ul data-testid="news-sources-list" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rows!.map((r, i) => (
            <li
              key={r.id}
              data-testid={`news-source-row-${r.id}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '16px 1fr auto auto',
                gap: 14,
                alignItems: 'center',
                padding: '14px 8px',
                borderTop: '1px solid var(--rule)',
                borderBottom: i === rows!.length - 1 ? '1px solid var(--rule)' : 'none',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 50,
                  background: 'var(--moss)',
                  justifySelf: 'center',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontFamily: 'var(--f-display)',
                    fontSize: 15.5,
                    fontWeight: 500,
                    color: 'var(--ink)',
                    lineHeight: 1.3,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.title ?? prettyUrl(r.url) ?? '(untitled feed)'}
                </span>
                {r.url && (
                  <span
                    style={{
                      display: 'block',
                      marginTop: 2,
                      fontFamily: 'var(--f-mono)',
                      fontSize: 11,
                      color: 'var(--gray)',
                      letterSpacing: '0.02em',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {prettyUrl(r.url)}
                  </span>
                )}
              </span>
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'var(--gold-deep)',
                  background: 'rgba(184,134,11,0.06)',
                  border: '1px solid rgba(184,134,11,0.30)',
                  padding: '3px 8px',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                {kindLabel(r.kind)}
              </span>
              <button
                type="button"
                data-testid={`news-source-remove-${r.id}`}
                disabled={busy}
                onClick={() => void remove(r.id)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '4px 8px',
                  cursor: busy ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: 'var(--gray)',
                  transition: 'color 180ms ease',
                }}
                onMouseEnter={(e) => { if (!busy) e.currentTarget.style.color = 'var(--rose)'; }}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--gray)')}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* ── Action row ───────────────────────────────────────────── */}
      <div style={{ marginTop: 28, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {!catalogOpen && !formOpen && (
          <>
            <button
              type="button"
              data-testid="news-open-catalog"
              onClick={() => setCatalogOpen(true)}
              style={goldBtn()}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gold-deep)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--gold)')}
              onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <span aria-hidden="true">⊕</span> Browse feed catalog
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              style={ghostBtn()}
              onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              + Add custom RSS feed
            </button>
          </>
        )}
      </div>

      {/* ── Catalog dialog ───────────────────────────────────────── */}
      <Modal
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        eyebrow="Feed catalog"
        title="Browse &amp; add curated sources"
        size="xl"
      >
        <CatalogPicker
          activeCat={activeCat}
          setActiveCat={setActiveCat}
          currentCatFeeds={currentCatFeeds}
          addedUrls={addedUrls}
          addingUrl={addingUrl}
          onAdd={addCatalogFeed}
        />
      </Modal>

      {/* ── Custom RSS form ──────────────────────────────────────── */}
      {formOpen && (
        <div
          style={{
            marginTop: 12,
            padding: '20px 22px',
            background: 'var(--ivory-deep)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-lg)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 19,
              fontWeight: 500,
              color: 'var(--ink)',
              marginBottom: 6,
            }}
          >
            Add an RSS feed
          </div>
          <p style={{ margin: '0 0 16px 0', fontSize: 13, color: 'var(--gray)', lineHeight: 1.55 }}>
            {ADD_FEED_WARNING}
          </p>
          <input
            type="url"
            data-testid="news-add-rss-url"
            placeholder="https://example.com/feed.xml"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            style={inputStyle()}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--rule-strong)')}
          />
          <input
            type="text"
            data-testid="news-add-rss-title"
            placeholder="Optional title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            style={{ ...inputStyle(), fontFamily: 'var(--f-body)', fontSize: 13.5, marginTop: 10 }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--rule-strong)')}
          />
          {error && (
            <p
              data-testid="news-add-rss-error"
              role="alert"
              style={{
                margin: '12px 0 0',
                padding: '8px 12px',
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                color: 'var(--rose)',
                background: 'rgba(184,73,58,0.06)',
                borderLeft: '2px solid var(--rose)',
                borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
              }}
            >
              {error}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button
              type="button"
              data-testid="news-add-rss-submit"
              disabled={busy || !urlDraft.trim()}
              onClick={() => void addRss()}
              style={{
                padding: '8px 18px',
                fontFamily: 'var(--f-body)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--paper)',
                background: urlDraft.trim() && !busy ? 'var(--gold)' : 'var(--rule-strong)',
                border: 'none',
                borderRadius: 'var(--radius)',
                cursor: urlDraft.trim() && !busy ? 'pointer' : 'not-allowed',
                transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
              }}
              onMouseEnter={(e) => { if (urlDraft.trim() && !busy) e.currentTarget.style.background = 'var(--gold-deep)'; }}
              onMouseLeave={(e) => { if (urlDraft.trim() && !busy) e.currentTarget.style.background = 'var(--gold)'; }}
              onMouseDown={(e) => { if (urlDraft.trim() && !busy) e.currentTarget.style.transform = 'scale(0.97)'; }}
              onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {busy ? 'Verifying…' : 'Add feed'}
            </button>
            <button
              type="button"
              onClick={() => { setFormOpen(false); setUrlDraft(''); setTitleDraft(''); setError(null); }}
              style={ghostBtn()}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Catalog picker component ────────────────────────────────────────────────

interface CatalogPickerProps {
  activeCat: string;
  setActiveCat: (c: string) => void;
  currentCatFeeds: CatalogFeed[];
  addedUrls: Set<string>;
  addingUrl: string | null;
  onAdd: (feed: CatalogFeed) => Promise<void>;
}

function CatalogPicker({
  activeCat,
  setActiveCat,
  currentCatFeeds,
  addedUrls,
  addingUrl,
  onAdd,
}: CatalogPickerProps): JSX.Element {
  return (
    <div
      data-testid="news-catalog-picker"
      /* flush against Modal's 18px 22px padding */
      style={{ margin: '-18px -22px', overflow: 'hidden' }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', height: 'calc(80vh - 140px)', minHeight: 480 }}>
        {/* Category sidebar */}
        <div
          style={{
            borderRight: '1px solid var(--rule)',
            overflowY: 'auto',
            padding: '10px 0',
          }}
        >
          {CATALOG.map((cat) => {
            const isActive = cat.category === activeCat;
            return (
              <button
                key={cat.category}
                type="button"
                onClick={() => setActiveCat(cat.category)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 16px',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: isActive ? 'var(--gold-deep)' : 'var(--ink-soft)',
                  background: isActive ? 'rgba(184,134,11,0.07)' : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
                  cursor: 'pointer',
                  transition: 'color 150ms ease, background 150ms ease',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.color = 'var(--ink)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.color = 'var(--ink-soft)';
                }}
              >
                {cat.category}
                <span
                  style={{
                    marginLeft: 6,
                    fontWeight: 400,
                    color: isActive ? 'var(--gold)' : 'var(--gray)',
                    fontSize: 10,
                  }}
                >
                  {cat.feeds.length}
                </span>
              </button>
            );
          })}
        </div>

        {/* Feed list */}
        <div style={{ overflowY: 'auto', padding: '8px 0' }}>
          {currentCatFeeds.map((feed) => {
            const alreadyAdded = addedUrls.has(feed.url);
            const isLoading = addingUrl === feed.url;
            return (
              <div
                key={feed.url}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 18px',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: 'var(--f-display)',
                      fontSize: 14,
                      fontWeight: 500,
                      color: 'var(--ink)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {feed.title}
                  </div>
                  <div
                    style={{
                      marginTop: 2,
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      color: 'var(--gray)',
                      letterSpacing: '0.02em',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {prettyUrl(feed.url)}
                  </div>
                </div>
                <button
                  type="button"
                  data-testid={`catalog-add-${encodeURIComponent(feed.url)}`}
                  disabled={alreadyAdded || isLoading}
                  onClick={() => void onAdd(feed)}
                  style={{
                    padding: '5px 12px',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10,
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: alreadyAdded ? 'var(--moss)' : 'var(--paper)',
                    background: alreadyAdded
                      ? 'rgba(74,124,89,0.10)'
                      : isLoading
                        ? 'var(--rule-strong)'
                        : 'var(--gold)',
                    border: alreadyAdded ? '1px solid rgba(74,124,89,0.35)' : 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: alreadyAdded || isLoading ? 'default' : 'pointer',
                    whiteSpace: 'nowrap',
                    transition: `background 180ms ease, transform 120ms ${EASE_OUT}`,
                    minWidth: 60,
                  }}
                  onMouseEnter={(e) => {
                    if (!alreadyAdded && !isLoading)
                      e.currentTarget.style.background = 'var(--gold-deep)';
                  }}
                  onMouseLeave={(e) => {
                    if (!alreadyAdded && !isLoading)
                      e.currentTarget.style.background = 'var(--gold)';
                  }}
                  onMouseDown={(e) => {
                    if (!alreadyAdded && !isLoading)
                      e.currentTarget.style.transform = 'scale(0.95)';
                  }}
                  onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  {alreadyAdded ? '✓ Added' : isLoading ? '…' : 'Add'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Style helpers ───────────────────────────────────────────────────────────

function goldBtn(): React.CSSProperties {
  return {
    padding: '9px 18px',
    fontFamily: 'var(--f-body)',
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--paper)',
    background: 'var(--gold)',
    border: 'none',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
  };
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: '8px 16px',
    fontFamily: 'var(--f-body)',
    fontSize: 13,
    color: 'var(--ink-soft)',
    background: 'transparent',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    transition: `border-color 180ms ease, transform 140ms ${EASE_OUT}`,
  };
}

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '10px 14px',
    fontFamily: 'var(--f-mono)',
    fontSize: 13,
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius)',
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 180ms ease',
  };
}

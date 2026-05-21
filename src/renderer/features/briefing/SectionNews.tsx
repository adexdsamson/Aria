/**
 * SectionNews — top-3 news from the user's saved feeds.
 *
 * Renders item title (linked back to source) + Why rationale + per-item Dismiss.
 * Phase 9 editorial pass per design-ref `app-screen-briefing.jsx > SectionNews`:
 *   - Source eyebrow above title (gold mono uppercase)
 *   - Title underlined via background-image gradient (not text-decoration)
 *   - Free-floating items separated by top/bottom rules — NO outer Card wrapper
 *   - "Why" eyebrow (gold mono small caps) + italic body rationale
 *   - Ghost outline Dismiss button right-aligned
 *   - NO AccountChip — news items have no account
 *
 * Renderer guard (T-02-04-03): href must be http(s); target="_blank" with
 * rel="noopener noreferrer".
 *
 * IPC + state + data-testids preserved verbatim.
 */
import { useState } from 'react';
import type { BriefingNewsItem } from '../../../shared/ipc-contract';

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

function sourceLabel(item: BriefingNewsItem): string {
  if (item.sourceKind === 'hn') return 'Hacker News';
  if (item.sourceKind === 'bundle') return 'News bundle';
  // rss — derive a clean hostname from the URL
  try {
    const u = new URL(item.url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return 'News';
  }
}

export function SectionNews({
  items,
  date,
  error,
  onDismiss,
}: {
  items: BriefingNewsItem[];
  date: string;
  error?: string;
  onDismiss?: (item: BriefingNewsItem) => Promise<void> | void;
}): JSX.Element {
  const [localDismissed, setLocalDismissed] = useState<Set<string>>(new Set());

  async function handleDismiss(item: BriefingNewsItem): Promise<void> {
    setLocalDismissed((prev) => new Set(prev).add(item.id));
    if (onDismiss) {
      await onDismiss(item);
      return;
    }
    try {
      await window.aria.briefingDismissNewsItem({ date, urlHash: item.id });
    } catch {
      /* swallow — UI already removed it; next refresh will reconcile */
    }
  }

  const visible = items.filter((it) => !it.dismissed && !localDismissed.has(it.id)).slice(0, 3);

  return (
    <section data-testid="briefing-section-news">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h2
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 'clamp(1.5rem, 2.5vw, 1.75rem)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            margin: 0,
          }}
        >
          News
        </h2>
        {visible.length > 0 && (
          <span className="smallcaps" style={{ color: 'var(--gray-soft)' }} aria-hidden="true">
            Top {visible.length}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          color: 'var(--gray)',
          fontSize: 14,
          marginBottom: 18,
        }}
      >
        From your saved feeds. Dismiss anything that isn't useful — the choice is remembered for today.
      </div>

      {error && (
        <div
          data-testid="section-error-news"
          style={{
            background: 'rgba(184,73,58,0.08)',
            color: 'var(--rose)',
            border: '1px solid rgba(184,73,58,0.25)',
            padding: '10px 14px',
            borderRadius: 'var(--radius)',
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {visible.length === 0 && !error && (
        <p style={{ fontStyle: 'italic', color: 'var(--gray)', margin: 0 }}>No items today.</p>
      )}

      {visible.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {visible.map((it, i) => {
            const href = safeHref(it.url);
            const source = sourceLabel(it);
            const hasWhy = it.why && it.why.trim().length > 0;
            return (
              <li
                key={it.id}
                data-testid={`news-item-${it.id}`}
                style={{
                  padding: '18px 0',
                  borderTop: '1px solid var(--rule)',
                  borderBottom: i === visible.length - 1 ? '1px solid var(--rule)' : 'none',
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 14,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  {/* Source eyebrow — gold mono uppercase */}
                  <div
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      fontWeight: 500,
                      letterSpacing: '0.18em',
                      textTransform: 'uppercase',
                      color: 'var(--gold)',
                      marginBottom: 6,
                    }}
                  >
                    {source}
                  </div>

                  {/* Title — linked to source with custom baseline underline */}
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontFamily: 'var(--f-display)',
                        fontSize: '1.0625rem',
                        fontWeight: 500,
                        color: 'var(--ink)',
                        lineHeight: 1.35,
                        textDecoration: 'none',
                        display: 'inline-block',
                        marginBottom: 8,
                        backgroundImage:
                          'linear-gradient(to right, var(--rule-strong), var(--rule-strong))',
                        backgroundSize: '100% 1px',
                        backgroundPosition: '0 100%',
                        backgroundRepeat: 'no-repeat',
                        paddingBottom: 1,
                        transition: 'color 160ms ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--gold-deep)')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink)')}
                    >
                      {it.title}
                    </a>
                  ) : (
                    <strong
                      style={{
                        fontFamily: 'var(--f-display)',
                        fontSize: '1.0625rem',
                        fontWeight: 500,
                        color: 'var(--ink)',
                        lineHeight: 1.35,
                        display: 'inline-block',
                        marginBottom: 8,
                      }}
                    >
                      {it.title}
                    </strong>
                  )}

                  {/* Why rationale — gold mono "Why" eyebrow + italic body */}
                  {hasWhy && (
                    <div
                      data-testid="rationale"
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 8,
                        color: 'var(--gray)',
                        fontSize: 13.5,
                        lineHeight: 1.55,
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          fontFamily: 'var(--f-mono)',
                          fontSize: 9,
                          letterSpacing: '0.18em',
                          textTransform: 'uppercase',
                          color: 'var(--gold)',
                          flexShrink: 0,
                        }}
                      >
                        Why
                      </span>
                      <span style={{ fontStyle: 'italic' }}>{it.why}</span>
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  data-testid={`news-dismiss-${it.id}`}
                  onClick={() => void handleDismiss(it)}
                  style={{
                    alignSelf: 'start',
                    background: 'transparent',
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                    color: 'var(--gray-soft)',
                    padding: '4px 10px',
                    border: '1px solid var(--rule)',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    height: 'fit-content',
                    transition:
                      'color 180ms ease, border-color 180ms ease, transform 140ms cubic-bezier(0.23, 1, 0.32, 1)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--ink)';
                    e.currentTarget.style.borderColor = 'var(--rule-strong)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--gray-soft)';
                    e.currentTarget.style.borderColor = 'var(--rule)';
                  }}
                  onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                  onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                >
                  Dismiss
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

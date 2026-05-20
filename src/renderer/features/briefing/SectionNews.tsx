/**
 * Plan 02-04 Task 3 — News section of the briefing.
 *
 * Renders top-3 news items with title + rationale + back-link + "Dismiss"
 * button. Dismiss writes a per-day row in briefing_item_dismissed; the
 * dismissed item disappears from the list within one tick.
 *
 * Renderer guard (T-02-04-03): href must be http(s); target="_blank" with
 * rel="noopener noreferrer".
 *
 * Phase 9 Plan 03 — RE-SKINNED. Editorial chrome (Playfair headlines, mono
 * source eyebrow, outline Dismiss button). All data-testid + behaviour
 * preserved.
 */
import { useState } from 'react';
import type { BriefingNewsItem } from '../../../shared/ipc-contract';
import { Button, Card } from '../../components/editorial';
import { AccountChip } from '../../components/AccountChip';

function safeHref(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
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
  /** Called when the user clicks Dismiss; defaults to invoking the IPC bridge. */
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
            fontSize: '1.5rem',
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
          marginBottom: 14,
        }}
      >
        From your saved feeds. Dismiss anything that isn’t useful — the choice is remembered for today.
      </div>
      {error && (
        <div
          data-testid="section-error-news"
          style={{
            background: 'rgba(184,73,58,0.08)',
            color: 'var(--rose)',
            border: '1px solid rgba(184,73,58,0.25)',
            padding: '10px 14px',
            borderRadius: 6,
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
        <Card>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {visible.map((it, i) => {
              const href = safeHref(it.url);
              return (
                <li
                  key={it.id}
                  data-testid={`news-item-${it.id}`}
                  style={{
                    padding: '14px 0',
                    borderBottom:
                      i === visible.length - 1 ? 'none' : '1px solid var(--rule)',
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 14,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                      <strong
                        style={{
                          fontFamily: 'var(--f-display)',
                          fontSize: '1rem',
                          fontWeight: 500,
                          color: 'var(--ink)',
                          lineHeight: 1.35,
                        }}
                      >
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              color: 'var(--ink)',
                              textDecoration: 'none',
                              borderBottom: '1px solid var(--rule-strong)',
                            }}
                          >
                            {it.title}
                          </a>
                        ) : (
                          it.title
                        )}
                      </strong>
                      <AccountChip compact />
                    </div>
                    <div
                      data-testid="rationale"
                      style={{
                        color: 'var(--gray)',
                        fontSize: 13.5,
                        fontStyle: 'italic',
                        lineHeight: 1.55,
                      }}
                    >
                      {it.why}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    data-testid={`news-dismiss-${it.id}`}
                    onClick={() => void handleDismiss(it)}
                    style={{
                      alignSelf: 'start',
                      minHeight: 'auto',
                      padding: '4px 10px',
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: 'var(--gray-soft)',
                      border: '1px solid var(--rule)',
                      borderRadius: 4,
                    }}
                  >
                    Dismiss
                  </Button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}

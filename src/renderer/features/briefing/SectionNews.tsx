/**
 * Plan 02-04 Task 3 — News section of the briefing.
 *
 * Renders top-3 news items with title + rationale + back-link + "Dismiss"
 * button. Dismiss writes a per-day row in briefing_item_dismissed; the
 * dismissed item disappears from the list within one tick.
 *
 * Renderer guard (T-02-04-03): href must be http(s); target="_blank" with
 * rel="noopener noreferrer".
 */
import { useState } from 'react';
import type { BriefingNewsItem } from '../../../shared/ipc-contract';
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
      <h2 style={{ fontSize: 'var(--aria-type-xl)' }}>News</h2>
      {error && (
        <div
          data-testid="section-error-news"
          style={{
            backgroundColor: '#fef3c7',
            color: '#92400e',
            padding: 8,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}
      {visible.length === 0 && !error && <p>No items today.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {visible.map((it) => {
          const href = safeHref(it.url);
          return (
            <li key={it.id} data-testid={`news-item-${it.id}`} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <strong>
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      {it.title}
                    </a>
                  ) : (
                    it.title
                  )}
                </strong>
                <AccountChip compact />
              </div>
              <div data-testid="rationale" style={{ color: 'var(--aria-muted-fg)' }}>
                {it.why}
              </div>
              <button
                type="button"
                data-testid={`news-dismiss-${it.id}`}
                onClick={() => void handleDismiss(it)}
              >
                Dismiss
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

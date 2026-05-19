/**
 * Plan 07-03 Task 7 — Citation list with TZ-correct timestamps + account chips.
 *
 * Each citation row:
 *   - Source-kind icon + denormalized `title` (C8/C12)
 *   - Snippet
 *   - Account chip (from IPC payload — `disconnected: boolean` flows through
 *     RagCitation.accountChip — no second renderer query, REVIEWS C8 echo)
 *   - Timestamp formatted via Intl.DateTimeFormat(timeZone: userIanaTz)
 *   - Click → ragOpenSource(sourceKind, sourceId, charStart, charEnd)
 */
import type { RagCitationDto } from '../../../shared/ipc-contract';

export interface CitationListProps {
  citations: RagCitationDto[];
  userIanaTz: string;
  onOpen?: (c: RagCitationDto) => void;
}

const ICONS: Record<RagCitationDto['sourceKind'], string> = {
  email: '✉',
  event: '📅',
  note: '📝',
  action: '✓',
};

function formatTimestamp(iso: string | undefined, tz: string): string {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function CitationList({ citations, userIanaTz, onOpen }: CitationListProps): JSX.Element {
  if (citations.length === 0) return <></>;
  return (
    <ol
      data-testid="citation-list"
      style={{ listStyle: 'decimal inside', padding: 0, marginTop: 8 }}
    >
      {citations.map((c) => (
        <li
          key={`${c.sourceKind}:${c.sourceId}:${c.index}`}
          data-testid={`citation-${c.index}`}
          style={{
            padding: 8,
            borderBottom: '1px solid var(--aria-border, #e5e7eb)',
            cursor: onOpen ? 'pointer' : 'default',
          }}
          onClick={() => {
            if (onOpen) onOpen(c);
            void window.aria.ragOpenSource({
              sourceKind: c.sourceKind,
              sourceId: c.sourceId,
              charStart: c.charStart,
              charEnd: c.charEnd,
            });
          }}
        >
          <span aria-hidden style={{ marginRight: 6 }}>
            {ICONS[c.sourceKind]}
          </span>
          <strong>{c.title}</strong>
          <span
            style={{
              marginLeft: 8,
              color: 'var(--aria-muted, #64748b)',
              fontWeight: 'normal',
            }}
          >
            {c.snippet}
          </span>
          {c.accountChip && (
            <span
              data-testid={`citation-chip-${c.index}`}
              data-disconnected={c.accountChip.disconnected ? 'true' : 'false'}
              style={{
                marginLeft: 8,
                fontSize: 11,
                padding: '1px 6px',
                borderRadius: 999,
                background: c.accountChip.disconnected ? '#fef2f2' : '#f1f5f9',
                color: c.accountChip.disconnected ? '#991b1b' : '#334155',
                border: '1px solid #cbd5e1',
              }}
              title={c.accountChip.email}
            >
              {c.accountChip.provider === 'microsoft' ? 'M' : 'G'} {c.accountChip.email}
              {c.accountChip.disconnected ? ' (disconnected)' : ''}
            </span>
          )}
          {c.occurredAt && (
            <time
              data-testid={`citation-time-${c.index}`}
              dateTime={c.occurredAt}
              style={{ marginLeft: 8, fontSize: 11, color: 'var(--aria-muted, #94a3b8)' }}
            >
              {formatTimestamp(c.occurredAt, userIanaTz)}
            </time>
          )}
        </li>
      ))}
    </ol>
  );
}

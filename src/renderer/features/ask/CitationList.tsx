/**
 * Plan 07-03 Task 7 + Phase 9 re-skin — Citation list with TZ-correct
 * timestamps + account chips.
 *
 * Each citation row:
 *   - Source-kind tag (mono uppercase)
 *   - denormalized `title` (C8/C12) underlined editorially
 *   - snippet
 *   - account chip (REVIEWS C8 echo — `disconnected` flows from IPC payload)
 *   - timestamp via Intl.DateTimeFormat(timeZone: userIanaTz)
 *   - click → ragOpenSource(sourceKind, sourceId, charStart, charEnd)
 */
import type { RagCitationDto } from '../../../shared/ipc-contract';

export interface CitationListProps {
  citations: RagCitationDto[];
  userIanaTz: string;
  onOpen?: (c: RagCitationDto) => void;
}

const KIND_LABELS: Record<RagCitationDto['sourceKind'], string> = {
  email: 'Email',
  event: 'Calendar',
  note: 'Meeting',
  action: 'Task',
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
      style={{
        listStyle: 'none',
        padding: 0,
        margin: '6px 0 0',
        borderTop: '1px solid var(--rule)',
      }}
    >
      {citations.map((c) => (
        <li
          key={`${c.sourceKind}:${c.sourceId}:${c.index}`}
          data-testid={`citation-${c.index}`}
          style={{
            padding: '10px 0',
            borderBottom: '1px solid var(--rule)',
            cursor: onOpen ? 'pointer' : 'default',
            fontFamily: 'var(--f-body)',
            fontSize: 13.5,
            lineHeight: 1.55,
            color: 'var(--ink-soft)',
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
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span
              aria-hidden
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--gold-deep)',
                padding: '1px 6px',
                border: '1px solid var(--rule-strong)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--ivory-deep)',
              }}
            >
              {KIND_LABELS[c.sourceKind]}
            </span>
            <strong
              style={{
                color: 'var(--ink)',
                fontWeight: 600,
                textDecoration: 'underline',
                textDecorationColor: 'var(--rule-strong)',
                textUnderlineOffset: 3,
              }}
            >
              {c.title}
            </strong>
            {c.accountChip && (
              <span
                data-testid={`citation-chip-${c.index}`}
                data-disconnected={c.accountChip.disconnected ? 'true' : 'false'}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  padding: '1px 6px',
                  borderRadius: 999,
                  background: c.accountChip.disconnected
                    ? 'rgba(184,73,58,0.08)'
                    : 'var(--ivory-deep)',
                  color: c.accountChip.disconnected ? 'var(--rose)' : 'var(--gray)',
                  border: `1px solid ${
                    c.accountChip.disconnected ? 'var(--rose)' : 'var(--rule)'
                  }`,
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
                style={{
                  marginLeft: 'auto',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: 'var(--gray-soft)',
                }}
              >
                {formatTimestamp(c.occurredAt, userIanaTz)}
              </time>
            )}
          </div>
          <p style={{ margin: '4px 0 0', color: 'var(--gray)' }}>{c.snippet}</p>
        </li>
      ))}
    </ol>
  );
}

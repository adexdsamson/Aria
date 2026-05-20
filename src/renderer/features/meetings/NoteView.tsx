import type { TranscriptNoteDto } from '../../../shared/ipc-contract';
import { Card } from '../../components/editorial';

/**
 * Phase 9 re-skin: read-only meeting note view. Test contract preserved:
 *   - note-view-{id}, note-link-status (textContent), note-transcript,
 *     note-segments, note-segment-{i}.
 */
export function NoteView({ note }: { note: TranscriptNoteDto }): JSX.Element {
  return (
    <Card>
      <article data-testid={`note-view-${note.id}`}>
        <header style={{ marginBottom: 14 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: '1.5rem',
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
            }}
          >
            {note.title}
          </h2>
          <p
            data-testid="note-link-status"
            style={{
              margin: '6px 0 0 0',
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
            }}
          >
            {note.calendarEventId ? `Linked to ${note.calendarEventId}` : 'Standalone note'}
          </p>
        </header>
        <pre
          data-testid="note-transcript"
          style={{
            whiteSpace: 'pre-wrap',
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            lineHeight: 1.7,
            color: 'var(--ink)',
            background: 'var(--ivory-deep)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-lg)',
            padding: '1.25rem 1.5rem',
            margin: 0,
          }}
        >
          {note.normalizedText}
        </pre>
        <div
          data-testid="note-segments"
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}
        >
          {note.segments.map((segment, index) => (
            <a
              key={`${segment.start}-${segment.end}`}
              href={`#${segment.start}-${segment.end}`}
              data-testid={`note-segment-${index}`}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--gray)',
                textDecoration: 'none',
                borderBottom: '1px solid var(--rule-strong)',
                paddingBottom: 1,
              }}
            >
              {segment.speaker ?? `Segment ${index + 1}`}
            </a>
          ))}
        </div>
      </article>
    </Card>
  );
}

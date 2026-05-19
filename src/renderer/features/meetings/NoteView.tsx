import type { TranscriptNoteDto } from '../../../shared/ipc-contract';

export function NoteView({ note }: { note: TranscriptNoteDto }): JSX.Element {
  return (
    <article data-testid={`note-view-${note.id}`} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
      <header style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{note.title}</h2>
        <p data-testid="note-link-status" style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: 13 }}>
          {note.calendarEventId ? `Linked to ${note.calendarEventId}` : 'Standalone note'}
        </p>
      </header>
      <pre
        data-testid="note-transcript"
        style={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          background: '#f8fafc',
          borderRadius: 8,
          padding: 12,
        }}
      >
        {note.normalizedText}
      </pre>
      <div data-testid="note-segments" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {note.segments.map((segment, index) => (
          <a
            key={`${segment.start}-${segment.end}`}
            href={`#${segment.start}-${segment.end}`}
            data-testid={`note-segment-${index}`}
            style={{ fontSize: 12 }}
          >
            {segment.speaker ?? `Segment ${index + 1}`}
          </a>
        ))}
      </div>
    </article>
  );
}

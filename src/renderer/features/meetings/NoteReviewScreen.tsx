import { useEffect, useState } from 'react';
import type { MeetingActionDto, MeetingSummaryItemDto, TranscriptNoteDto } from '../../../shared/ipc-contract';
import { CitationHighlighter, useCitationSelection } from './CitationHighlighter';

export function NoteReviewScreen({ noteId }: { noteId: string }): JSX.Element {
  const [note, setNote] = useState<TranscriptNoteDto | null>(null);
  const [summaryItems, setSummaryItems] = useState<MeetingSummaryItemDto[]>([]);
  const [actions, setActions] = useState<MeetingActionDto[]>([]);
  const [activeCitation, setActiveCitation] = useCitationSelection();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await window.aria.transcriptGetReview({ noteId });
      if (cancelled || 'error' in res) return;
      setNote(res.note);
      setSummaryItems(res.summaryItems);
      setActions(res.actions);
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  if (!note) return <section data-testid="note-review-loading">Loading...</section>;

  return (
    <section data-testid="note-review-screen" style={{ padding: 'var(--aria-space-xl)' }}>
      <h1 style={{ marginTop: 0 }}>{note.title}</h1>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div>
          <CitationHighlighter text={note.normalizedText} active={activeCitation} />
        </div>
        <div>
          <SummarySection title="Topics" kind="topic" items={summaryItems} onCitation={setActiveCitation} />
          <SummarySection title="Decisions" kind="decision" items={summaryItems} onCitation={setActiveCitation} />
          <ActionsSection actions={actions} onCitation={setActiveCitation} />
          <SummarySection title="Follow-ups" kind="follow_up" items={summaryItems} onCitation={setActiveCitation} />
          <SummarySection title="Open Questions" kind="open_question" items={summaryItems} onCitation={setActiveCitation} />
        </div>
      </div>
    </section>
  );
}

function SummarySection({
  title,
  kind,
  items,
  onCitation,
}: {
  title: string;
  kind: MeetingSummaryItemDto['kind'];
  items: MeetingSummaryItemDto[];
  onCitation(citation: { start: number; end: number }): void;
}): JSX.Element {
  const rows = items.filter((item) => item.kind === kind);
  return (
    <section data-testid={`review-section-${kind}`}>
      <h2>{title}</h2>
      {rows.length === 0 && <p>No items yet.</p>}
      {rows.map((item) => (
        <p key={item.id}>
          {item.text}{' '}
          <button
            type="button"
            data-testid={`citation-${item.id}`}
            onClick={() => onCitation({ start: item.citationStart, end: item.citationEnd })}
          >
            citation
          </button>
        </p>
      ))}
    </section>
  );
}

function ActionsSection({
  actions,
  onCitation,
}: {
  actions: MeetingActionDto[];
  onCitation(citation: { start: number; end: number }): void;
}): JSX.Element {
  return (
    <section data-testid="review-section-actions">
      <h2>Actions</h2>
      {actions.map((action) => (
        <article key={action.id} data-testid={`review-action-${action.id}`} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, marginBottom: 8 }}>
          <input aria-label="Action text" defaultValue={action.text} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
            <select aria-label="Owner" defaultValue={action.owner}>
              <option value="self">self</option>
              <option value="follow-up">follow-up</option>
              <option value="unassigned">unassigned</option>
            </select>
            <input aria-label="Due" defaultValue={action.dueIso ?? action.dueRaw ?? ''} />
            <select aria-label="Priority" defaultValue={action.priorityHint ?? 'p3'}>
              <option value="p1">p1</option>
              <option value="p2">p2</option>
              <option value="p3">p3</option>
              <option value="p4">p4</option>
            </select>
            <button type="button" onClick={() => onCitation({ start: action.citationStart, end: action.citationEnd })}>
              citation
            </button>
            <button type="button">reject</button>
          </div>
        </article>
      ))}
    </section>
  );
}

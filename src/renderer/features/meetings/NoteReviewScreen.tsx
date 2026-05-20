import { useEffect, useState } from 'react';
import type {
  MeetingActionDto,
  MeetingSummaryItemDto,
  TranscriptNoteDto,
} from '../../../shared/ipc-contract';
import { Button, Card, LabelRule } from '../../components/editorial';
import { CitationHighlighter, useCitationSelection } from './CitationHighlighter';

/**
 * Phase 9 re-skin: NoteReviewScreen.
 * Two-column layout: transcript with citation highlight (left), side rail with
 * Topics / Decisions / Actions / Follow-ups / Open questions (right).
 *
 * Test contract preserved: note-review-screen, note-review-loading,
 *   review-section-{kind}, review-section-actions, review-action-{id},
 *   citation-{itemId}, plus existing IPC (transcriptGetReview).
 */
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

  if (!note) {
    return (
      <section
        data-testid="note-review-loading"
        style={{
          padding: '2.5rem 2rem',
          fontFamily: 'var(--f-mono)',
          fontSize: 12,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--gray-soft)',
        }}
      >
        Loading…
      </section>
    );
  }

  return (
    <section
      data-testid="note-review-screen"
      style={{
        padding: '2.5rem 2rem 4rem',
        background: 'var(--ivory)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <header
        style={{
          marginBottom: 24,
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 18,
        }}
      >
        <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 8 }}>
          Review · extracted items
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: '2rem',
            letterSpacing: '-0.01em',
          }}
        >
          {note.title}
        </h1>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 24,
          alignItems: 'start',
        }}
      >
        <div>
          <LabelRule label="Transcript" align="left" />
          <div style={{ marginTop: 14 }}>
            <CitationHighlighter text={note.normalizedText} active={activeCitation} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span
                className="smallcaps"
                style={{ color: 'var(--gray)' }}
              >
                Push to approvals
              </span>
              <Button variant="primary">Push as task batch</Button>
            </div>
          </Card>
          <SummarySection
            title="Topics"
            kind="topic"
            items={summaryItems}
            onCitation={setActiveCitation}
          />
          <SummarySection
            title="Decisions"
            kind="decision"
            items={summaryItems}
            onCitation={setActiveCitation}
          />
          <ActionsSection actions={actions} onCitation={setActiveCitation} />
          <SummarySection
            title="Follow-ups"
            kind="follow_up"
            items={summaryItems}
            onCitation={setActiveCitation}
          />
          <SummarySection
            title="Open Questions"
            kind="open_question"
            items={summaryItems}
            onCitation={setActiveCitation}
          />
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
      <Card>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: '1.125rem',
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
          }}
        >
          {title}
        </h2>
        {rows.length === 0 && (
          <p
            style={{
              margin: '8px 0 0',
              fontFamily: 'var(--f-body)',
              fontSize: 13,
              color: 'var(--gray-soft)',
              fontStyle: 'italic',
            }}
          >
            No items yet.
          </p>
        )}
        {rows.map((item) => (
          <p
            key={item.id}
            style={{
              margin: '10px 0 0',
              fontFamily: 'var(--f-body)',
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--ink-soft)',
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{item.text}</span>
            <button
              type="button"
              data-testid={`citation-${item.id}`}
              onClick={() => onCitation({ start: item.citationStart, end: item.citationEnd })}
              style={citationBadgeStyle()}
            >
              citation
            </button>
          </p>
        ))}
      </Card>
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
      <Card>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: '1.125rem',
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
          }}
        >
          Action items
        </h2>
        {actions.length === 0 && (
          <p
            style={{
              margin: '8px 0 0',
              fontFamily: 'var(--f-body)',
              fontSize: 13,
              color: 'var(--gray-soft)',
              fontStyle: 'italic',
            }}
          >
            No extracted actions yet.
          </p>
        )}
        {actions.map((action) => (
          <article
            key={action.id}
            data-testid={`review-action-${action.id}`}
            style={{
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius)',
              padding: 12,
              marginTop: 12,
              background: 'var(--ivory-deep)',
            }}
          >
            <input
              aria-label="Action text"
              defaultValue={action.text}
              style={{
                width: '100%',
                background: 'var(--paper)',
                color: 'var(--ink)',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--radius)',
                padding: '8px 10px',
                fontFamily: 'var(--f-body)',
                fontSize: 14,
              }}
            />
            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 10,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              <select aria-label="Owner" defaultValue={action.owner} style={selectStyle()}>
                <option value="self">self</option>
                <option value="follow-up">follow-up</option>
                <option value="unassigned">unassigned</option>
              </select>
              <input
                aria-label="Due"
                defaultValue={action.dueIso ?? action.dueRaw ?? ''}
                style={{ ...selectStyle(), minWidth: 120 }}
              />
              <select
                aria-label="Priority"
                defaultValue={action.priorityHint ?? 'p3'}
                style={selectStyle()}
              >
                <option value="p1">p1</option>
                <option value="p2">p2</option>
                <option value="p3">p3</option>
                <option value="p4">p4</option>
              </select>
              <button
                type="button"
                onClick={() =>
                  onCitation({ start: action.citationStart, end: action.citationEnd })
                }
                style={citationBadgeStyle()}
              >
                citation
              </button>
              <button type="button" style={rejectBtnStyle()}>
                reject
              </button>
            </div>
          </article>
        ))}
      </Card>
    </section>
  );
}

function citationBadgeStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-mono)',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--gray)',
    background: 'transparent',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px',
    cursor: 'pointer',
  };
}

function selectStyle(): React.CSSProperties {
  return {
    background: 'var(--paper)',
    color: 'var(--ink)',
    border: '1px solid var(--rule)',
    borderRadius: 'var(--radius)',
    padding: '6px 8px',
    fontFamily: 'var(--f-body)',
    fontSize: 13,
  };
}

function rejectBtnStyle(): React.CSSProperties {
  return {
    fontFamily: 'var(--f-mono)',
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--rose)',
    background: 'transparent',
    border: '1px solid var(--rose)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px',
    cursor: 'pointer',
  };
}

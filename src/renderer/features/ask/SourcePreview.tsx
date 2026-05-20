/**
 * Plan 07-03 Task 7 + Phase 9 re-skin — Lightweight source-preview shell.
 *
 * Renders a kind-aware caption for click-through previews from CitationList.
 * For `note` source, callers wire it to Phase 6's char-offset highlight
 * viewer (deferred to a Phase 7 follow-up — the viewer lives in
 * `meetings/TranscriptCaptureScreen`). For v1, this is a small inline panel
 * that surfaces the chunk metadata.
 */
import type { RagCitationDto } from '../../../shared/ipc-contract';

const KIND_LABELS: Record<RagCitationDto['sourceKind'], string> = {
  email: 'Email',
  event: 'Calendar',
  note: 'Meeting',
  action: 'Task',
};

export function SourcePreview({ citation }: { citation: RagCitationDto }): JSX.Element {
  return (
    <aside
      data-testid={`source-preview-${citation.sourceKind}`}
      style={{
        marginTop: 10,
        padding: '12px 16px',
        borderLeft: '3px solid var(--gold)',
        background: 'var(--ivory-deep)',
        fontFamily: 'var(--f-body)',
        fontSize: 13,
        color: 'var(--ink-soft)',
        borderRadius: '0 var(--radius) var(--radius) 0',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--gold-deep)',
          }}
        >
          {KIND_LABELS[citation.sourceKind]}
        </span>
        <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{citation.title}</strong>
      </header>
      <p style={{ margin: 0, color: 'var(--gray)' }}>{citation.snippet}</p>
      <small
        style={{
          display: 'block',
          marginTop: 6,
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--gray-soft)',
        }}
      >
        chars {citation.charStart}–{citation.charEnd}
      </small>
    </aside>
  );
}

/**
 * Plan 07-03 Task 7 — Lightweight source-preview shell.
 *
 * Renders a kind-aware caption for click-through previews from CitationList.
 * For `note` source, callers wire it to Phase 6's char-offset highlight
 * viewer (deferred to a Phase 7 follow-up — the viewer lives in
 * `meetings/TranscriptCaptureScreen`). For v1, this is a small inline panel
 * that surfaces the chunk metadata.
 */
import type { RagCitationDto } from '../../../shared/ipc-contract';

export function SourcePreview({ citation }: { citation: RagCitationDto }): JSX.Element {
  return (
    <aside
      data-testid={`source-preview-${citation.sourceKind}`}
      style={{
        marginTop: 8,
        padding: 10,
        borderLeft: '3px solid var(--aria-accent, #6366f1)',
        background: 'var(--aria-gray-50, #f8fafc)',
        fontSize: 13,
      }}
    >
      <header style={{ fontWeight: 600, marginBottom: 4 }}>
        {iconFor(citation.sourceKind)} {citation.title}
      </header>
      <p style={{ margin: 0, color: 'var(--aria-muted, #64748b)' }}>{citation.snippet}</p>
      <small style={{ color: 'var(--aria-muted, #94a3b8)' }}>
        chars {citation.charStart}–{citation.charEnd}
      </small>
    </aside>
  );
}

function iconFor(k: RagCitationDto['sourceKind']): string {
  switch (k) {
    case 'email':
      return '✉';
    case 'event':
      return '📅';
    case 'note':
      return '📝';
    case 'action':
      return '✓';
    default:
      return '·';
  }
}

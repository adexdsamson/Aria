import { useState } from 'react';

/**
 * Phase 9 re-skin: inline transcript citation highlighter.
 *
 * Q-01 default: NO hover popovers. Active citation gets a 1.5px gold
 * underline + 60%-opacity gold tinted background. Inline only.
 *
 * Behaviour invariants: char-offset citation contract (start/end) and the
 * `citation-text` / `citation-highlight` test-ids are preserved verbatim.
 */
export function CitationHighlighter({
  text,
  active,
}: {
  text: string;
  active: { start: number; end: number } | null;
}): JSX.Element {
  if (!active) {
    return (
      <pre data-testid="citation-text" style={preStyle()}>
        {text}
      </pre>
    );
  }
  return (
    <pre data-testid="citation-text" style={preStyle()}>
      {text.slice(0, active.start)}
      <mark data-testid="citation-highlight" style={highlightStyle()}>
        {text.slice(active.start, active.end)}
      </mark>
      {text.slice(active.end)}
    </pre>
  );
}

export function useCitationSelection(): [
  { start: number; end: number } | null,
  (citation: { start: number; end: number }) => void,
] {
  const [active, setActive] = useState<{ start: number; end: number } | null>(null);
  return [active, setActive];
}

function preStyle(): React.CSSProperties {
  return {
    whiteSpace: 'pre-wrap',
    fontFamily: 'var(--f-body)',
    fontSize: 14,
    lineHeight: 1.7,
    color: 'var(--ink)',
    background: 'var(--paper)',
    border: '1px solid var(--rule)',
    borderRadius: 'var(--radius-lg)',
    padding: '1.25rem 1.5rem',
    margin: 0,
  };
}

function highlightStyle(): React.CSSProperties {
  return {
    background: 'rgba(184, 134, 11, 0.12)',
    color: 'var(--ink)',
    borderBottom: '1.5px solid rgba(184, 134, 11, 0.6)',
    padding: '0 2px',
    borderRadius: 2,
  };
}

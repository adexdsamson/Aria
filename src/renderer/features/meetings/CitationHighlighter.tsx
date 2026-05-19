import { useState } from 'react';

export function CitationHighlighter({
  text,
  active,
}: {
  text: string;
  active: { start: number; end: number } | null;
}): JSX.Element {
  if (!active) {
    return <pre data-testid="citation-text" style={preStyle()}>{text}</pre>;
  }
  return (
    <pre data-testid="citation-text" style={preStyle()}>
      {text.slice(0, active.start)}
      <mark data-testid="citation-highlight">{text.slice(active.start, active.end)}</mark>
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
    fontFamily: 'inherit',
    background: '#f8fafc',
    borderRadius: 8,
    padding: 12,
  };
}

/**
 * DiagnosticsSection — composite (Plan 04 Task 3).
 *
 * Mounts <AskAriaBox/> (top) and <RoutingLogPanel/> (below). When AskAriaBox
 * fires `onAnswered`, the panel re-fetches via a bumped `refreshKey`.
 */
import { useState } from 'react';
import { AskAriaBox } from './AskAriaBox';
import { RoutingLogPanel } from './RoutingLogPanel';

export function DiagnosticsSection(): JSX.Element {
  const [refreshKey, setRefreshKey] = useState<number>(0);
  return (
    <section data-testid="settings-diagnostics" style={{ padding: 'var(--aria-space-lg)' }}>
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginTop: 0, borderBottom: '1px solid var(--rule)', paddingBottom: 12 }}>Diagnostics</h2>
      <p style={{ color: 'var(--aria-fg-muted)' }}>
        Ask Aria a question to exercise the LLM router end-to-end. Every
        decision is logged below with its verbatim reason — that&apos;s the
        audit trail for LLM-01 / LLM-03 / LLM-04 / LLM-05.
      </p>
      <AskAriaBox onAnswered={() => setRefreshKey((k) => k + 1)} />
      <RoutingLogPanel refreshKey={refreshKey} />
    </section>
  );
}

/**
 * Plan 03-02 — /routing-log full-page screen.
 *
 * Wraps the existing RoutingLogPanel in filter mode. Settings → Diagnostics
 * continues to render the legacy "last 100" panel via DiagnosticsSection
 * (unchanged).
 */
import { RoutingLogPanel } from '../settings/RoutingLogPanel';

export function RoutingLogScreen(): JSX.Element {
  return (
    <main
      data-testid="routing-log-screen"
      style={{ padding: 'var(--aria-space-lg, 16px)' }}
    >
      <header style={{ marginBottom: 'var(--aria-space-md, 12px)' }}>
        <h1 style={{ fontSize: 'var(--aria-type-xl, 1.5rem)', margin: 0 }}>
          Routing log
        </h1>
        <p style={{ color: 'var(--aria-fg-muted, #6b7280)', marginTop: 4 }}>
          Every LLM call Aria has made, with the verbatim reason. Filter by
          date range, route, source, or sensitivity category.
        </p>
      </header>
      <RoutingLogPanel showFilters />
    </main>
  );
}

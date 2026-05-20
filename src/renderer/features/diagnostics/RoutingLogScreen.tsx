/**
 * Plan 03-02 — /routing-log full-page screen.
 *
 * Re-skinned in Phase 9 Plan 05: editorial header + Playfair display + mono
 * eyebrow, rule-bottom divider. RoutingLogPanel (filter mode) carries the
 * actual rows + filter chips.
 */
import { RoutingLogPanel } from '../settings/RoutingLogPanel';

export function RoutingLogScreen(): JSX.Element {
  return (
    <main
      data-testid="routing-log-screen"
      style={{
        padding: '32px 40px',
        maxWidth: '72rem',
        margin: '0 auto',
        background: 'var(--paper)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <header
        style={{
          marginBottom: 24,
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 16,
        }}
      >
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginBottom: 6,
          }}
        >
          Diagnostics · routing audit
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 36,
            fontWeight: 500,
            letterSpacing: '-0.01em',
            color: 'var(--ink)',
            margin: 0,
            marginBottom: 8,
          }}
        >
          Routing log
        </h1>
        <p
          style={{
            color: 'var(--ink-soft)',
            margin: 0,
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            lineHeight: 1.55,
          }}
        >
          Every LLM call Aria has made, with the verbatim reason. Filter by
          date range, route, source, or sensitivity category.
        </p>
      </header>
      <RoutingLogPanel showFilters />
    </main>
  );
}

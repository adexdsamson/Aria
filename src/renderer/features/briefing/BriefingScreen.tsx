/**
 * Briefing screen — D-12 "Aria is alive" status placeholder.
 * Plan 2 of Phase 1 replaces this with the real daily-briefing widget.
 */
export function BriefingScreen(): JSX.Element {
  return (
    <section
      style={{
        padding: 'var(--aria-space-xl)',
        color: 'var(--aria-fg)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--aria-type-3xl)',
          margin: 0,
          marginBottom: 'var(--aria-space-md)',
        }}
      >
        Aria is alive
      </h1>
      <p style={{ color: 'var(--aria-muted-fg)', maxWidth: 640 }}>
        This is the Phase 1 placeholder for the daily briefing. The real briefing —
        what matters today across calendar, inbox, tasks, and meetings — lands once
        the integration layer (Phase 2) and routing layer (Phase 4) are wired in.
      </p>
    </section>
  );
}

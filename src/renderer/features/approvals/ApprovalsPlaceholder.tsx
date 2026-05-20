/**
 * Approvals queue placeholder. Phase 3 implements the real queue.
 *
 * Phase 9 Plan 03 — RE-SKINNED. Editorial empty state with Playfair
 * heading and italic supporting copy.
 */
export function ApprovalsPlaceholder(): JSX.Element {
  return (
    <section
      style={{
        maxWidth: 1100,
        margin: '0 auto',
        padding: '28px 32px 80px',
        color: 'var(--ink)',
      }}
    >
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontWeight: 500,
          fontSize: '2.25rem',
          letterSpacing: '-0.015em',
          margin: '0 0 14px 0',
        }}
      >
        Approvals
      </h1>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          color: 'var(--gray)',
          fontSize: '1.125rem',
          margin: 0,
        }}
      >
        Approvals queue — coming in Phase 3
      </p>
    </section>
  );
}

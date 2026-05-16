/**
 * Approvals queue placeholder. Phase 3 implements the real queue.
 */
export function ApprovalsPlaceholder(): JSX.Element {
  return (
    <section
      style={{
        padding: 'var(--aria-space-xl)',
        color: 'var(--aria-fg)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--aria-type-2xl)',
          margin: 0,
          marginBottom: 'var(--aria-space-md)',
        }}
      >
        Approvals
      </h1>
      <p style={{ color: 'var(--aria-muted-fg)' }}>
        Approvals queue — coming in Phase 3
      </p>
    </section>
  );
}

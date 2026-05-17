/**
 * Plan 02-04 Task 3 — Priority Email section of the briefing.
 *
 * B4 SC2 fallback: when `emailEmptyStateReason === 'no-important-label'`,
 * render the LOCKED copy below instead of the generic "No items today."
 * placeholder. This is NOT an error — it is the documented Phase-2
 * limitation. Phase 3's classifier replaces it.
 */
import type { BriefingItem, BriefingPayload } from '../../../shared/ipc-contract';

export const NO_IMPORTANT_LABEL_COPY =
  "No mail flagged Important by Gmail. Phase 3 adds Aria's own priority classifier.";

export function SectionEmail({
  items,
  error,
  emailEmptyStateReason,
}: {
  items: BriefingItem[];
  error?: string;
  emailEmptyStateReason?: BriefingPayload['emailEmptyStateReason'];
}): JSX.Element {
  const top3 = items.slice(0, 3);
  const showSc2Fallback =
    !error && top3.length === 0 && emailEmptyStateReason === 'no-important-label';
  return (
    <section data-testid="briefing-section-email">
      <h2 style={{ fontSize: 'var(--aria-type-xl)' }}>Priority Email</h2>
      {error && (
        <div
          data-testid="section-error-email"
          style={{
            backgroundColor: '#fef3c7',
            color: '#92400e',
            padding: 8,
            borderRadius: 6,
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}
      {showSc2Fallback && (
        <p data-testid="email-sc2-fallback">{NO_IMPORTANT_LABEL_COPY}</p>
      )}
      {!error && top3.length === 0 && !showSc2Fallback && <p>No items today.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {top3.map((it) => (
          <li key={it.id} data-testid={`email-item-${it.id}`} style={{ marginBottom: 12 }}>
            <strong>{it.title}</strong>
            <div data-testid="rationale" style={{ color: 'var(--aria-muted-fg)' }}>
              {it.why}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

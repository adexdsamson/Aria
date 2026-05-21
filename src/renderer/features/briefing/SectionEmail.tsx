/**
 * Plan 02-04 Task 3 — Priority Email section of the briefing.
 *
 * B4 SC2 fallback copy is LOCKED.
 *
 * Phase 9 Plan 03 — RE-SKINNED. Editorial typography + card surface. The
 * NO_IMPORTANT_LABEL_COPY string and the `data-testid="email-sc2-fallback"`
 * are preserved verbatim.
 */
import type { BriefingItem, BriefingPayload } from '../../../shared/ipc-contract';
import { Card } from '../../components/editorial';
import { BriefingItem as BriefingItemRow } from './BriefingItem';

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
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
        <h2
          style={{
            fontFamily: 'var(--f-display)',
            fontSize: 'clamp(1.5rem, 2.5vw, 1.75rem)',
            fontWeight: 500,
            letterSpacing: '-0.01em',
            margin: 0,
          }}
        >
          Priority Email
        </h2>
        {top3.length > 0 && (
          <span className="smallcaps" style={{ color: 'var(--gray-soft)' }} aria-hidden="true">
            Top {top3.length}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          color: 'var(--gray)',
          fontSize: 14,
          marginBottom: 14,
        }}
      >
        Sourced from Gmail’s{' '}
        <span style={{ fontFamily: 'var(--f-mono)', fontStyle: 'normal', fontSize: 12.5 }}>
          IMPORTANT
        </span>{' '}
        label. Aria’s own classifier replaces this in Phase 3.
      </div>
      {error && (
        <div
          data-testid="section-error-email"
          style={{
            background: 'rgba(184,73,58,0.08)',
            color: 'var(--rose)',
            border: '1px solid rgba(184,73,58,0.25)',
            padding: '10px 14px',
            borderRadius: 6,
            marginBottom: 12,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}
      {showSc2Fallback && (
        <Card style={{ borderLeft: '2px solid var(--gold)' }}>
          <div
            className="smallcaps"
            style={{ color: 'var(--gold)', marginBottom: 6 }}
            aria-hidden="true"
          >
            Phase 2 limitation · documented
          </div>
          <p
            data-testid="email-sc2-fallback"
            style={{ margin: 0, fontSize: '1rem', color: 'var(--ink)', lineHeight: 1.55 }}
          >
            {NO_IMPORTANT_LABEL_COPY}
          </p>
        </Card>
      )}
      {!error && top3.length === 0 && !showSc2Fallback && (
        <p style={{ fontStyle: 'italic', color: 'var(--gray)', margin: 0 }}>No items today.</p>
      )}
      {top3.length > 0 && (
        <Card>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {top3.map((it) => (
              <BriefingItemRow key={it.id} item={it} testId={`email-item-${it.id}`} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

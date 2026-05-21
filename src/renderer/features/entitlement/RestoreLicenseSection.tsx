/**
 * Plan 08.1-03 Task 5 — RestoreLicenseSection.
 * Redesigned to match design-ref (SETTINGS · RESTORE layout).
 */
import { ActivateLicenseForm } from './ActivateLicenseForm';

const HELP_URL = 'https://aria.app/help/restore';

export function RestoreLicenseSection(): JSX.Element {
  return (
    <section
      data-testid="restore-license-section"
      style={{ padding: '40px 48px', maxWidth: 860, fontFamily: 'var(--f-body)', color: 'var(--ink)' }}
    >
      {/* Breadcrumb */}
      <div style={{
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        letterSpacing: '0.2em',
        textTransform: 'uppercase',
        color: 'var(--gold)',
        marginBottom: 10,
      }}>
        Settings · Restore
      </div>

      {/* Heading */}
      <h2 style={{
        fontFamily: 'var(--f-display)',
        fontSize: 32,
        fontWeight: 400,
        color: 'var(--ink)',
        margin: '0 0 12px',
        borderBottom: '1px solid var(--rule)',
        paddingBottom: 16,
      }}>
        Restore from email
      </h2>

      {/* Description */}
      <p style={{
        fontFamily: 'var(--f-body)',
        fontSize: 14,
        fontStyle: 'italic',
        color: 'var(--ink-soft, #6b6455)',
        lineHeight: 1.6,
        margin: '0 0 28px',
        maxWidth: 560,
      }}>
        Check your email for a message from Aria with the subject 'Your Aria
        license key'. The key starts with ARIA-.
      </p>

      {/* Form card */}
      <div style={{
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius)',
        padding: '24px 28px',
        background: 'var(--paper)',
        maxWidth: 680,
      }}>
        <ActivateLicenseForm />
      </div>

      {/* Help link */}
      <p style={{
        marginTop: 20,
        fontSize: 13,
        color: 'var(--ink-soft, #6b6455)',
        fontFamily: 'var(--f-body)',
      }}>
        Didn't get the email?{' '}
        <a
          href={HELP_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="restore-help-link"
          onClick={(e) => {
            e.preventDefault();
            try {
              window.open(HELP_URL, '_blank', 'noopener,noreferrer');
            } catch {
              window.location.href = HELP_URL;
            }
          }}
          style={{
            color: 'var(--gold)',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
            fontFamily: 'var(--f-body)',
          }}
        >
          Open the restore help page →
        </a>
      </p>
    </section>
  );
}

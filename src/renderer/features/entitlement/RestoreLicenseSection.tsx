/**
 * Plan 08.1-03 Task 5 — RestoreLicenseSection.
 *
 * Heading + email-restore copy + paste form. Re-uses ActivateLicenseForm so
 * there's a single inline-error surface for the activation flow.
 *
 * "Didn't get the email?" link points to a static help URL (TBD until release
 * — operator confirms before shipping; the URL is a placeholder constant).
 */
import { ActivateLicenseForm } from './ActivateLicenseForm';

const HELP_URL = 'https://aria.app/help/restore';

export function RestoreLicenseSection(): JSX.Element {
  return (
    <section
      data-testid="restore-license-section"
      style={{ padding: 32, maxWidth: '64rem', margin: '0 auto', background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        Settings · Account
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 28,
          fontWeight: 500,
          color: 'var(--ink)',
          marginTop: 0,
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 12,
        }}
      >
        Restore from email
      </h2>
      <p style={{ fontSize: 14, color: 'var(--ink-soft)', maxWidth: 640, fontFamily: 'var(--f-body)' }}>
        Check your email for a message from Aria with the subject "Your Aria
        license key". The key starts with <code>ARIA-</code>. Paste it below
        to activate Pro on this device.
      </p>
      <div style={{ marginTop: 12 }}>
        <ActivateLicenseForm />
      </div>
      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--gray)', fontFamily: 'var(--f-body)' }}>
        Didn't get the email?{' '}
        <a
          href={HELP_URL}
          target="_blank"
          rel="noreferrer"
          data-testid="restore-help-link"
          onClick={(e) => {
            // Inside Electron the renderer's default anchor handler is blocked;
            // forward to main's openExternal via window.open which Electron
            // routes through shell. If unavailable, fall back to the default
            // browser via assignment as a last resort.
            e.preventDefault();
            try {
              window.open(HELP_URL, '_blank', 'noopener,noreferrer');
            } catch {
              window.location.href = HELP_URL;
            }
          }}
          style={{ color: 'var(--ink)', textDecoration: 'underline' }}
        >
          Open the restore help page
        </a>
        .
      </p>
    </section>
  );
}

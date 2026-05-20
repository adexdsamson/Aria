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
    <section data-testid="restore-license-section" style={{ padding: 'var(--aria-space-xl)' }}>
      <h2 style={{ marginTop: 0 }}>Restore from email</h2>
      <p style={{ fontSize: 13, color: '#374151', maxWidth: 640 }}>
        Check your email for a message from Aria with the subject "Your Aria
        license key". The key starts with <code>ARIA-</code>. Paste it below
        to activate Pro on this device.
      </p>
      <div style={{ marginTop: 12 }}>
        <ActivateLicenseForm />
      </div>
      <p style={{ marginTop: 16, fontSize: 12, color: '#6b7280' }}>
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
          style={{ color: 'var(--aria-accent-fg, #2563eb)' }}
        >
          Open the restore help page
        </a>
        .
      </p>
    </section>
  );
}

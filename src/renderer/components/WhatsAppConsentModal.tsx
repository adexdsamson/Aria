/**
 * WhatsApp pre-QR consent modal (D-05/D-06/D-07 / WA-02 / SC-1).
 *
 * The "Show QR code" action is DISABLED until the editorial Checkbox is
 * acknowledged. This is the hard gate: QR generation does not begin until
 * the user confirms they understand the ban-risk and the unofficial-protocol
 * nature of the Baileys integration.
 *
 * D-06: The "use a secondary number" recommendation is an emphasized callout
 * with `borderTop: 2px solid var(--rose)` — not buried in a bullet.
 *
 * D-07: `disabled={!acknowledged}` on the primary action is the SC-1 gate.
 * The WHATSAPP_LINK IPC is NOT callable before this modal confirms ack.
 */
import { useState, useEffect } from 'react';
import { Button, Checkbox } from './editorial';

export interface WhatsAppConsentModalProps {
  open: boolean;
  onClose: () => void;
  /** Called only after acknowledgement — triggers WHATSAPP_LINK in the parent. */
  onShowQr: () => void;
}

export function WhatsAppConsentModal({
  open,
  onClose,
  onShowQr,
}: WhatsAppConsentModalProps): JSX.Element | null {
  const [acknowledged, setAcknowledged] = useState(false);

  // Reset ack state when modal opens/closes
  useEffect(() => {
    if (!open) setAcknowledged(false);
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        zIndex: 9999,
        fontFamily: 'var(--f-body)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Link WhatsApp"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule-strong)',
          borderTop: '2px solid var(--gold)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 30px 80px rgba(26,26,26,0.22)',
          width: 'min(520px, 92vw)',
          overflow: 'hidden',
          color: 'var(--ink)',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 22px',
            background: 'var(--ivory-deep)',
            borderBottom: '1px solid var(--rule)',
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
              marginBottom: 4,
            }}
          >
            WhatsApp · Unofficial protocol
          </div>
          <h3
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              lineHeight: 1.2,
              margin: 0,
            }}
          >
            Before you link WhatsApp
          </h3>
        </div>

        {/* Body */}
        <div style={{ padding: '18px 22px' }}>
          <p
            style={{
              margin: '0 0 14px',
              fontSize: 14,
              lineHeight: 1.55,
              color: 'var(--ink)',
            }}
          >
            Aria connects to WhatsApp via an unofficial third-party library. Please read
            the following before linking your number:
          </p>

          {/* Risk bullets */}
          <ul
            style={{
              margin: '0 0 16px',
              paddingLeft: 20,
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--ink)',
            }}
          >
            <li style={{ marginBottom: 6 }}>
              <strong>Unofficial protocol.</strong> Aria uses a reverse-engineered
              WhatsApp client (Baileys), which is not endorsed or supported by WhatsApp /
              Meta.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Account ban risk.</strong> Meta may ban or restrict accounts that
              use unofficial clients. This risk is low for normal use but non-zero and
              cannot be fully mitigated.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>No guarantees.</strong> Message delivery and receipt behaviour may
              differ from the official app. Aria uses passive read-only mode and never
              sends messages on your behalf.
            </li>
            <li>
              <strong>Local data only.</strong> All WhatsApp content stays on your
              machine. Aria never uploads message content to cloud services.
            </li>
          </ul>

          {/* D-06: Emphasized secondary-number callout */}
          <div
            style={{
              background: 'var(--ivory-deep)',
              border: '1px solid var(--rule)',
              borderTop: '2px solid var(--rose)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              marginBottom: 18,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--rose)',
                marginBottom: 4,
              }}
            >
              Recommendation
            </div>
            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}>
              <strong>Use a secondary WhatsApp number</strong> — not your primary personal or
              business number. This limits exposure if Meta flags the account for
              unofficial-client usage.
            </p>
          </div>

          {/* D-07 ack-gate: checkbox must be checked to enable Show QR code */}
          <Checkbox
            data-testid="whatsapp-consent-ack"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            label="I understand the risks of linking my WhatsApp number via an unofficial client."
          />
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 22px 16px',
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {/* D-07: disabled until acknowledged — this is the SC-1 hard gate */}
          <Button
            variant="primary"
            data-testid="whatsapp-show-qr"
            disabled={!acknowledged}
            onClick={onShowQr}
          >
            Show QR code
          </Button>
        </div>
      </div>
    </div>
  );
}

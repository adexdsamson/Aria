/**
 * WhatsApp QR linking modal (WA-01 / D-11 / D-12).
 *
 * This modal IS the linking affordance. It opens after the user acknowledges
 * the consent modal and WHATSAPP_LINK is called. It subscribes to
 * WHATSAPP_QR_UPDATE push events and renders the data-URL as an <img>.
 *
 * The QR string→data-URL conversion happens in main (Plan 20-04 via qrcode
 * synchronous SVG renderer). This modal only displays.
 *
 * D-11: On WHATSAPP_STATE_CHANGED → status 'ok', displays the phone number
 *       (JID) and the "no history" notice, then allows close.
 * D-12: QR only — no pairing-code UI in v2.1.
 *
 * Per RESEARCH Open-Question #4, the QR modal IS the linking affordance;
 * there is no AccountRow chip until provider_account row exists.
 */
import { useState, useEffect, useCallback } from 'react';
import { Button } from './editorial';
import type { WhatsAppQrUpdateDto, WhatsAppStateChangedDto } from '../../shared/ipc-contract';

export interface WhatsAppQrModalProps {
  open: boolean;
  onClose: () => void;
}

function formatCountdown(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const secs = Math.ceil(ms / 1000);
  return `Expires in ${secs}s`;
}

export function WhatsAppQrModal({ open, onClose }: WhatsAppQrModalProps): JSX.Element | null {
  const [qrDto, setQrDto] = useState<WhatsAppQrUpdateDto | null>(null);
  const [linked, setLinked] = useState<{ accountId: string | null } | null>(null);
  const [countdown, setCountdown] = useState<string | null>(null);

  // Subscribe to QR updates
  useEffect(() => {
    if (!open) return;
    const api = window.aria;
    if (!api.onWhatsappQrUpdate) return;
    const unsub = api.onWhatsappQrUpdate((dto) => {
      setQrDto(dto);
    });
    return unsub;
  }, [open]);

  // Subscribe to state changes — on 'ok', show the success/no-history notice
  useEffect(() => {
    if (!open) return;
    const api = window.aria;
    if (!api.onWhatsappStateChanged) return;
    const unsub = api.onWhatsappStateChanged((dto: WhatsAppStateChangedDto) => {
      if (dto.status === 'ok') {
        setLinked({ accountId: dto.accountId });
      }
    });
    return unsub;
  }, [open]);

  // Countdown ticker
  useEffect(() => {
    if (!qrDto?.expiresAt || linked) return;
    const tick = setInterval(() => {
      setCountdown(formatCountdown(qrDto.expiresAt));
    }, 1000);
    setCountdown(formatCountdown(qrDto.expiresAt));
    return () => clearInterval(tick);
  }, [qrDto?.expiresAt, linked]);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setQrDto(null);
      setLinked(null);
      setCountdown(null);
    }
  }, [open]);

  // Escape closes
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );
  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [open, handleEscape]);

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
        paddingTop: '10vh',
        zIndex: 9999,
        fontFamily: 'var(--f-body)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Link WhatsApp — scan QR code"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule-strong)',
          borderTop: '2px solid var(--gold)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 30px 80px rgba(26,26,26,0.22)',
          width: 'min(440px, 92vw)',
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
            WhatsApp · QR link
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
            {linked ? 'WhatsApp linked' : 'Scan to link WhatsApp'}
          </h3>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 22px', textAlign: 'center' }}>
          {linked ? (
            /* D-11: Success notice + no-history callout */
            <div style={{ textAlign: 'left' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--ivory-deep)',
                  border: '1px solid var(--rule)',
                  borderRadius: 'var(--radius)',
                  padding: '8px 14px',
                  marginBottom: 16,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: '#1f7a4d',
                    flex: '0 0 auto',
                  }}
                />
                <span
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 13,
                    color: 'var(--ink)',
                  }}
                >
                  {linked.accountId ?? 'Linked successfully'}
                </span>
              </div>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: 'var(--ink)',
                  margin: '0 0 8px',
                }}
              >
                Your WhatsApp number is now linked to Aria.
              </p>
              {/* D-11: No history notice */}
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--ink-soft, var(--ink))',
                  margin: 0,
                  fontStyle: 'italic',
                }}
              >
                No WhatsApp history before this moment is imported. Only new messages
                from tracked groups will appear in Aria.
              </p>
            </div>
          ) : qrDto ? (
            /* QR display */
            <div>
              <img
                src={qrDto.dataUrl}
                alt="WhatsApp QR code — scan with your phone"
                style={{
                  width: 240,
                  height: 240,
                  display: 'block',
                  margin: '0 auto 12px',
                  border: '1px solid var(--rule)',
                  borderRadius: 4,
                  background: '#fff',
                }}
              />
              {countdown && (
                <p
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: countdown === 'Expired' ? '#b34' : 'var(--gray-soft)',
                    margin: '0 0 4px',
                  }}
                >
                  {countdown}
                </p>
              )}
              <p
                style={{
                  fontSize: 13,
                  color: 'var(--ink-soft, var(--ink))',
                  margin: 0,
                }}
              >
                Open WhatsApp on your phone → Settings → Linked devices → Link a device.
              </p>
            </div>
          ) : (
            /* Loading state */
            <div
              style={{
                width: 240,
                height: 240,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
                border: '1px solid var(--rule)',
                borderRadius: 4,
                background: 'var(--ivory-deep)',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--gray-soft)',
                }}
              >
                Generating QR…
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 22px 16px',
            borderTop: '1px solid var(--rule)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <Button variant={linked ? 'primary' : 'ghost'} onClick={onClose}>
            {linked ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * WA-02 / D-07 — WhatsAppConsentModal spec.
 *
 * Asserts the editorial-Checkbox ack-gate:
 *   1. The "Show QR code" button (testid: whatsapp-show-qr) is `disabled`
 *      until the consent Checkbox (testid: whatsapp-consent-ack) is checked.
 *   2. onShowQr is NOT invoked while the checkbox is unchecked.
 *   3. Once the checkbox is checked, the button becomes enabled and
 *      clicking it invokes onShowQr.
 *
 * This spec RED-fails until Plan 20-07 (WhatsAppConsentModal.tsx) lands.
 * Run: npx vitest run tests/unit/renderer/whatsapp-consent.spec.ts
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Component under test — does not exist yet; RED-fails until Plan 20-07 lands.
import { WhatsAppConsentModal } from '../../../src/renderer/components/WhatsAppConsentModal';

afterEach(() => {
  cleanup();
});

describe('WhatsAppConsentModal — D-07 ack-gate (WA-02)', () => {
  it('renders the consent modal with required elements', () => {
    const onClose = vi.fn();
    const onShowQr = vi.fn();
    render(<WhatsAppConsentModal open onClose={onClose} onShowQr={onShowQr} />);

    expect(screen.getByTestId('whatsapp-consent-ack')).toBeDefined();
    expect(screen.getByTestId('whatsapp-show-qr')).toBeDefined();
  });

  it('the "Show QR code" button is disabled before the checkbox is checked', () => {
    const onClose = vi.fn();
    const onShowQr = vi.fn();
    render(<WhatsAppConsentModal open onClose={onClose} onShowQr={onShowQr} />);

    const showQrBtn = screen.getByTestId('whatsapp-show-qr') as HTMLButtonElement;
    expect(showQrBtn.disabled).toBe(true);
  });

  it('clicking "Show QR code" while unchecked does NOT invoke onShowQr', async () => {
    const onClose = vi.fn();
    const onShowQr = vi.fn();
    const user = userEvent.setup();
    render(<WhatsAppConsentModal open onClose={onClose} onShowQr={onShowQr} />);

    // Try to click the disabled button
    const showQrBtn = screen.getByTestId('whatsapp-show-qr');
    await user.click(showQrBtn);

    expect(onShowQr).not.toHaveBeenCalled();
  });

  it('the "Show QR code" button becomes enabled after checkbox is checked', async () => {
    const onClose = vi.fn();
    const onShowQr = vi.fn();
    const user = userEvent.setup();
    render(<WhatsAppConsentModal open onClose={onClose} onShowQr={onShowQr} />);

    const checkbox = screen.getByTestId('whatsapp-consent-ack') as HTMLInputElement;
    await user.click(checkbox);

    const showQrBtn = screen.getByTestId('whatsapp-show-qr') as HTMLButtonElement;
    expect(showQrBtn.disabled).toBe(false);
  });

  it('once checked, clicking "Show QR code" invokes onShowQr', async () => {
    const onClose = vi.fn();
    const onShowQr = vi.fn();
    const user = userEvent.setup();
    render(<WhatsAppConsentModal open onClose={onClose} onShowQr={onShowQr} />);

    const checkbox = screen.getByTestId('whatsapp-consent-ack');
    await user.click(checkbox);

    const showQrBtn = screen.getByTestId('whatsapp-show-qr');
    await user.click(showQrBtn);

    expect(onShowQr).toHaveBeenCalledOnce();
  });

  it('modal displays risk disclosure content (ban-risk callout)', () => {
    const onClose = vi.fn();
    const onShowQr = vi.fn();
    render(<WhatsAppConsentModal open onClose={onClose} onShowQr={onShowQr} />);

    // Should contain some risk warning — the exact copy is at Claude's discretion
    // but must mention the secondary-number recommendation (D-06)
    const body = document.body.textContent ?? '';
    expect(body.length).toBeGreaterThan(0);
    // Must mention secondary number (D-06 hard callout)
    expect(body.toLowerCase()).toMatch(/secondary|second/);
  });

  it('modal does not render when open=false', () => {
    const onClose = vi.fn();
    const onShowQr = vi.fn();
    const { container } = render(
      <WhatsAppConsentModal open={false} onClose={onClose} onShowQr={onShowQr} />,
    );
    // When not open, the interactive elements should not be present
    expect(screen.queryByTestId('whatsapp-consent-ack')).toBeNull();
  });
});

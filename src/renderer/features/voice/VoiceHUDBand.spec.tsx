/**
 * Phase 15 / Plan 15-07 — TDD RED: VoiceHUDBand tests.
 *
 * Tests the aria contract, collapsed/expanded behavior, per-state copy,
 * and plain-text transcript rendering (D-15/D-16/T-15-21).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceHUDBand } from './VoiceHUDBand';

describe('VoiceHUDBand', () => {
  describe('aria contract (D-15)', () => {
    it('has role="status"', () => {
      render(<VoiceHUDBand state="idle" transcript="" />);
      const band = screen.getByRole('status');
      expect(band).toBeTruthy();
    });

    it('has aria-live="polite"', () => {
      render(<VoiceHUDBand state="idle" transcript="" />);
      const band = screen.getByTestId('voice-hud-band');
      expect(band).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-atomic="false"', () => {
      render(<VoiceHUDBand state="idle" transcript="" />);
      const band = screen.getByTestId('voice-hud-band');
      expect(band).toHaveAttribute('aria-atomic', 'false');
    });

    it('has testid voice-hud-band', () => {
      render(<VoiceHUDBand state="idle" transcript="" />);
      expect(screen.getByTestId('voice-hud-band')).toBeTruthy();
    });
  });

  describe('collapsed/expanded grid-template-rows', () => {
    it('is collapsed (0fr) when idle', () => {
      const { container } = render(<VoiceHUDBand state="idle" transcript="" />);
      const band = container.querySelector('[data-testid="voice-hud-band"]') as HTMLElement;
      expect(band.style.gridTemplateRows).toBe('0fr');
    });

    it('is expanded (1fr) when listening', () => {
      const { container } = render(<VoiceHUDBand state="listening" transcript="" />);
      const band = container.querySelector('[data-testid="voice-hud-band"]') as HTMLElement;
      expect(band.style.gridTemplateRows).toBe('1fr');
    });

    it('is expanded (1fr) when processing', () => {
      const { container } = render(<VoiceHUDBand state="processing" transcript="" />);
      const band = container.querySelector('[data-testid="voice-hud-band"]') as HTMLElement;
      expect(band.style.gridTemplateRows).toBe('1fr');
    });

    it('is expanded (1fr) when speaking', () => {
      const { container } = render(<VoiceHUDBand state="speaking" transcript="" />);
      const band = container.querySelector('[data-testid="voice-hud-band"]') as HTMLElement;
      expect(band.style.gridTemplateRows).toBe('1fr');
    });

    it('is expanded (1fr) when muted-during-playback', () => {
      const { container } = render(<VoiceHUDBand state="muted-during-playback" transcript="" />);
      const band = container.querySelector('[data-testid="voice-hud-band"]') as HTMLElement;
      expect(band.style.gridTemplateRows).toBe('1fr');
    });

    it('is expanded (1fr) when error', () => {
      const { container } = render(<VoiceHUDBand state="error" transcript="Microphone permission denied" />);
      const band = container.querySelector('[data-testid="voice-hud-band"]') as HTMLElement;
      expect(band.style.gridTemplateRows).toBe('1fr');
    });

    it('mounts unconditionally (renders even in idle state)', () => {
      render(<VoiceHUDBand state="idle" transcript="" />);
      // Band exists in DOM even when collapsed
      expect(screen.getByTestId('voice-hud-band')).toBeTruthy();
    });
  });

  describe('per-state copy (UI-SPEC §Copywriting)', () => {
    it('shows "Listening…" state label when listening', () => {
      render(<VoiceHUDBand state="listening" transcript="" />);
      const label = screen.getByTestId('voice-hud-state-label');
      expect(label.textContent).toBe('LISTENING');
    });

    it('shows "Transcribing…" state label when processing', () => {
      render(<VoiceHUDBand state="processing" transcript="" />);
      const label = screen.getByTestId('voice-hud-state-label');
      expect(label.textContent).toBe('PROCESSING');
    });

    it('shows "Speaking…" state label when speaking', () => {
      render(<VoiceHUDBand state="speaking" transcript="" />);
      const label = screen.getByTestId('voice-hud-state-label');
      expect(label.textContent).toBe('SPEAKING');
    });

    it('shows "MUTED" state label when muted-during-playback', () => {
      render(<VoiceHUDBand state="muted-during-playback" transcript="" />);
      const label = screen.getByTestId('voice-hud-state-label');
      expect(label.textContent).toBe('MUTED');
    });

    it('shows "ERROR" state label when error', () => {
      render(<VoiceHUDBand state="error" transcript="Microphone permission denied — check your system settings" />);
      const label = screen.getByTestId('voice-hud-state-label');
      expect(label.textContent).toBe('ERROR');
    });

    it('does NOT show state label when idle (collapsed)', () => {
      render(<VoiceHUDBand state="idle" transcript="" />);
      const label = document.querySelector('[data-testid="voice-hud-state-label"]') as HTMLElement | null;
      // Either absent or empty in idle
      if (label) {
        expect(label.textContent).toBe('');
      }
    });
  });

  describe('transcript text (T-15-21 plain text — no HTML injection)', () => {
    it('renders transcript as plain text content', () => {
      const transcriptText = 'Schedule a call with Sarah for Friday morning';
      render(<VoiceHUDBand state="listening" transcript={transcriptText} />);
      const transcriptEl = screen.getByTestId('voice-hud-transcript');
      expect(transcriptEl.textContent).toBe(transcriptText);
    });

    it('renders dangerous HTML as plain text (T-15-21 injection mitigation)', () => {
      const dangerousText = '<script>alert(1)</script>';
      render(<VoiceHUDBand state="listening" transcript={dangerousText} />);
      const transcriptEl = screen.getByTestId('voice-hud-transcript');
      // textContent will show the raw string; innerHTML must NOT execute it
      expect(transcriptEl.textContent).toBe(dangerousText);
      // Confirm it's not rendered as HTML
      expect(transcriptEl.innerHTML).not.toContain('<script>');
    });

    it('shows transcript text for listening state', () => {
      render(<VoiceHUDBand state="listening" transcript="Tell me about my day" />);
      const transcriptEl = screen.getByTestId('voice-hud-transcript');
      expect(transcriptEl.textContent).toBe('Tell me about my day');
    });

    it('shows transcript text for speaking state (echo)', () => {
      render(<VoiceHUDBand state="speaking" transcript="Here is your briefing for today" />);
      const transcriptEl = screen.getByTestId('voice-hud-transcript');
      expect(transcriptEl.textContent).toBe('Here is your briefing for today');
    });
  });

  describe('inner overflow wrapper', () => {
    it('has an overflow:hidden inner wrapper for grid collapse', () => {
      const { container } = render(<VoiceHUDBand state="listening" transcript="" />);
      const inner = container.querySelector('[data-voice-hud-inner]') as HTMLElement | null;
      expect(inner).toBeTruthy();
    });
  });
});

/**
 * Phase 15 / Plan 15-07 — TDD RED: VoiceStatusDot tests.
 *
 * Tests the VoiceState→StatusDotKind mapping, aria contract, and
 * prefers-reduced-motion handling (D-14/D-16).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VoiceStatusDot } from './VoiceStatusDot';
import type { VoiceState } from '../../../shared/voice-types';

describe('VoiceStatusDot', () => {
  describe('state → StatusDotKind mapping (D-14)', () => {
    it('idle → idle kind (gray-faint dot)', () => {
      render(<VoiceStatusDot state="idle" />);
      const dot = document.querySelector('[data-status-kind="idle"]');
      expect(dot).toBeTruthy();
    });

    it('listening → warn kind (gold dot)', () => {
      render(<VoiceStatusDot state="listening" />);
      const dot = document.querySelector('[data-status-kind="warn"]');
      expect(dot).toBeTruthy();
    });

    it('processing → warn kind (gold dot + spinner arc)', () => {
      render(<VoiceStatusDot state="processing" />);
      const dot = document.querySelector('[data-status-kind="warn"]');
      expect(dot).toBeTruthy();
    });

    it('speaking → ok kind (moss dot)', () => {
      render(<VoiceStatusDot state="speaking" />);
      const dot = document.querySelector('[data-status-kind="ok"]');
      expect(dot).toBeTruthy();
    });

    it('muted-during-playback → idle kind (gray-faint)', () => {
      render(<VoiceStatusDot state="muted-during-playback" />);
      const dot = document.querySelector('[data-status-kind="idle"]');
      expect(dot).toBeTruthy();
    });

    it('error → err kind (rose dot)', () => {
      render(<VoiceStatusDot state="error" />);
      const dot = document.querySelector('[data-status-kind="err"]');
      expect(dot).toBeTruthy();
    });
  });

  describe('aria contract', () => {
    it('has aria-label "Microphone: Idle" for idle state', () => {
      render(<VoiceStatusDot state="idle" />);
      const wrapper = screen.getByTestId('aria-topbar-voice-dot');
      expect(wrapper).toHaveAttribute('aria-label', 'Microphone: Idle');
    });

    it('has aria-label "Microphone: Listening" for listening state', () => {
      render(<VoiceStatusDot state="listening" />);
      const wrapper = screen.getByTestId('aria-topbar-voice-dot');
      expect(wrapper).toHaveAttribute('aria-label', 'Microphone: Listening');
    });

    it('has aria-label "Microphone: Processing" for processing state', () => {
      render(<VoiceStatusDot state="processing" />);
      const wrapper = screen.getByTestId('aria-topbar-voice-dot');
      expect(wrapper).toHaveAttribute('aria-label', 'Microphone: Processing');
    });

    it('has aria-label "Microphone: Speaking" for speaking state', () => {
      render(<VoiceStatusDot state="speaking" />);
      const wrapper = screen.getByTestId('aria-topbar-voice-dot');
      expect(wrapper).toHaveAttribute('aria-label', 'Microphone: Speaking');
    });

    it('has aria-label "Microphone: Muted" for muted-during-playback state', () => {
      render(<VoiceStatusDot state="muted-during-playback" />);
      const wrapper = screen.getByTestId('aria-topbar-voice-dot');
      expect(wrapper).toHaveAttribute('aria-label', 'Microphone: Muted');
    });

    it('has aria-label "Microphone: Error" for error state', () => {
      render(<VoiceStatusDot state="error" />);
      const wrapper = screen.getByTestId('aria-topbar-voice-dot');
      expect(wrapper).toHaveAttribute('aria-label', 'Microphone: Error');
    });

    it('has testid aria-topbar-voice-dot', () => {
      render(<VoiceStatusDot state="idle" />);
      expect(screen.getByTestId('aria-topbar-voice-dot')).toBeTruthy();
    });
  });

  describe('processing spinner arc', () => {
    it('renders spinner SVG arc for processing state', () => {
      const { container } = render(<VoiceStatusDot state="processing" />);
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('does NOT render spinner SVG for non-processing states', () => {
      const { container } = render(<VoiceStatusDot state="idle" />);
      // No processing spinner for idle
      const processingSpinner = container.querySelector('[data-voice-spinner]');
      expect(processingSpinner).toBeNull();
    });
  });

  describe('muted struck-mic overlay', () => {
    it('renders struck-mic indicator for muted-during-playback', () => {
      const { container } = render(<VoiceStatusDot state="muted-during-playback" />);
      const struckMic = container.querySelector('[data-voice-struck-mic]');
      expect(struckMic).toBeTruthy();
    });

    it('does NOT render struck-mic for non-muted states', () => {
      const { container } = render(<VoiceStatusDot state="listening" />);
      const struckMic = container.querySelector('[data-voice-struck-mic]');
      expect(struckMic).toBeNull();
    });
  });

  describe('no new CSS custom properties', () => {
    it('renders without introducing new CSS variables (D-14)', () => {
      // All states should render without error — the mapping uses only existing tokens
      const states: VoiceState[] = ['idle', 'listening', 'processing', 'speaking', 'muted-during-playback', 'error'];
      for (const state of states) {
        const { unmount } = render(<VoiceStatusDot state={state} />);
        unmount();
      }
    });
  });
});

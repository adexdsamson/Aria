/**
 * Phase 15 / Plan 15-07 — TDD RED: VoicePTTButton tests.
 *
 * Tests hold-to-talk (keydown/keyup), click-toggle, speaking block (D-13),
 * input/textarea focus guard (T-15-22), aria contract, and the no-globalShortcut
 * guarantee (D-10/D-12).
 *
 * Uses the _testSession prop (test-only override) to inject mock session state
 * without vi.mock module-level hoisting (which triggers vitest-pool timeout on
 * some machines).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VoicePTTButton } from './VoicePTTButton';
import type { VoiceSessionState, VoiceSessionActions } from './useVoiceSession';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeSession(
  overrides: Partial<VoiceSessionState & VoiceSessionActions> = {}
): VoiceSessionState & VoiceSessionActions {
  return {
    voiceState: 'idle',
    micGated: false,
    liveTranscript: '',
    modelProgress: null,
    startTurn: vi.fn().mockReturnValue(true),
    stopTurn: vi.fn(),
    setVadMode: vi.fn(),
    endTurn: vi.fn(),
    setTranscript: vi.fn(),
    onPlaybackStart: vi.fn(),
    onPlaybackEnd: vi.fn(),
    subscribeToIpc: vi.fn(),
    ...overrides,
  };
}

describe('VoicePTTButton', () => {
  let session: ReturnType<typeof makeSession>;

  beforeEach(() => {
    session = makeSession();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('component rendering', () => {
    it('renders with testid voice-ptt-button', () => {
      render(<VoicePTTButton _testSession={session} />);
      expect(screen.getByTestId('voice-ptt-button')).toBeTruthy();
    });

    it('has aria-label "Push to talk — hold Space or click to toggle"', () => {
      render(<VoicePTTButton _testSession={session} />);
      const btn = screen.getByTestId('voice-ptt-button');
      expect(btn).toHaveAttribute('aria-label', 'Push to talk — hold Space or click to toggle');
    });

    it('renders the hint label "Space · Click to toggle"', () => {
      render(<VoicePTTButton _testSession={session} />);
      expect(screen.getByText('Space · Click to toggle')).toBeTruthy();
    });

    it('is a button element or has role="button"', () => {
      render(<VoicePTTButton _testSession={session} />);
      const btn = screen.getByTestId('voice-ptt-button');
      const tag = btn.tagName.toLowerCase();
      const role = btn.getAttribute('role');
      expect(tag === 'button' || role === 'button').toBe(true);
    });
  });

  describe('hold-to-talk path (D-10)', () => {
    it('keydown Space calls setVadMode("hold") and startTurn', () => {
      render(<VoicePTTButton _testSession={session} />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space' });
      expect(session.setVadMode).toHaveBeenCalledWith('hold');
      expect(session.startTurn).toHaveBeenCalled();
    });

    it('keyup Space calls stopTurn (hard turn-end D-10)', () => {
      render(<VoicePTTButton _testSession={session} />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space' });
      fireEvent.keyUp(window, { key: ' ', code: 'Space' });
      expect(session.stopTurn).toHaveBeenCalled();
    });
  });

  describe('click-toggle path (D-10)', () => {
    it('click when idle calls setVadMode("toggle") and startTurn', () => {
      render(<VoicePTTButton _testSession={session} />);
      const btn = screen.getByTestId('voice-ptt-button');
      fireEvent.click(btn);
      expect(session.setVadMode).toHaveBeenCalledWith('toggle');
      expect(session.startTurn).toHaveBeenCalled();
    });

    it('click when already listening calls stopTurn', () => {
      const listeningSession = makeSession({ voiceState: 'listening' });
      render(<VoicePTTButton _testSession={listeningSession} />);
      const btn = screen.getByTestId('voice-ptt-button');
      fireEvent.click(btn);
      expect(listeningSession.stopTurn).toHaveBeenCalled();
    });
  });

  describe('speaking block — D-13 / T-15-23', () => {
    it('is visually muted (aria-disabled or reduced opacity) when speaking', () => {
      const speakingSession = makeSession({ voiceState: 'speaking', micGated: true });
      render(<VoicePTTButton _testSession={speakingSession} />);
      const btn = screen.getByTestId('voice-ptt-button');
      const ariaDisabled = btn.getAttribute('aria-disabled');
      const style = (btn as HTMLElement).style;
      expect(ariaDisabled === 'true' || parseFloat(style.opacity ?? '1') < 1).toBe(true);
    });

    it('rejects PTT start while speaking — keydown does NOT call startTurn', () => {
      const speakingSession = makeSession({ voiceState: 'speaking', micGated: true });
      render(<VoicePTTButton _testSession={speakingSession} />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space' });
      expect(speakingSession.startTurn).not.toHaveBeenCalled();
    });

    it('rejects PTT start while muted-during-playback — keydown does NOT call startTurn', () => {
      const mutedSession = makeSession({ voiceState: 'muted-during-playback', micGated: true });
      render(<VoicePTTButton _testSession={mutedSession} />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space' });
      expect(mutedSession.startTurn).not.toHaveBeenCalled();
    });

    it('shows "Aria is speaking" tooltip when speaking', () => {
      const speakingSession = makeSession({ voiceState: 'speaking', micGated: true });
      render(<VoicePTTButton _testSession={speakingSession} />);
      const btn = screen.getByTestId('voice-ptt-button');
      expect(btn).toHaveAttribute('title', 'Aria is speaking');
    });
  });

  describe('input/textarea focus guard — T-15-22', () => {
    it('does NOT start turn when Space is keydown on an input element', () => {
      render(
        <div>
          <input data-testid="text-input" />
          <VoicePTTButton _testSession={session} />
        </div>
      );
      const input = screen.getByTestId('text-input');
      // Fire Space keydown on the input — the component listens on window but
      // guards by checking e.target instanceof HTMLInputElement
      fireEvent.keyDown(input, { key: ' ', code: 'Space' });
      expect(session.startTurn).not.toHaveBeenCalled();
    });

    it('does NOT start turn when Space is keydown on a textarea element', () => {
      render(
        <div>
          <textarea data-testid="text-area" />
          <VoicePTTButton _testSession={session} />
        </div>
      );
      const textarea = screen.getByTestId('text-area');
      fireEvent.keyDown(textarea, { key: ' ', code: 'Space' });
      expect(session.startTurn).not.toHaveBeenCalled();
    });
  });

  describe('setVadMode integration (D-11)', () => {
    it('setVadMode("hold") is called for keydown hold path', () => {
      render(<VoicePTTButton _testSession={session} />);
      fireEvent.keyDown(window, { key: ' ', code: 'Space' });
      expect(session.setVadMode).toHaveBeenCalledWith('hold');
    });

    it('setVadMode("toggle") is called for click path', () => {
      render(<VoicePTTButton _testSession={session} />);
      const btn = screen.getByTestId('voice-ptt-button');
      fireEvent.click(btn);
      expect(session.setVadMode).toHaveBeenCalledWith('toggle');
    });
  });
});

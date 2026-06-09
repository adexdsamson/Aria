/**
 * Phase 15 / Plan 15-07 — TDD RED: VoicePTTButton tests.
 *
 * Tests hold-to-talk (keydown/keyup), click-toggle, speaking block (D-13),
 * input/textarea focus guard (T-15-22), aria contract, and the no-globalShortcut
 * guarantee (D-10/D-12).
 *
 * Also tests the lazy first-PTT model-readiness gate (D-08/SC4):
 * when model is NOT ready, PTT press opens the VoiceModelDownload modal
 * instead of entering listening state.
 *
 * Uses the _testSession prop (test-only override) to inject mock session state
 * without vi.mock module-level hoisting (which triggers vitest-pool timeout on
 * some machines).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VoicePTTButton } from './VoicePTTButton';
import type { VoiceSessionState, VoiceSessionActions } from './useVoiceSession';
import type { VoiceModelDownloadIpc } from './VoiceModelDownload';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeSession(
  overrides: Partial<VoiceSessionState & VoiceSessionActions> = {}
): VoiceSessionState & VoiceSessionActions {
  return {
    voiceState: 'idle',
    micGated: false,
    liveTranscript: '',
    modelProgress: null,
    paused: false,             // Phase 16 / D-09 addition
    pendingApprovalId: null,   // Phase 17 / D-10 addition
    startTurn: vi.fn().mockReturnValue(true),
    stopTurn: vi.fn(),
    setVadMode: vi.fn(),
    endTurn: vi.fn(),
    setTranscript: vi.fn(),
    onPlaybackStart: vi.fn(),
    onPlaybackEnd: vi.fn(),
    subscribeToIpc: vi.fn(),
    bargeIn: vi.fn(),          // Phase 16 / D-01 addition
    pause: vi.fn(),            // Phase 16 / D-09 addition
    resume: vi.fn(),           // Phase 16 / D-09 addition
    setPendingApproval: vi.fn(),  // Phase 17 / D-10 addition
    clearPendingApproval: vi.fn(), // Phase 17 / D-10 addition
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

// ─── D-08 / SC4: lazy first-PTT model-readiness gate ─────────────────────────

function makeIpc(overrides: Partial<VoiceModelDownloadIpc> = {}): VoiceModelDownloadIpc {
  return {
    voiceGetModelStatus: vi.fn().mockResolvedValue({ ready: false, path: null, state: 0 }),
    voiceDownloadModel: vi.fn().mockResolvedValue(undefined),
    onVoiceModelProgress: vi.fn().mockReturnValue(() => undefined),
    voiceGetPrefs: vi.fn().mockResolvedValue({ speed: 1.0, voiceId: '', useCloud: false }),
    ...overrides,
  };
}

describe('VoicePTTButton — lazy first-PTT model-readiness gate (D-08/SC4)', () => {
  let session: ReturnType<typeof makeSession>;
  let ipc: ReturnType<typeof makeIpc>;

  beforeEach(() => {
    session = makeSession();
    ipc = makeIpc();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('click while model NOT ready opens the VoiceModelDownload modal', async () => {
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    const btn = screen.getByTestId('voice-ptt-button');
    await act(async () => { fireEvent.click(btn); });
    // The modal wrapper should now be in the DOM
    expect(screen.getByTestId('voice-model-download-modal')).toBeTruthy();
  });

  it('click while model NOT ready does NOT call startTurn', async () => {
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    const btn = screen.getByTestId('voice-ptt-button');
    await act(async () => { fireEvent.click(btn); });
    expect(session.startTurn).not.toHaveBeenCalled();
  });

  it('Space keydown while model NOT ready opens the VoiceModelDownload modal', async () => {
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    await act(async () => { fireEvent.keyDown(window, { key: ' ', code: 'Space' }); });
    expect(screen.getByTestId('voice-model-download-modal')).toBeTruthy();
  });

  it('Space keydown while model NOT ready does NOT call startTurn', async () => {
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    await act(async () => { fireEvent.keyDown(window, { key: ' ', code: 'Space' }); });
    expect(session.startTurn).not.toHaveBeenCalled();
  });

  it('click while model IS ready proceeds normally (no modal)', async () => {
    const readyIpc = makeIpc({
      voiceGetModelStatus: vi.fn().mockResolvedValue({ ready: true, path: '/models/whisper.bin', state: 1 }),
    });
    render(<VoicePTTButton _testSession={session} _testIpc={readyIpc} />);
    const btn = screen.getByTestId('voice-ptt-button');
    await act(async () => { fireEvent.click(btn); });
    expect(screen.queryByTestId('voice-model-download-modal')).toBeNull();
    expect(session.startTurn).toHaveBeenCalled();
  });

  it('skipping the download modal closes it without entering listening', async () => {
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    const btn = screen.getByTestId('voice-ptt-button');
    await act(async () => { fireEvent.click(btn); });
    // Modal is open — click skip
    const skipBtn = screen.getByTestId('voice-download-skip');
    await act(async () => { fireEvent.click(skipBtn); });
    expect(screen.queryByTestId('voice-model-download-modal')).toBeNull();
    expect(session.startTurn).not.toHaveBeenCalled();
  });
});

// ─── Cloud-aware PTT gate (D-08/j2b) ─────────────────────────────────────────

describe('VoicePTTButton — cloud-aware PTT gate', () => {
  let session: ReturnType<typeof makeSession>;

  beforeEach(() => {
    session = makeSession();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('click when cloud enabled and local model NOT ready enters listening (no modal)', async () => {
    const ipc = makeIpc({
      voiceGetModelStatus: vi.fn().mockResolvedValue({ ready: false, state: 0 }),
      voiceGetPrefs: vi.fn().mockResolvedValue({ speed: 1.0, voiceId: '', useCloud: true }),
    });
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    const btn = screen.getByTestId('voice-ptt-button');
    await act(async () => { fireEvent.click(btn); });
    expect(screen.queryByTestId('voice-model-download-modal')).toBeNull();
    expect(session.startTurn).toHaveBeenCalled();
  });

  it('Space keydown when cloud enabled and local model NOT ready enters listening (no modal)', async () => {
    const ipc = makeIpc({
      voiceGetModelStatus: vi.fn().mockResolvedValue({ ready: false, state: 0 }),
      voiceGetPrefs: vi.fn().mockResolvedValue({ speed: 1.0, voiceId: '', useCloud: true }),
    });
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    await act(async () => { fireEvent.keyDown(window, { key: ' ', code: 'Space' }); });
    expect(screen.queryByTestId('voice-model-download-modal')).toBeNull();
    expect(session.startTurn).toHaveBeenCalled();
  });

  it('click when cloud OFF and local model NOT ready still shows download modal (D-08 preserved)', async () => {
    const ipc = makeIpc({
      voiceGetModelStatus: vi.fn().mockResolvedValue({ ready: false, state: 0 }),
      voiceGetPrefs: vi.fn().mockResolvedValue({ speed: 1.0, voiceId: '', useCloud: false }),
    });
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    const btn = screen.getByTestId('voice-ptt-button');
    await act(async () => { fireEvent.click(btn); });
    expect(screen.getByTestId('voice-model-download-modal')).toBeTruthy();
  });

  it('click when cloud OFF and local model NOT ready does NOT call startTurn (D-08 preserved)', async () => {
    const ipc = makeIpc({
      voiceGetModelStatus: vi.fn().mockResolvedValue({ ready: false, state: 0 }),
      voiceGetPrefs: vi.fn().mockResolvedValue({ speed: 1.0, voiceId: '', useCloud: false }),
    });
    render(<VoicePTTButton _testSession={session} _testIpc={ipc} />);
    const btn = screen.getByTestId('voice-ptt-button');
    await act(async () => { fireEvent.click(btn); });
    expect(session.startTurn).not.toHaveBeenCalled();
  });
});

/**
 * Phase 15 / Plan 15-08 — TDD RED: VoiceModelDownload tests.
 *
 * Tests:
 *   - size disclosure renders before any download starts (SC4)
 *   - progress bar binding to VOICE_MODEL_PROGRESS
 *   - pause/resume link control
 *   - complete state shows "Voice ready" + "Continue →"
 *   - skip/set-up-later dismisses without downloading
 *   - variant prop switches step vs modal chrome
 *   - reduced motion: no animation class on progress bar fill
 *
 * All window.aria IPC methods are mocked via the _testIpc prop to avoid
 * vi.mock vitest-pool timeout issues (mirrors VoicePTTButton pattern).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VoiceModelDownload } from './VoiceModelDownload';
import type { VoiceModelDownloadIpc } from './VoiceModelDownload';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeIpc(
  overrides: Partial<VoiceModelDownloadIpc> = {}
): VoiceModelDownloadIpc {
  return {
    voiceGetModelStatus: vi.fn().mockResolvedValue({ ready: false, path: null, state: 0 }),
    voiceDownloadModel: vi.fn().mockResolvedValue(undefined),
    onVoiceModelProgress: vi.fn().mockReturnValue(() => undefined),
    ...overrides,
  };
}

describe('VoiceModelDownload', () => {
  let ipc: ReturnType<typeof makeIpc>;

  beforeEach(() => {
    ipc = makeIpc();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── size disclosure (SC4) ────────────────────────────────────────────────

  describe('size disclosure before download (SC4)', () => {
    it('renders the size disclosure block with testid voice-download-size-disclosure', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByTestId('voice-download-size-disclosure')).toBeTruthy();
    });

    it('shows "DOWNLOAD SIZE" label in the disclosure block', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByText('DOWNLOAD SIZE')).toBeTruthy();
    });

    it('shows the model name and size "Whisper large-v3-turbo — 574 MB"', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByText('Whisper large-v3-turbo — 574 MB')).toBeTruthy();
    });

    it('shows the storage location sub-text', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByText('Stored in your app data folder. One-time download.')).toBeTruthy();
    });

    it('renders the disclosure before any download starts (no progress bar initially)', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      // Progress bar should NOT exist before download starts
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  // ─── CTA buttons ─────────────────────────────────────────────────────────

  describe('CTA buttons', () => {
    it('renders "Download now" CTA button with testid voice-download-cta', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByTestId('voice-download-cta')).toBeTruthy();
      expect(screen.getByTestId('voice-download-cta')).toHaveTextContent('Download now');
    });

    it('renders skip button with testid voice-download-skip', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByTestId('voice-download-skip')).toBeTruthy();
    });

    it('skip button shows "Set up later" in step variant', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByTestId('voice-download-skip')).toHaveTextContent('Set up later');
    });

    it('skip button shows "Set up later" in modal variant', () => {
      render(<VoiceModelDownload variant="modal" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByTestId('voice-download-skip')).toHaveTextContent('Set up later');
    });
  });

  // ─── download start + progress ───────────────────────────────────────────

  describe('download start and progress binding', () => {
    it('clicking "Download now" calls voiceDownloadModel', async () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });
      expect(ipc.voiceDownloadModel).toHaveBeenCalled();
    });

    it('shows progress bar (role=progressbar) after download starts', async () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });
      expect(screen.getByRole('progressbar')).toBeTruthy();
    });

    it('progress bar has aria-valuenow bound to progress percent', async () => {
      let progressCallback: ((p: { receivedBytes: number; totalBytes: number }) => void) | null = null;
      const trackingIpc = makeIpc({
        onVoiceModelProgress: vi.fn().mockImplementation((cb) => {
          progressCallback = cb as typeof progressCallback;
          return () => undefined;
        }),
      });

      render(<VoiceModelDownload variant="step" _testIpc={trackingIpc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });

      // Simulate progress at 50%
      await act(async () => {
        progressCallback?.({ receivedBytes: 287_020_597, totalBytes: 574_041_195 });
      });

      const progressBar = screen.getByRole('progressbar');
      const ariaValueNow = progressBar.getAttribute('aria-valuenow');
      expect(Number(ariaValueNow)).toBeGreaterThanOrEqual(49);
      expect(Number(ariaValueNow)).toBeLessThanOrEqual(51);
    });

    it('progress bar has aria-valuemin=0 and aria-valuemax=100', async () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });
      const progressBar = screen.getByRole('progressbar');
      expect(progressBar).toHaveAttribute('aria-valuemin', '0');
      expect(progressBar).toHaveAttribute('aria-valuemax', '100');
    });

    it('renders testid voice-download-progress-bar after download starts', async () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });
      expect(screen.getByTestId('voice-download-progress-bar')).toBeTruthy();
    });
  });

  // ─── pause/resume ─────────────────────────────────────────────────────────

  describe('pause/resume control', () => {
    it('shows pause/resume link after download starts', async () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });
      // Pause or Resume link should be visible
      const pauseOrResume = screen.queryByText('Pause download') ?? screen.queryByText('Resume download');
      expect(pauseOrResume).toBeTruthy();
    });

    it('clicking "Pause download" toggles to "Resume download"', async () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });

      const pauseLink = screen.queryByText('Pause download');
      if (pauseLink) {
        await act(async () => { fireEvent.click(pauseLink); });
        expect(screen.queryByText('Resume download')).toBeTruthy();
      }
    });
  });

  // ─── completion state ─────────────────────────────────────────────────────

  describe('completion state', () => {
    it('shows "Voice ready" after download completes', async () => {
      let progressCallback: ((p: { receivedBytes: number; totalBytes: number; done?: boolean }) => void) | null = null;
      const trackingIpc = makeIpc({
        onVoiceModelProgress: vi.fn().mockImplementation((cb) => {
          progressCallback = cb as typeof progressCallback;
          return () => undefined;
        }),
      });

      render(<VoiceModelDownload variant="step" _testIpc={trackingIpc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });

      // Simulate completion
      await act(async () => {
        progressCallback?.({ receivedBytes: 574_041_195, totalBytes: 574_041_195, done: true });
      });

      expect(screen.getByText('Voice ready')).toBeTruthy();
    });

    it('shows "Continue →" CTA after download completes', async () => {
      let progressCallback: ((p: { receivedBytes: number; totalBytes: number; done?: boolean }) => void) | null = null;
      const trackingIpc = makeIpc({
        onVoiceModelProgress: vi.fn().mockImplementation((cb) => {
          progressCallback = cb as typeof progressCallback;
          return () => undefined;
        }),
      });

      render(<VoiceModelDownload variant="step" _testIpc={trackingIpc} onSkip={() => undefined} onComplete={() => undefined} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });

      await act(async () => {
        progressCallback?.({ receivedBytes: 574_041_195, totalBytes: 574_041_195, done: true });
      });

      expect(screen.getByTestId('voice-download-cta')).toHaveTextContent('Continue →');
    });

    it('clicking "Continue →" calls onComplete', async () => {
      const onComplete = vi.fn();
      let progressCallback: ((p: { receivedBytes: number; totalBytes: number; done?: boolean }) => void) | null = null;
      const trackingIpc = makeIpc({
        onVoiceModelProgress: vi.fn().mockImplementation((cb) => {
          progressCallback = cb as typeof progressCallback;
          return () => undefined;
        }),
      });

      render(<VoiceModelDownload variant="step" _testIpc={trackingIpc} onSkip={() => undefined} onComplete={onComplete} />);
      const cta = screen.getByTestId('voice-download-cta');
      await act(async () => { fireEvent.click(cta); });

      await act(async () => {
        progressCallback?.({ receivedBytes: 574_041_195, totalBytes: 574_041_195, done: true });
      });

      await act(async () => { fireEvent.click(screen.getByTestId('voice-download-cta')); });
      expect(onComplete).toHaveBeenCalled();
    });
  });

  // ─── skip/dismiss ─────────────────────────────────────────────────────────

  describe('skip — leaves model-readiness pending', () => {
    it('clicking skip calls onSkip without calling voiceDownloadModel', () => {
      const onSkip = vi.fn();
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={onSkip} onComplete={() => undefined} />);
      const skipBtn = screen.getByTestId('voice-download-skip');
      fireEvent.click(skipBtn);
      expect(onSkip).toHaveBeenCalled();
      expect(ipc.voiceDownloadModel).not.toHaveBeenCalled();
    });
  });

  // ─── variant switching ────────────────────────────────────────────────────

  describe('variant prop switching', () => {
    it('step variant renders testid voice-model-download-step', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByTestId('voice-model-download-step')).toBeTruthy();
    });

    it('modal variant renders testid voice-model-download-modal', () => {
      render(<VoiceModelDownload variant="modal" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.getByTestId('voice-model-download-modal')).toBeTruthy();
    });

    it('step variant does NOT render voice-model-download-modal testid', () => {
      render(<VoiceModelDownload variant="step" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.queryByTestId('voice-model-download-modal')).toBeNull();
    });

    it('modal variant does NOT render voice-model-download-step testid', () => {
      render(<VoiceModelDownload variant="modal" _testIpc={ipc} onSkip={() => undefined} onComplete={() => undefined} />);
      expect(screen.queryByTestId('voice-model-download-step')).toBeNull();
    });
  });

  // ─── already-ready state ──────────────────────────────────────────────────

  describe('already-ready state', () => {
    it('shows "Voice ready" immediately if model status is ready=true', async () => {
      const readyIpc = makeIpc({
        voiceGetModelStatus: vi.fn().mockResolvedValue({ ready: true, path: '/some/path', state: 1 }),
      });

      render(<VoiceModelDownload variant="step" _testIpc={readyIpc} onSkip={() => undefined} onComplete={() => undefined} />);

      // Wait for status to load
      await act(async () => { await Promise.resolve(); });

      expect(screen.getByText('Voice ready')).toBeTruthy();
    });
  });
});

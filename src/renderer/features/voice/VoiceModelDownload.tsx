/**
 * Phase 15 / Plan 15-08 — VoiceModelDownload.
 *
 * Used in two contexts (D-07):
 *   (a) 'step'  — skippable "Set up voice" step inside OnboardingWizard
 *   (b) 'modal' — lazy first-PTT modal for users who skipped onboarding
 *
 * SC4 qualities present in both variants:
 *   - Size disclosed BEFORE any download starts ("DOWNLOAD SIZE" block)
 *   - role=progressbar bound to VOICE_MODEL_PROGRESS, aria-valuenow=percent
 *   - "NN% · X.X MB / 574 MB" label in IBM Plex Mono tabular-nums
 *   - Pause/resume link toggles download state
 *   - "Voice ready" moss checkmark + "Continue →" on completion
 *   - "Set up later" dismisses without downloading (leaves readiness pending)
 *   - Progress fill animation suppressed under prefers-reduced-motion
 *
 * Mirrors the TrialBanner editorial tone (D-08) and uses Modal size="md"
 * for the lazy variant (UI-SPEC §5b).
 *
 * The _testIpc prop is a test-only override to avoid vi.mock vitest-pool
 * issues (mirrors VoicePTTButton._testSession pattern).
 */
import { useEffect, useState, useCallback } from 'react';
import { Button, Card } from '../../components/editorial';
import { Modal } from '../../components/editorial/Modal';
import type { AriaApi } from '../../../shared/ipc-contract';

// ─── CSS ─────────────────────────────────────────────────────────────────────

const CSS = `
.voice-download-progress-fill {
  transition: width 300ms linear;
  background: var(--gold);
  height: 100%;
  border-radius: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .voice-download-progress-fill {
    transition: none;
  }
}
`;

// ─── IPC interface (injectable for tests) ────────────────────────────────────

export interface VoiceModelDownloadIpc {
  voiceGetModelStatus: AriaApi['voiceGetModelStatus'];
  voiceDownloadModel: AriaApi['voiceDownloadModel'];
  onVoiceModelProgress: AriaApi['onVoiceModelProgress'];
}

// ─── Download state ───────────────────────────────────────────────────────────

type DownloadPhase = 'idle' | 'downloading' | 'paused' | 'complete' | 'error';

interface DownloadState {
  phase: DownloadPhase;
  percent: number;
  receivedBytes: number;
  totalBytes: number;
  errorMessage?: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Format bytes as "X.X MB" (one decimal, decimal MB to match the "574 MB" disclosure). */
function fmtMB(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1) + ' MB';
}

// Total disclosed size in bytes — matches DISCLOSED_MODEL_SIZE_BYTES in model-download.ts
// (574,041,195 = true HuggingFace size; the old 601,882,624 was 574 MiB, a unit bug.)
const DISCLOSED_BYTES = 574_041_195;

// ─── Size Disclosure Block ────────────────────────────────────────────────────

function SizeDisclosure(): JSX.Element {
  return (
    <div
      data-testid="voice-download-size-disclosure"
      style={{ marginTop: 16, marginBottom: 8 }}
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
        DOWNLOAD SIZE
      </div>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 14,
          color: 'var(--ink)',
          marginBottom: 2,
        }}
      >
        Whisper large-v3-turbo — 574 MB
      </div>
      <div
        style={{
          fontFamily: 'var(--f-body)',
          fontSize: 13,
          color: 'var(--gray-soft, var(--gray))',
        }}
      >
        Stored in your app data folder. One-time download.
      </div>
    </div>
  );
}

// ─── Progress Section ─────────────────────────────────────────────────────────

function ProgressSection({
  dl,
  onPauseResume,
}: {
  dl: DownloadState;
  onPauseResume: () => void;
}): JSX.Element | null {
  if (dl.phase === 'idle') return null;
  if (dl.phase === 'complete') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 16,
          marginBottom: 8,
        }}
      >
        {/* Moss checkmark SVG */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="8" fill="var(--moss, #5B6E3A)" opacity="0.15" />
          <path
            d="M4.5 8l2.5 2.5 4.5-5"
            stroke="var(--moss, #5B6E3A)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            color: 'var(--moss, #5B6E3A)',
            fontWeight: 500,
          }}
        >
          Voice ready
        </span>
      </div>
    );
  }

  const percent = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
  const isPaused = dl.phase === 'paused';

  return (
    <div style={{ marginTop: 16, marginBottom: 8 }}>
      {/* Progress bar */}
      <div
        data-testid="voice-download-progress-bar"
        role="progressbar"
        aria-label="Voice model download progress"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 4,
          background: 'var(--rule, #E8E4DC)',
          borderRadius: 2,
          overflow: 'hidden',
          marginBottom: 6,
        }}
      >
        <style>{CSS}</style>
        <div
          className="voice-download-progress-fill"
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* Progress label */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            color: 'var(--gray)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {percent}% · {fmtMB(dl.receivedBytes)} / 574 MB
        </span>

        {/* Pause/Resume link */}
        <button
          type="button"
          onClick={onPauseResume}
          style={{
            all: 'unset',
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            color: 'var(--gold)',
            cursor: 'pointer',
            textDecoration: 'underline',
            textDecorationStyle: 'dotted',
          }}
        >
          {isPaused ? 'Resume download' : 'Pause download'}
        </button>
      </div>

      {dl.phase === 'error' && dl.errorMessage && (
        <div
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            color: 'var(--rose)',
            marginTop: 6,
          }}
        >
          {dl.errorMessage}
        </div>
      )}
    </div>
  );
}

// ─── Download content (shared across variants) ────────────────────────────────

function DownloadContent({
  variant,
  dl,
  onDownload,
  onSkip,
  onComplete,
  onPauseResume,
}: {
  variant: 'step' | 'modal';
  dl: DownloadState;
  onDownload: () => void;
  onSkip: () => void;
  onComplete: () => void;
  onPauseResume: () => void;
}): JSX.Element {
  const isDownloading = dl.phase === 'downloading' || dl.phase === 'paused';
  const isComplete = dl.phase === 'complete';

  const heading = variant === 'modal' ? 'Download the voice model' : 'Set up voice for Aria';

  return (
    <div style={{ color: 'var(--ink)', fontFamily: 'var(--f-body)' }}>
      {/* Eyebrow */}
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        VOICE ASSISTANT
      </div>

      {/* Heading */}
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 20,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          margin: '0 0 10px',
          lineHeight: 1.1,
        }}
      >
        {heading}
      </h2>

      {/* Body */}
      {variant === 'step' && (
        <p
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            color: 'var(--gray)',
            lineHeight: 1.5,
            margin: '0 0 4px',
          }}
        >
          Aria can transcribe your voice locally — no audio leaves your machine.
          Download the speech model to get started.
        </p>
      )}

      {/* Size disclosure block — always visible BEFORE download starts (SC4) */}
      <SizeDisclosure />

      {/* Progress / completion section */}
      <ProgressSection dl={dl} onPauseResume={onPauseResume} />

      {/* CTA row */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginTop: 20,
          alignItems: 'center',
        }}
      >
        {isComplete ? (
          <Button
            variant="primary"
            data-testid="voice-download-cta"
            onClick={onComplete}
          >
            Continue →
          </Button>
        ) : (
          <Button
            variant="primary"
            data-testid="voice-download-cta"
            disabled={isDownloading}
            onClick={onDownload}
          >
            {isDownloading ? 'Downloading…' : 'Download now'}
          </Button>
        )}

        <Button
          variant="ghost"
          data-testid="voice-download-skip"
          onClick={onSkip}
        >
          {isDownloading ? 'Skip' : 'Set up later'}
        </Button>
      </div>
    </div>
  );
}

// ─── Component props ──────────────────────────────────────────────────────────

export interface VoiceModelDownloadProps {
  /** 'step' = onboarding card variant; 'modal' = lazy first-PTT modal variant */
  variant: 'step' | 'modal';
  /** Called when user skips (leaves model-readiness pending) */
  onSkip: () => void;
  /** Called when download is complete and user clicks "Continue →" */
  onComplete: () => void;
  /** For 'modal' variant: controls modal open state. Defaults to true. */
  open?: boolean;
  /** Test-only: inject IPC methods to avoid vi.mock vitest-pool issues */
  _testIpc?: VoiceModelDownloadIpc;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VoiceModelDownload({
  variant,
  onSkip,
  onComplete,
  open = true,
  _testIpc,
}: VoiceModelDownloadProps): JSX.Element | null {
  const [dl, setDl] = useState<DownloadState>({
    phase: 'idle',
    percent: 0,
    receivedBytes: 0,
    totalBytes: DISCLOSED_BYTES,
  });

  // Resolve IPC — use injected test IPC or window.aria
  const getIpc = useCallback((): VoiceModelDownloadIpc | null => {
    if (_testIpc) return _testIpc;
    if (typeof window !== 'undefined' && window.aria) {
      return window.aria as unknown as VoiceModelDownloadIpc;
    }
    return null;
  }, [_testIpc]);

  // Check initial model status on mount
  useEffect(() => {
    const ipc = getIpc();
    if (!ipc) return;

    ipc.voiceGetModelStatus().then((status) => {
      const s = status as { ready?: boolean; state?: number } | undefined;
      if (s?.ready || s?.state === 1) {
        setDl({
          phase: 'complete',
          percent: 100,
          receivedBytes: DISCLOSED_BYTES,
          totalBytes: DISCLOSED_BYTES,
        });
      }
    }).catch(() => {
      // non-fatal — start in idle state
    });
  }, [getIpc]);

  // Subscribe to VOICE_MODEL_PROGRESS push events
  useEffect(() => {
    const ipc = getIpc();
    if (!ipc || !ipc.onVoiceModelProgress) return;

    const unsub = ipc.onVoiceModelProgress((progress) => {
      const p = progress as { receivedBytes?: number; totalBytes?: number; done?: boolean; error?: boolean; errorMessage?: string } | undefined;
      if (!p) return;

      const received = p.receivedBytes ?? 0;
      const total = p.totalBytes ?? DISCLOSED_BYTES;

      if (p.done) {
        setDl({ phase: 'complete', percent: 100, receivedBytes: total, totalBytes: total });
      } else if (p.error) {
        setDl((prev) => ({
          ...prev,
          phase: 'error',
          errorMessage: p.errorMessage ?? 'Download failed',
        }));
      } else {
        const percent = total > 0 ? Math.round((received / total) * 100) : 0;
        setDl((prev) => ({
          ...prev,
          phase: prev.phase === 'paused' ? 'paused' : 'downloading',
          percent,
          receivedBytes: received,
          totalBytes: total,
        }));
      }
    });

    return unsub;
  }, [getIpc]);

  async function handleDownload(): Promise<void> {
    const ipc = getIpc();
    if (!ipc) return;
    setDl((prev) => ({ ...prev, phase: 'downloading' }));
    try {
      await ipc.voiceDownloadModel();
    } catch {
      // non-fatal — progress events will surface any error
    }
  }

  function handlePauseResume(): void {
    setDl((prev) => ({
      ...prev,
      phase: prev.phase === 'paused' ? 'downloading' : 'paused',
    }));
    // Note: actual pause/resume IPC calls would go through the download manager
    // (Plan 15-05 IPC wiring); here we just toggle local UI state
  }

  const content = (
    <DownloadContent
      variant={variant}
      dl={dl}
      onDownload={handleDownload}
      onSkip={onSkip}
      onComplete={onComplete}
      onPauseResume={handlePauseResume}
    />
  );

  if (variant === 'step') {
    return (
      <div data-testid="voice-model-download-step">
        <Card
          style={{
            padding: '32px 40px',
            maxWidth: 560,
            margin: '0 auto',
          }}
        >
          {content}
        </Card>
      </div>
    );
  }

  // Modal variant
  return (
    <div data-testid="voice-model-download-modal">
      <Modal
        open={open}
        onClose={onSkip}
        title={dl.phase === 'complete' ? 'Voice ready' : 'Download the voice model'}
        size="md"
      >
        {content}
      </Modal>
    </div>
  );
}

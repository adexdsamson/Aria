/**
 * Phase 15 / Plan 15-03 — Whisper model download manager.
 *
 * Fetches the Whisper large-v3-turbo q5_0 GGML model (~574 MB) from the
 * ggml-org/whisper.cpp Hugging Face repo into app.getPath('userData').
 *
 * Key design points:
 *   - node-downloader-helper (NDH) for HTTP Range resume (D-07/D-09)
 *   - size disclosure BEFORE start (SC4)
 *   - progress events pushed to renderer via emitToRenderer (SC4)
 *   - powerMonitor pause-on-sleep / resume-on-wake (D-09)
 *   - model-readiness pref flip on completion via setVoiceModelReady (D-08)
 *   - T-15-08: final file-size check gates the readiness flip (supply-chain guard)
 *   - partial file is kept on error/cancel for Range resume
 *
 * All Electron-specific imports (app.getPath, powerMonitor) are injected as
 * deps so the unit test runs without an Electron runtime.
 *
 * Lives under src/main/voice/** → the voice-routes-through-staging.spec.ts
 * ratchet fences it; this file NEVER imports from the write-path chokepoints.
 *
 * The HF model URL is a bare HTTPS GET for a binary file — NOT a cloud
 * STT/TTS endpoint — so the VOICE-04 no-cloud-audio ratchet does not trigger.
 */
import * as path from 'node:path';
import { app } from 'electron';
import { DownloaderHelper } from 'node-downloader-helper';
import { CHANNELS } from '../../../shared/ipc-contract';
import { registerLifecycleCallbacks } from '../../lifecycle/powerMonitor';
import type { LifecycleCallbacks } from '../../lifecycle/powerMonitor';
import type { Db } from '../../db/connect';
import {
  setVoiceModelReady,
  setVoiceModelDownloading,
} from '../prefs';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Filename used for the downloaded model on disk. */
export const MODEL_FILENAME = 'ggml-large-v3-turbo-q5_0.bin';

/**
 * Canonical Hugging Face URL for the Whisper large-v3-turbo q5_0 model.
 * Source: ggml-org/whisper.cpp Hugging Face repository.
 * [VERIFIED: huggingface.co/ggerganov/whisper.cpp]
 */
const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin';

/**
 * Known model size in bytes (601,882,624 bytes ≈ 574 MB).
 * Disclosed to the UI BEFORE the download starts (SC4).
 * Also used as the T-15-08 supply-chain integrity check on completion.
 *
 * [VERIFIED: RESEARCH.md Pattern 4 — "~574 MB (601,882,624 bytes)"]
 */
export const DISCLOSED_MODEL_SIZE_BYTES = 601_882_624;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Progress payload emitted on VOICE_MODEL_PROGRESS channel. */
export interface ModelDownloadProgress {
  receivedBytes: number;
  totalBytes: number;
  /** true when the download completes and readiness has been confirmed */
  done?: boolean;
  /** true when the download fails */
  error?: boolean;
  errorMessage?: string;
}

/** Injected dependencies — all Electron-specific pieces are injectable for tests. */
export interface ModelDownloadDeps {
  /** The open SQLite database for persisting readiness prefs. */
  db: Db | null;
  /** Push events to the renderer (mirrors makeRendererEmitter shape). */
  emitToRenderer?: (channel: string, payload?: unknown) => void;
  /**
   * Factory that creates a DownloaderHelper instance for the given URL and dest
   * directory.  Defaults to the real DownloaderHelper constructor.
   */
  helperFactory?: (
    url: string,
    destDir: string,
  ) => DownloaderHelper;
  /**
   * Returns the destination directory for the model file.
   * Defaults to app.getPath('userData').
   */
  destDirResolver?: () => string;
  /**
   * Registers power lifecycle callbacks (pause on sleep / resume on wake).
   * Defaults to registerLifecycleCallbacks from src/main/lifecycle/powerMonitor.ts.
   */
  registerLifecycle?: (cbs: LifecycleCallbacks) => () => void;
}

/** Public controller returned by createModelDownload. */
export interface ModelDownloadController {
  /** Total model size in bytes — available BEFORE start for SC4 disclosure. */
  disclosedSize(): number;
  /** Begin the download (or resume if already partially downloaded). */
  start(): Promise<void>;
  /** Pause the download. */
  pause(): void;
  /** Resume a paused download. */
  resume(): void;
  /** Cancel / stop the download. */
  cancel(): Promise<void>;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a model-download controller with injectable dependencies.
 *
 * The DownloaderHelper instance is created lazily on first start() call so that
 * disclosedSize() is available immediately (before any download).
 */
export function createModelDownload(deps: ModelDownloadDeps): ModelDownloadController {
  const {
    db,
    emitToRenderer,
    helperFactory = defaultHelperFactory,
    destDirResolver = defaultDestDirResolver,
    registerLifecycle = registerLifecycleCallbacks,
  } = deps;

  let dl: DownloaderHelper | null = null;
  let unregisterPower: (() => void) | null = null;

  function getOrCreateHelper(): DownloaderHelper {
    if (!dl) {
      const destDir = destDirResolver();
      dl = helperFactory(MODEL_URL, destDir);
      wireEvents(dl);
    }
    return dl;
  }

  function wireEvents(helper: DownloaderHelper): void {
    helper.on('progress', (state: unknown) => {
      try {
        const s = state as { progress?: { downloaded?: number; total?: number } };
        const receivedBytes = s?.progress?.downloaded ?? 0;
        const totalBytes = s?.progress?.total ?? DISCLOSED_MODEL_SIZE_BYTES;

        // Flip DB state to downloading
        try {
          if (db) setVoiceModelDownloading(db);
        } catch {
          // non-fatal — DB may not be open
        }

        emitToRenderer?.(CHANNELS.VOICE_MODEL_PROGRESS, {
          receivedBytes,
          totalBytes,
        } satisfies ModelDownloadProgress);
      } catch {
        // non-fatal
      }
    });

    helper.on('end', (info: unknown) => {
      try {
        const i = info as { filePath?: string; totalSize?: number };
        const filePath = i?.filePath ?? path.join(destDirResolver(), MODEL_FILENAME);
        const reportedSize = i?.totalSize ?? 0;

        // T-15-08 supply-chain guard: validate final file size
        if (reportedSize !== DISCLOSED_MODEL_SIZE_BYTES) {
          emitToRenderer?.(CHANNELS.VOICE_MODEL_PROGRESS, {
            receivedBytes: reportedSize,
            totalBytes: DISCLOSED_MODEL_SIZE_BYTES,
            error: true,
            errorMessage: `Size mismatch: expected ${DISCLOSED_MODEL_SIZE_BYTES}, got ${reportedSize}`,
          } satisfies ModelDownloadProgress);
          return; // do NOT flip readiness
        }

        // Flip readiness in DB
        try {
          if (db) setVoiceModelReady(db, filePath);
        } catch {
          // non-fatal
        }

        emitToRenderer?.(CHANNELS.VOICE_MODEL_PROGRESS, {
          receivedBytes: reportedSize,
          totalBytes: DISCLOSED_MODEL_SIZE_BYTES,
          done: true,
        } satisfies ModelDownloadProgress);
      } catch {
        // non-fatal
      }
    });

    helper.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);

      // Emit failure — partial file is kept for Range resume
      emitToRenderer?.(CHANNELS.VOICE_MODEL_PROGRESS, {
        receivedBytes: 0,
        totalBytes: DISCLOSED_MODEL_SIZE_BYTES,
        error: true,
        errorMessage: message,
      } satisfies ModelDownloadProgress);

      // Also emit state-changed so HUD reflects the error
      emitToRenderer?.(CHANNELS.VOICE_STATE_CHANGED, { error: message });
    });
  }

  return {
    disclosedSize() {
      return DISCLOSED_MODEL_SIZE_BYTES;
    },

    async start() {
      const helper = getOrCreateHelper();

      // Register powerMonitor pause/resume (D-09)
      if (!unregisterPower) {
        unregisterPower = registerLifecycle({
          onSuspend: () => {
            try { dl?.pause(); } catch { /* non-fatal */ }
          },
          onResume: () => {
            try { dl?.resume(); } catch { /* non-fatal */ }
          },
        });
      }

      await helper.start();
    },

    pause() {
      try { dl?.pause(); } catch { /* non-fatal */ }
    },

    resume() {
      try { dl?.resume(); } catch { /* non-fatal */ }
    },

    async cancel() {
      try { await dl?.stop(); } catch { /* non-fatal */ }
      if (unregisterPower) {
        unregisterPower();
        unregisterPower = null;
      }
    },
  };
}

// ─── Default injectable implementations ──────────────────────────────────────

function defaultDestDirResolver(): string {
  return app.getPath('userData');
}

function defaultHelperFactory(url: string, destDir: string): DownloaderHelper {
  return new DownloaderHelper(url, destDir, {
    resumeIfFileExists: true,
    resumeOnIncomplete: true,
    resumeOnIncompleteMaxRetry: 5,
    httpsRequestOptions: {
      headers: { 'User-Agent': 'Aria/1.0' },
    },
  });
}

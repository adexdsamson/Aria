/**
 * Phase 17 / Plan 17-05 Task 2 — useVoiceConfirm renderer hook.
 *
 * Manages the pending-approval confirm flow for the voice path (D-04/D-10):
 *   1. triggerReadBack(approvalId, readBackText): sets pendingApprovalId via
 *      actions.setPendingApproval(), then dispatches TTS read-back via
 *      voiceFeedAnswer. After TTS starts (onPlaybackStart fires), the user
 *      hears the resolved entities and the mic re-arms for the confirm turn.
 *   2. cancel(): fires voiceCancelApproval IPC + clears pendingApprovalId +
 *      emits a "Cancelled — press to try again" toast (D-12).
 *
 * The Plan 17-06 ApprovalCard imports this hook to wire the voice-confirm
 * affordance and the always-visible Cancel button.
 *
 * NOTE: This hook has NO side effects of its own beyond calling the injected
 * actions — it is a thin coordinator. The actual IPC calls are:
 *   - triggerReadBack: window.aria.voiceFeedAnswer (speak read-back text as TTS)
 *   - cancel: window.aria.voiceCancelApproval (ready→cancelled)
 *
 * Toast emission uses a minimal inline approach (document title update / custom
 * event) — the full toast system is BroadcastChannel-based in production, but
 * this hook emits a DOM custom event ('aria:toast') that the ToastHost component
 * listens to. If ToastHost is absent, the event is safely ignored.
 */
import { useRef } from 'react';
import type { AriaApi } from '../../../shared/ipc-contract';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal actions interface accepted by useVoiceConfirm (subset of VoiceSessionActions). */
export interface VoiceConfirmDeps {
  setPendingApproval(approvalId: string): void;
  clearPendingApproval(): void;
}

/** Controls returned by useVoiceConfirm. */
export interface ConfirmControls {
  /**
   * Begin the awaiting-confirm sub-state.
   * Sets pendingApprovalId, then fires TTS read-back via voiceFeedAnswer.
   * After TTS finishes and the half-duplex cooldown clears, the PTT re-arms
   * for the user's confirm utterance (which setTranscript will route to
   * voiceConfirmApproval instead of voiceFeedAnswer — Pitfall 4 guard).
   */
  triggerReadBack(approvalId: string, readBackText: string): void;

  /**
   * Cancel the pending approval (D-12 Cancel button path).
   * Fires voiceCancelApproval IPC, clears pendingApprovalId, emits toast.
   * Safe to call when pendingApprovalId is null (no-op guard).
   */
  cancel(): void;

  /** Current pending approval ID (for conditional rendering in ApprovalCard). */
  pendingApprovalId: string | null;
}

// ─── Toast helper ─────────────────────────────────────────────────────────────

function emitCancelToast(): void {
  // Emit a DOM custom event so ToastHost can display "Cancelled — press to try again" (D-12).
  // Safely ignored if ToastHost is absent (e.g. in tests without DOM setup).
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('aria:toast', {
        detail: {
          message: 'Cancelled — press to try again',
          kind: 'info',
          duration: 4000,
        },
      }),
    );
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * useVoiceConfirm — thin coordinator hook for the voice confirm/cancel flow.
 *
 * @param actions - Subset of VoiceSessionActions (from useVoiceSession or createVoiceSessionStore)
 * @returns ConfirmControls with triggerReadBack() and cancel()
 */
export function useVoiceConfirm(actions: VoiceConfirmDeps): ConfirmControls {
  // Track the current pendingApprovalId in a ref for cancel() to reference
  // without requiring a re-render cycle when it changes.
  const pendingApprovalIdRef = useRef<string | null>(null);

  function triggerReadBack(approvalId: string, readBackText: string): void {
    // Set the awaiting-confirm sub-state BEFORE dispatching TTS read-back
    // so the store is in the correct sub-state by the time onPlaybackStart fires.
    pendingApprovalIdRef.current = approvalId;
    actions.setPendingApproval(approvalId);

    // Dispatch TTS read-back via voiceFeedAnswer (same channel used for normal TTS).
    // The read-back text was built by buildReadBackText() from the resolved approval row fields.
    // The half-duplex gate (micGated=true during playback) prevents self-transcription (D-13).
    if (typeof window !== 'undefined' && window.aria) {
      // Use a synthetic sessionId for the read-back turn. The session manager
      // treats this as a TTS-only push (no streaming answer — just emitting the
      // pre-built text as a TTS chunk). When the read-back text is short,
      // the full text is sent as a single "feed answer" that the TTS player speaks.
      const readBackSessionId = `confirm-readback-${approvalId.slice(0, 8)}`;
      (window.aria as AriaApi).voiceFeedAnswer?.({
        sessionId: readBackSessionId,
        question: `__READBACK__:${readBackText}`,
      });
    }
  }

  function cancel(): void {
    const approvalId = pendingApprovalIdRef.current;
    // No-op guard when not in awaiting-confirm sub-state
    if (!approvalId) return;

    // 1. Fire voiceCancelApproval IPC (ready→cancelled)
    if (typeof window !== 'undefined' && window.aria) {
      (window.aria as AriaApi).voiceCancelApproval?.({ approvalId });
    }
    // 2. Clear sub-state
    pendingApprovalIdRef.current = null;
    actions.clearPendingApproval();
    // 3. D-12: emit "Cancelled — press to try again" toast
    emitCancelToast();
  }

  return {
    triggerReadBack,
    cancel,
    pendingApprovalId: pendingApprovalIdRef.current,
  };
}

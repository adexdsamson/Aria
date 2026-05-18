/**
 * Plan 03-04 Task 4 — Gmail send IPC handler.
 *
 * `aria.gmail.sendApproved({ approvalId })` delegates to `sendApprovedEmail`,
 * which gates on `assertApproved` (the FIRST executable line). Any bypass
 * attempt — sending a row not in state='approved', or a forced-explicit row
 * missing approval_path='explicit' — throws ApprovalGateError and never
 * reaches the Gmail API.
 *
 * On Google "unverified app" errors we set an in-process verification-pending
 * flag (RESEARCH §Pitfall 9) consumed by the renderer's IntegrationsSection.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import {
  CHANNELS,
  type SendApprovedRequest,
  type SendApprovedResult,
} from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import {
  sendApprovedEmail,
  type SendApprovedDeps,
} from '../integrations/google/send';
import { ApprovalGateError } from '../approvals/gate';
import {
  setVerificationPending,
  clearVerificationPending,
} from '../integrations/google/sendLog';

export interface GmailSendIpcDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** Override the send dependencies (tests). */
  sendDeps?: SendApprovedDeps;
}

function notReady(): { error: string } {
  return { error: 'DB_NOT_OPEN' };
}

function isUnverifiedAppError(err: Error): boolean {
  const m = err.message.toLowerCase();
  return (
    m.includes('access_denied') ||
    m.includes('unverified_app') ||
    m.includes('verification') ||
    m.includes('app is blocked')
  );
}

export function registerGmailSendHandlers(
  ipcMain: IpcMain,
  deps: GmailSendIpcDeps,
): void {
  const { logger, dbHolder } = deps;

  ipcMain.handle(CHANNELS.GMAIL_SEND_APPROVED, async (_e, req: unknown) => {
    const db = dbHolder.db;
    if (!db) return notReady();
    const r = (req ?? {}) as SendApprovedRequest;
    if (typeof r.approvalId !== 'string' || !r.approvalId) {
      return { error: 'INVALID_REQUEST' };
    }

    const start = Date.now();
    try {
      const result: SendApprovedResult = await sendApprovedEmail(
        db,
        r.approvalId,
        deps.sendDeps ?? {},
      );
      // First successful send clears the unverified-app banner.
      clearVerificationPending();
      logger.info(
        {
          scope: 'gmail.sendApproved',
          approvalId: r.approvalId,
          providerMsgId: result.providerMsgId,
          latency_ms: Date.now() - start,
        },
        'email sent',
      );
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (e instanceof ApprovalGateError) {
        logger.warn(
          { scope: 'gmail.sendApproved', code: e.code, approvalId: r.approvalId },
          'send blocked by approval gate',
        );
        return { error: `gate:${e.code}` };
      }
      if (isUnverifiedAppError(e)) {
        setVerificationPending();
      }
      logger.warn(
        { scope: 'gmail.sendApproved', err: e.message, approvalId: r.approvalId },
        'send failed',
      );
      return { error: `send-failed:${e.message}` };
    }
  });
}

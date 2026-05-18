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

/**
 * Plan 03-04 Task 5 — E2E mock state for the approve-and-send Playwright
 * spec. Populated via the gated `aria:gmail:__e2e_set_mock__` IPC channel
 * (only registered when `ARIA_E2E === '1'`), read by the e2e-injected
 * `buildGmailClient` shim. NEVER reachable in production builds because
 * the registration site is env-gated.
 */
interface E2eGmailMock {
  ok: boolean;
  msgId?: string;
  error?: string;
  /** Recorded send invocations — each entry stores the base64url raw payload
   *  that would have been sent so the e2e can decode + assert on contents. */
  calls: Array<{ raw: string; userId: string }>;
}
const e2eMock: E2eGmailMock = { ok: true, msgId: 'e2e-mocked-msg-id', calls: [] };

const ARIA_E2E_SET_GMAIL_MOCK = 'aria:gmail:__e2e_set_mock__';
const ARIA_E2E_GET_GMAIL_CALLS = 'aria:gmail:__e2e_get_calls__';
const ARIA_E2E_CLEAR_GMAIL_CALLS = 'aria:gmail:__e2e_clear_calls__';

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

  // E2E mock injection — gated by env var. The e2e spec calls
  // `__e2eSetGmailMock` before triggering an approve+send, then reads
  // `__e2eGetGmailCalls` to assert the raw payload. No production code path
  // reaches these handlers because they aren't registered unless ARIA_E2E=1.
  let effectiveSendDeps: SendApprovedDeps = deps.sendDeps ?? {};
  if (process.env.ARIA_E2E === '1') {
    effectiveSendDeps = {
      ...effectiveSendDeps,
      buildGmailClient: async () => {
        const sendFn = async (req: { userId: string; requestBody: { raw: string } }) => {
          e2eMock.calls.push({ raw: req.requestBody.raw, userId: req.userId });
          if (!e2eMock.ok) {
            throw new Error(e2eMock.error ?? 'e2e-mocked-failure');
          }
          return { data: { id: e2eMock.msgId ?? 'e2e-mocked-msg-id' } };
        };
        return {
          users: { messages: { send: sendFn } },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any;
      },
    };

    ipcMain.handle(ARIA_E2E_SET_GMAIL_MOCK, async (_e, req: unknown) => {
      const r = (req ?? {}) as Partial<E2eGmailMock>;
      e2eMock.ok = r.ok ?? true;
      e2eMock.msgId = r.msgId ?? 'e2e-mocked-msg-id';
      e2eMock.error = r.error;
      e2eMock.calls = [];
      return { ok: true };
    });
    ipcMain.handle(ARIA_E2E_GET_GMAIL_CALLS, async () => {
      return { calls: e2eMock.calls.slice() };
    });
    ipcMain.handle(ARIA_E2E_CLEAR_GMAIL_CALLS, async () => {
      e2eMock.calls = [];
      return { ok: true };
    });
  }

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
        effectiveSendDeps,
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

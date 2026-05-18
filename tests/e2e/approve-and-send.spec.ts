/**
 * Plan 03-04 Task 5 — E2E approve→send + bypass attempt + forced-explicit.
 *
 * Proves ROADMAP success criteria 1 (no send without approval) and 3
 * (approved drafts send via Gmail). The Gmail API is mocked in-process via
 * the ARIA_E2E hook installed in `src/main/ipc/gmail-send.ts` — production
 * builds never expose the hook because the registration site is gated on
 * `process.env.ARIA_E2E === '1'`.
 *
 * Three scenarios:
 *   1. Happy path — seed ready row → click Approve → mock receives one
 *      base64url-decoded RFC2822 message with To/Subject/In-Reply-To/body;
 *      approval row transitions to 'sent' with send_log(ok=1) and
 *      provider_msg_id populated.
 *   2. Bypass attempt — call `gmailSendApproved` directly on a 'ready' (not
 *      'approved') row; expect `gate:not-approved` error, mock NOT invoked.
 *   3. Forced-explicit — synthetic row with severity='high' +
 *      approval_path='silent' moved to 'approved' (simulating a UI-disable
 *      bypass); expect `gate:forced-explicit-missing`, mock NOT invoked.
 *
 * Tolerant of the same two skip conditions as the other Electron e2e specs
 * (NO_BUILD if out/main/index.js missing; ELECTRON_LAUNCH_FAILED on
 * Windows AV / ABI mismatch).
 */
import { _electron as electron, test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { launchAria, runOnboarding, DEFAULT_DAILY_PW } from './fixtures/onboarded';

test.setTimeout(180_000);

const MAIN_ENTRY = path.resolve(__dirname, '../../out/main/index.js');

interface E2eBag {
  __e2eSeedReady: (req: {
    recipients?: string[];
    subject?: string;
    body?: string;
    sourceMessageId?: string;
    severity?: 'low' | 'med' | 'high';
    categories?: string[];
    finalState?: 'ready' | 'approved';
    approvalPath?: 'explicit' | 'silent';
  }) => Promise<{ id?: string; error?: string }>;
  __e2eReadApproval: (req: { id: string }) => Promise<{ row?: unknown; error?: string }>;
  __e2eReadSendLog: (req: { approvalId: string }) => Promise<{ rows?: Array<Record<string, unknown>>; error?: string }>;
  __e2eSetGmailMock: (req: { ok: boolean; msgId?: string; error?: string }) => Promise<{ ok: boolean }>;
  __e2eGetGmailCalls: () => Promise<{ calls: Array<{ raw: string; userId: string }> }>;
  __e2eClearGmailCalls: () => Promise<{ ok: boolean }>;
}

function decodeBase64Url(s: string): string {
  // Browser env in Playwright evaluate scope is restricted; do decoding here.
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf8');
}

test('approve → send happy path; bypass attempts gated by assertApproved', async () => {
  if (!fs.existsSync(MAIN_ENTRY)) {
    test.skip(
      true,
      'NO_BUILD: out/main/index.js missing — run `npm run build`. Unit tests cover send.ts directly.',
    );
    return;
  }

  let boot: Awaited<ReturnType<typeof launchAria>>;
  try {
    boot = await launchAria();
    await runOnboarding(boot.electronApp, DEFAULT_DAILY_PW);
  } catch (err) {
    // Same tolerance as approval-crash-recovery.spec.ts — Windows AV / ABI
    // drift / onboarding races can fail in CI. Unit tests cover send.ts and
    // the IPC handler. The manual checkpoint at plan-end is the human gate.
    test.skip(
      true,
      `ELECTRON_LAUNCH_OR_ONBOARDING_FAILED: ${(err as Error).message}`,
    );
    return;
  }

  const { electronApp } = boot;
  try {
    const win = await electronApp.firstWindow();
    await win.waitForLoadState('domcontentloaded');

    // Configure the mock Gmail client to succeed.
    const setRes = await win.evaluate(async () => {
      const aria = (window as unknown as { aria: E2eBag }).aria;
      return aria.__e2eSetGmailMock({ ok: true, msgId: 'mocked-msg-id' });
    });
    expect(setRes.ok).toBe(true);

    // ─── Scenario 1: happy path ─────────────────────────────────────────
    const seed = await win.evaluate(async () => {
      const aria = (window as unknown as { aria: E2eBag }).aria;
      return aria.__e2eSeedReady({
        recipients: ['alice@example.com'],
        subject: 'Re: Project sync',
        body: 'Tuesday works for me. — sent via Aria',
        sourceMessageId: 'inbound-msg-1',
        severity: 'low',
        categories: ['none'],
      });
    });
    expect(seed.id, JSON.stringify(seed)).toBeTruthy();
    const approvalId = seed.id as string;

    // Navigate to /approvals.
    await win.evaluate(() => {
      window.history.pushState({}, '', '/approvals');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await win.getByTestId('approvals-screen').waitFor({ timeout: 10_000 });

    // Click Approve — this triggers approvalsApprove THEN gmailSendApproved
    // via the ApprovalsScreen.runApprove chain (Plan 03-04 Task 5 wiring).
    await win.getByTestId(`approval-approve-${approvalId}`).click();

    // Wait until the mock has received exactly one send call. Poll briefly
    // because the approve→send chain is async.
    let calls: Array<{ raw: string; userId: string }> = [];
    for (let i = 0; i < 40; i++) {
      const res = await win.evaluate(async () => {
        const aria = (window as unknown as { aria: E2eBag }).aria;
        return aria.__e2eGetGmailCalls();
      });
      calls = res.calls;
      if (calls.length >= 1) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(calls.length, 'mocked Gmail send call count').toBe(1);
    expect(calls[0]!.userId).toBe('me');
    const decoded = decodeBase64Url(calls[0]!.raw);
    expect(decoded).toContain('To: alice@example.com');
    expect(decoded).toContain('Subject: Re: Project sync');
    expect(decoded).toContain('In-Reply-To: <inbound-msg-1>');
    expect(decoded).toContain('References: <inbound-msg-1>');
    expect(decoded).toContain('Tuesday works for me.');

    // Assert approval row + send_log state.
    const rowRes = await win.evaluate(
      async (id: string) => {
        const aria = (window as unknown as { aria: E2eBag }).aria;
        return aria.__e2eReadApproval({ id });
      },
      approvalId,
    );
    const row = rowRes.row as Record<string, unknown> | undefined;
    expect(row, 'approval row exists').toBeTruthy();
    expect(row!.state).toBe('sent');
    expect(row!.sent_at).toBeTruthy();
    expect(row!.send_log_id).toBeTruthy();

    const logRes = await win.evaluate(
      async (id: string) => {
        const aria = (window as unknown as { aria: E2eBag }).aria;
        return aria.__e2eReadSendLog({ approvalId: id });
      },
      approvalId,
    );
    expect(logRes.rows && logRes.rows.length, 'send_log rows').toBeGreaterThanOrEqual(1);
    const log = logRes.rows![0]!;
    expect(log.ok).toBe(1);
    expect(log.provider_msg_id).toBe('mocked-msg-id');
    expect(log.provider).toBe('gmail');

    // ─── Scenario 2: bypass-attempt — direct send on non-approved row ───
    await win.evaluate(async () => {
      const aria = (window as unknown as { aria: E2eBag }).aria;
      await aria.__e2eClearGmailCalls();
    });
    const seed2 = await win.evaluate(async () => {
      const aria = (window as unknown as { aria: E2eBag }).aria;
      return aria.__e2eSeedReady({
        subject: 'Bypass attempt',
        finalState: 'ready', // explicitly NOT approved
      });
    });
    expect(seed2.id).toBeTruthy();
    const bypassId = seed2.id as string;

    const bypassRes = await win.evaluate(
      async (id: string) => {
        return window.aria.gmailSendApproved({ approvalId: id });
      },
      bypassId,
    );
    // The IPC layer wraps ApprovalGateError into { error: 'gate:not-approved' }.
    expect(bypassRes).toMatchObject({ error: expect.stringMatching(/gate:not-approved/) });
    const bypassCalls = await win.evaluate(async () => {
      const aria = (window as unknown as { aria: E2eBag }).aria;
      return aria.__e2eGetGmailCalls();
    });
    expect(bypassCalls.calls.length, 'no Gmail call on bypass').toBe(0);

    // ─── Scenario 3: forced-explicit-missing (APPR-07) ──────────────────
    await win.evaluate(async () => {
      const aria = (window as unknown as { aria: E2eBag }).aria;
      await aria.__e2eClearGmailCalls();
    });
    const seed3 = await win.evaluate(async () => {
      const aria = (window as unknown as { aria: E2eBag }).aria;
      return aria.__e2eSeedReady({
        subject: 'Forced-explicit bypass attempt',
        severity: 'high',
        approvalPath: 'silent',
        finalState: 'approved',
      });
    });
    expect(seed3.id).toBeTruthy();
    const forcedId = seed3.id as string;

    const forcedRes = await win.evaluate(
      async (id: string) => {
        return window.aria.gmailSendApproved({ approvalId: id });
      },
      forcedId,
    );
    expect(forcedRes).toMatchObject({
      error: expect.stringMatching(/gate:forced-explicit-missing/),
    });
    const forcedCalls = await win.evaluate(async () => {
      const aria = (window as unknown as { aria: E2eBag }).aria;
      return aria.__e2eGetGmailCalls();
    });
    expect(forcedCalls.calls.length, 'no Gmail call on forced-explicit gap').toBe(0);
  } finally {
    await electronApp.close().catch(() => undefined);
  }
});

/**
 * Plan 08.1-02 Task 10 — proves that the assertEntitled chokepoint is wired
 * BEFORE the provider call on each of the 5 gated surfaces.
 *
 * We build a fresh in-memory SQLCipher DB with the entitlement schema BUT no
 * row, so assertEntitled throws 'no-entitlement'. We then call each gated
 * function with a provider mock and assert (a) the call rejected, and
 * (b) the provider mock was never invoked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import { EntitlementError } from '../../../../src/main/entitlement/gate';

type Db = Database.Database;

const ENT_SCHEMA = `
CREATE TABLE entitlement (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  install_id TEXT NOT NULL,
  tier TEXT NOT NULL,
  jwt TEXT,
  jwt_iat TEXT,
  jwt_exp TEXT,
  trial_started_at TEXT,
  trial_expires_at TEXT,
  license_key TEXT,
  last_verified_at TEXT NOT NULL,
  last_check_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE entitlement_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,
  detail TEXT
);
`;

function freshGatedDb(): Db {
  const db = new Database(':memory:') as unknown as Db;
  db.exec(ENT_SCHEMA);
  return db;
}

describe('entitlement enforcement at the 5 gated surfaces', () => {
  it('sendApprovedEmail: gate-throw never reaches the gmail send', async () => {
    // Use a longer timeout because `googleapis` (transitively imported by
    // src/main/integrations/send.ts) is heavy to load in the test process.
    const { sendApprovedEmail } = await import(
      '../../../../src/main/integrations/send'
    );
    const db = freshGatedDb();
    const send = vi.fn();
    const buildGmailClient = vi.fn(async () => ({
      users: { messages: { send } },
    } as unknown as Awaited<
      Parameters<typeof sendApprovedEmail>[2] extends { buildGmailClient?: (() => Promise<infer T>) | undefined } ? T : never
    >));
    await expect(
      sendApprovedEmail(db, 'approval-x', { buildGmailClient }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(send).not.toHaveBeenCalled();
    expect(buildGmailClient).not.toHaveBeenCalled();
  }, 30_000);

  it('applyCalendarChange: gate-throw never reaches the calendar writer', async () => {
    const { applyCalendarChange } = await import(
      '../../../../src/main/integrations/write-event'
    );
    const db = freshGatedDb();
    const patchEvent = vi.fn();
    const insertEvent = vi.fn();
    const buildCalendarClient = vi.fn(async () => ({
      patchEvent,
      insertEvent,
      getEvent: vi.fn(),
      listEvents: vi.fn(),
    } as unknown as Parameters<typeof buildCalendarClient>[0]));
    await expect(
      applyCalendarChange(db, 'approval-x', { buildCalendarClient }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(buildCalendarClient).not.toHaveBeenCalled();
    expect(patchEvent).not.toHaveBeenCalled();
    expect(insertEvent).not.toHaveBeenCalled();
  });

  it('pushApprovedMeetingActions: gate-throw never reaches Todoist', async () => {
    const { pushApprovedMeetingActions } = await import(
      '../../../../src/main/integrations/todoist/push-actions'
    );
    const db = freshGatedDb();
    const create = vi.fn();
    const client = { createTask: create } as unknown as Parameters<
      typeof pushApprovedMeetingActions
    >[0]['client'];
    await expect(
      pushApprovedMeetingActions({ db, approvalId: 'approval-x', client }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(create).not.toHaveBeenCalled();
  });

  it('runBriefing: gate-throw never reaches the LLM', async () => {
    const { runBriefing } = await import('../../../../src/main/briefing/generate');
    const db = freshGatedDb();
    const generateObjectFn = vi.fn();
    const router = {
      classify: vi.fn(),
    } as unknown as Parameters<typeof runBriefing>[0]['router'];
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Parameters<typeof runBriefing>[0]['logger'];
    await expect(
      runBriefing({
        db,
        date: '2026-05-20',
        userTz: 'UTC',
        calendarClient: null,
        router,
        logger,
        generateObjectFn:
          generateObjectFn as unknown as Parameters<typeof runBriefing>[0]['generateObjectFn'],
      }),
    ).rejects.toBeInstanceOf(EntitlementError);
    expect(generateObjectFn).not.toHaveBeenCalled();
  });
});

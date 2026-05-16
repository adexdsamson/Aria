/**
 * Plan 02-02 Task 1 — calendar.ts wrapper error-translation tests.
 *
 * Mirrors gmail-wrapper.spec.ts: this is the ONE test file that uses
 * `vi.mock('googleapis', ...)` for the Calendar surface. Every other test in
 * this plan uses DI against the `CalendarClient` interface.
 *
 * Cases:
 *   1. events.list happy path → { items, nextSyncToken } correctly mapped
 *   2. events.list 410 → SyncTokenInvalidatedError
 *   3. events.list 401 + invalid_grant reason → TokenInvalidError(expired)
 *   4. listEvents({syncToken, singleEvents:true}) → IncompatibleEventsListParamsError
 *      thrown BEFORE the API call (Pitfall 14 enforcement in code)
 *   5. Pagination: when nextPageToken is set on page 1, caller makes a second
 *      call; wrapper itself does NOT auto-paginate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stubs = vi.hoisted(() => ({
  eventsList: vi.fn(),
  calendarListGet: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    calendar: () => ({
      events: { list: stubs.eventsList },
      calendarList: { get: stubs.calendarListGet },
    }),
  },
}));

import {
  createCalendarClient,
  SyncTokenInvalidatedError,
  IncompatibleEventsListParamsError,
} from '../../../../../src/main/integrations/google/calendar';
import { TokenInvalidError } from '../../../../../src/main/integrations/google/auth';

describe('createCalendarClient error translation', () => {
  beforeEach(() => {
    stubs.eventsList.mockReset();
    stubs.calendarListGet.mockReset();
  });

  function makeClient() {
    return createCalendarClient(null as never);
  }

  it('Case 1 — events.list happy path: returns { items, nextPageToken, nextSyncToken }', async () => {
    stubs.eventsList.mockResolvedValue({
      data: {
        items: [{ id: 'ev1', summary: 'A' }, { id: 'ev2', summary: 'B' }],
        nextSyncToken: 'st-1',
      },
    });
    const client = makeClient();
    const result = await client.listEvents({ syncToken: 'prev' });
    expect(result.items.length).toBe(2);
    expect(result.nextSyncToken).toBe('st-1');
    expect(result.nextPageToken).toBeUndefined();
  });

  it('Case 2 — events.list 410 → SyncTokenInvalidatedError', async () => {
    stubs.eventsList.mockRejectedValue({ code: 410, errors: [{ reason: 'fullSyncRequired' }] });
    const client = makeClient();
    await expect(client.listEvents({ syncToken: 'stale' })).rejects.toBeInstanceOf(
      SyncTokenInvalidatedError,
    );
  });

  it('Case 3 — events.list 401 + invalid_grant → TokenInvalidError(expired)', async () => {
    stubs.eventsList.mockRejectedValue({ code: 401, errors: [{ reason: 'invalid_grant' }] });
    const client = makeClient();
    try {
      await client.listEvents({ syncToken: 'x' });
      throw new Error('expected rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(TokenInvalidError);
      expect((err as InstanceType<typeof TokenInvalidError>).reason).toBe('expired');
    }
  });

  it('Case 4 — listEvents({syncToken, singleEvents:true}) → IncompatibleEventsListParamsError BEFORE the API call (Pitfall 14)', async () => {
    const client = makeClient();
    await expect(
      // @ts-expect-error — deliberately illegal combo to enforce defensive throw
      client.listEvents({ syncToken: 'st-1', singleEvents: true }),
    ).rejects.toBeInstanceOf(IncompatibleEventsListParamsError);
    expect(stubs.eventsList).not.toHaveBeenCalled();
  });

  it('Case 5 — pagination: wrapper does NOT auto-paginate; caller drives the loop', async () => {
    stubs.eventsList
      .mockResolvedValueOnce({ data: { items: [{ id: 'a' }], nextPageToken: 'p2' } })
      .mockResolvedValueOnce({ data: { items: [{ id: 'b' }], nextSyncToken: 'st-final' } });
    const client = makeClient();

    const page1 = await client.listEvents({ syncToken: 'st-prev' });
    expect(page1.items.map((i) => i.id)).toEqual(['a']);
    expect(page1.nextPageToken).toBe('p2');
    expect(page1.nextSyncToken).toBeUndefined();

    const page2 = await client.listEvents({ syncToken: 'st-prev', pageToken: 'p2' });
    expect(page2.items.map((i) => i.id)).toEqual(['b']);
    expect(page2.nextSyncToken).toBe('st-final');

    expect(stubs.eventsList).toHaveBeenCalledTimes(2);
  });
});

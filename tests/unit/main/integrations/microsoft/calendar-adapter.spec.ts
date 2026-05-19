import { describe, expect, it, vi } from 'vitest';
import { eventInstances, freebusyQuery, insertEvent, patchEvent } from '../../../../../src/main/integrations/microsoft/calendar';

function makeClient() {
  const get = vi.fn(async () => ({
    value: [
      {
        id: 'evt-1',
        subject: 'Team sync',
        '@odata.etag': 'etag-1',
      },
    ],
  }));
  const patch = vi.fn(async () => ({ id: 'evt-1', '@odata.etag': 'etag-2' }));
  const post = vi.fn(async () => ({ id: 'evt-new', '@odata.etag': 'etag-3' }));
  const header = vi.fn(() => ({ patch }));
  const api = vi.fn((path: string) => ({
    select: vi.fn(() => ({ get })),
    get,
    patch,
    post,
    header,
  }));
  return { graph: { api } };
}

describe('microsoft calendar adapter', () => {
  it('patches events with If-Match when provided', async () => {
    const client = makeClient();
    const result = await patchEvent(client as never, {
      eventId: 'evt-1',
      requestBody: { subject: 'Updated' },
      ifMatch: 'etag-1',
    });
    expect(client.graph.api).toHaveBeenCalledWith('/me/events/evt-1');
    expect(result).toEqual({ id: 'evt-1', etag: 'etag-2' });
  });

  it('inserts events and returns the new id', async () => {
    const client = makeClient();
    const result = await insertEvent(client as never, { requestBody: { subject: 'New' } });
    expect(client.graph.api).toHaveBeenCalledWith('/me/events');
    expect(result).toEqual({ id: 'evt-new', etag: 'etag-3' });
  });

  it('reads event instances from the series instances path', async () => {
    const client = makeClient();
    const items = await eventInstances(client as never, {
      eventId: 'series-1',
      timeMin: '2026-05-18T00:00:00.000Z',
      timeMax: '2026-05-19T00:00:00.000Z',
    });
    expect(client.graph.api).toHaveBeenCalledWith(
      '/me/events/series-1/instances?startDateTime=2026-05-18T00%3A00%3A00.000Z&endDateTime=2026-05-19T00%3A00%3A00.000Z',
    );
    expect(items).toHaveLength(1);
  });

  it('maps getSchedule responses into a busy calendar map', async () => {
    const api = vi.fn((path: string) => ({
      post: vi.fn(async () => ({
        value: [
          {
            scheduleId: 'primary',
            scheduleItems: [{ startTime: '2026-05-18T10:00:00.000Z', endTime: '2026-05-18T10:30:00.000Z' }],
          },
        ],
      })),
    }));
    const client = { graph: { api } };
    const result = await freebusyQuery(client as never, {
      timeMin: '2026-05-18T00:00:00.000Z',
      timeMax: '2026-05-19T00:00:00.000Z',
      calendarIds: ['primary'],
    });
    expect(client.graph.api).toHaveBeenCalledWith('/me/calendar/getSchedule');
    expect(result.calendars.primary.busy).toEqual([
      { start: '2026-05-18T10:00:00.000Z', end: '2026-05-18T10:30:00.000Z' },
    ]);
  });
});

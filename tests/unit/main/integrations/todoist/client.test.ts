import { describe, expect, it, vi } from 'vitest';
import { createTodoistClient } from '../../../../../src/main/integrations/todoist/client';

describe('Todoist client', () => {
  it('validates tokens with a lightweight tasks request', async () => {
    const fetchImpl = vi.fn(async () => new Response('[]', { status: 200 }));
    await expect(createTodoistClient('tok', fetchImpl).validateToken()).resolves.toEqual({ ok: true });
    expect(fetchImpl.mock.calls[0]![0]).toContain('https://api.todoist.com/api/v1/tasks?limit=1');
    expect((fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('creates tasks with idempotency key and maps remote id', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'remote-1' }), { status: 200 }));
    const result = await createTodoistClient('tok', fetchImpl).createTask(
      { content: 'Follow up', labels: ['from-meeting'], priority: 4 },
      { idempotencyKey: 'idem-1' },
    );
    expect(result).toEqual({ externalId: 'remote-1' });
    expect((fetchImpl.mock.calls[0]![1]!.headers as Record<string, string>)['X-Request-Id']).toBe('idem-1');
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)).toMatchObject({
      content: 'Follow up',
      labels: ['from-meeting'],
      priority: 4,
    });
  });

  it('maps Todoist v1 paginated task responses', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      results: [
        {
          id: 'remote-1',
          content: 'Review QBR',
          labels: ['exec'],
          due: { date: '2026-05-20' },
          priority: 3,
          is_completed: false,
        },
      ],
      next_cursor: null,
    }), { status: 200 }));

    await expect(createTodoistClient('tok', fetchImpl).listTasks()).resolves.toEqual([
      expect.objectContaining({
        externalId: 'remote-1',
        content: 'Review QBR',
        labels: ['exec'],
        dueIso: '2026-05-20',
        priority: 3,
        isCompleted: false,
      }),
    ]);
  });
});

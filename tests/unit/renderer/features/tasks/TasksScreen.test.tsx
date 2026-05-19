import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { TasksScreen } from '../../../../../src/renderer/features/tasks/TasksScreen';

afterEach(() => {
  cleanup();
  (globalThis as unknown as { window: { aria?: unknown } }).window.aria = undefined;
});

describe('TasksScreen', () => {
  it('renders Todoist and meeting-action tasks', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      tasksList: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'todoist:r1',
            remoteId: 'r1',
            content: 'Review QBR',
            description: null,
            projectName: 'Exec',
            labels: ['from-meeting'],
            dueIso: '2026-05-20',
            priority: 4,
            isCompleted: false,
            source: 'aria',
            noteId: 'note-1',
            meetingActionId: 'act-1',
          },
        ],
      }),
    };
    render(<TasksScreen />);

    await waitFor(() => expect(screen.getByTestId('tasks-screen')).toBeTruthy());
    expect(screen.getByText('Review QBR')).toBeTruthy();
    expect(screen.getByTestId('task-note-link').getAttribute('href')).toBe('aria://notes/note-1');
    expect(screen.getByTestId('task-source').textContent).toBe('Meeting action · Todoist synced');
  });

  it('renders Todoist Markdown links as anchors', async () => {
    (globalThis as unknown as { window: { aria: Record<string, unknown> } }).window.aria = {
      tasksList: vi.fn().mockResolvedValue({
        rows: [
          {
            id: 'todoist:r2',
            remoteId: 'r2',
            content: 'Todoist on mobile ([Watch](https://youtu.be/demo) | [Download](https://todoist.com/downloads))',
            description: null,
            projectName: null,
            labels: [],
            dueIso: null,
            priority: 1,
            isCompleted: false,
            source: 'todoist',
            noteId: null,
            meetingActionId: null,
          },
        ],
      }),
    };
    render(<TasksScreen />);

    const links = await screen.findAllByTestId('task-content-link');
    expect(links.map((link) => link.textContent)).toEqual(['Watch', 'Download']);
    expect(links[0]!.getAttribute('href')).toBe('https://youtu.be/demo');
    expect(links[1]!.getAttribute('href')).toBe('https://todoist.com/downloads');
  });
});

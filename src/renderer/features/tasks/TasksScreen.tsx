import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskRowDto } from '../../../shared/ipc-contract';
import { TaskRow } from './TaskRow';

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

export function TasksScreen(): JSX.Element {
  const [rows, setRows] = useState<TaskRowDto[]>([]);
  const [source, setSource] = useState<'all' | 'todoist' | 'aria'>('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await window.aria.tasksList({ source, completed: showCompleted ? undefined : false });
    if (isErr(result)) {
      setError(result.error);
      setRows([]);
      return;
    }
    setRows(result.rows);
    setError(null);
  }, [showCompleted, source]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCount = useMemo(() => rows.filter((row) => !row.isCompleted).length, [rows]);

  return (
    <section data-testid="tasks-screen" style={{ padding: 'var(--aria-space-xl)', color: 'var(--aria-fg)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 'var(--aria-type-3xl)', margin: 0 }}>Tasks</h1>
        <span data-testid="tasks-count" style={{ color: 'var(--aria-fg-muted)' }}>
          {openCount} open
        </span>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {(['all', 'todoist', 'aria'] as const).map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`tasks-source-${value}`}
            aria-pressed={source === value}
            onClick={() => setSource(value)}
          >
            {value === 'aria' ? 'Meeting actions' : value}
          </button>
        ))}
        <label>
          <input
            type="checkbox"
            data-testid="tasks-show-completed"
            checked={showCompleted}
            onChange={(event) => setShowCompleted(event.currentTarget.checked)}
          />{' '}
          Show completed
        </label>
      </div>

      {error && <p role="alert">{error}</p>}
      {rows.length === 0 && !error && <p data-testid="tasks-empty">No tasks yet.</p>}
      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((task) => <TaskRow key={task.id} task={task} />)}
      </div>
    </section>
  );
}

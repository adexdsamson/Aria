import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskRowDto } from '../../../shared/ipc-contract';
import { Card } from '../../components/editorial';
import { TaskRow } from './TaskRow';

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

const SOURCE_LABELS: Record<'all' | 'todoist' | 'aria', string> = {
  all: 'All',
  todoist: 'Todoist',
  aria: 'Meeting actions',
};

/**
 * Phase 9 re-skin: Tasks screen. IPC (tasksList) and all test-ids preserved.
 */
export function TasksScreen(): JSX.Element {
  const [rows, setRows] = useState<TaskRowDto[]>([]);
  const [source, setSource] = useState<'all' | 'todoist' | 'aria'>('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await window.aria.tasksList({
      source,
      completed: showCompleted ? undefined : false,
    });
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
    <section
      data-testid="tasks-screen"
      style={{
        padding: '2.5rem 2rem 4rem',
        maxWidth: 'var(--container)',
        margin: '0 auto',
        background: 'var(--ivory)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <header
        style={{
          marginBottom: 22,
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 18,
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
        }}
      >
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 8 }}>
            Tasks
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: '2rem',
              letterSpacing: '-0.01em',
            }}
          >
            Open work
          </h1>
        </div>
        <span style={{ flex: 1 }} />
        <span
          data-testid="tasks-count"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
          }}
        >
          {openCount} open
        </span>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 18,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {(['all', 'todoist', 'aria'] as const).map((value) => {
          const active = source === value;
          return (
            <button
              key={value}
              type="button"
              data-testid={`tasks-source-${value}`}
              aria-pressed={active}
              onClick={() => setSource(value)}
              style={chipStyle(active)}
            >
              {SOURCE_LABELS[value]}
            </button>
          );
        })}
        <label
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            data-testid="tasks-show-completed"
            checked={showCompleted}
            onChange={(event) => setShowCompleted(event.currentTarget.checked)}
            style={{ accentColor: 'var(--gold)' }}
          />
          Show completed
        </label>
      </div>

      {error && (
        <p
          role="alert"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            color: 'var(--rose)',
            letterSpacing: '0.08em',
          }}
        >
          {error}
        </p>
      )}
      {rows.length === 0 && !error && (
        <Card>
          <p
            data-testid="tasks-empty"
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontStyle: 'italic',
              fontSize: '1.125rem',
              color: 'var(--gray)',
              textAlign: 'center',
            }}
          >
            No tasks yet.
          </p>
        </Card>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    fontFamily: 'var(--f-mono)',
    fontSize: 11,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    padding: '6px 14px',
    borderRadius: 999,
    border: `1px solid ${active ? 'var(--gold)' : 'var(--rule-strong)'}`,
    background: active ? 'rgba(184,134,11,0.10)' : 'var(--paper)',
    color: active ? 'var(--gold-deep)' : 'var(--gray)',
    cursor: 'pointer',
    transition: 'all var(--t)',
  };
}

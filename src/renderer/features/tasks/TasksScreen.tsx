/**
 * TasksScreen — unified task list across Todoist + meeting actions.
 *
 * Phase 9 design-ref `app-screen-tasks.jsx` parity pass:
 *   - Topbar owns the "TASKS / Todoist + meeting actions" eyebrow+title — do
 *     NOT duplicate them here.
 *   - In-content H1 "Tasks" + inline count line "N OPEN · M OVERDUE" (mono)
 *   - Right side: "Todoist connected" status indicator (when applicable)
 *   - Source filter pills with icons; "All" selected = dark ink fill, others
 *     paper with subtle border
 *   - "Show completed" toggle right-aligned
 *   - Empty state free-floating italic, NO card wrapper
 *
 * IPC + state + data-testids preserved verbatim.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TaskRowDto } from '../../../shared/ipc-contract';
import { TaskRow } from './TaskRow';

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

function isOverdue(dueIso: string | null): boolean {
  if (!dueIso) return false;
  try {
    return new Date(dueIso).getTime() < Date.now();
  } catch {
    return false;
  }
}

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

type Source = 'all' | 'todoist' | 'aria';

const SOURCE_OPTIONS: { value: Source; label: string; icon: React.ReactNode }[] = [
  {
    value: 'all',
    label: 'All',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    ),
  },
  {
    value: 'todoist',
    label: 'Todoist',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    value: 'aria',
    label: 'Meeting actions',
    icon: (
      <span style={{ fontSize: 11, color: 'var(--gold)', lineHeight: 1 }}>✶</span>
    ),
  },
];

export function TasksScreen(): JSX.Element {
  const [rows, setRows] = useState<TaskRowDto[]>([]);
  const [source, setSource] = useState<Source>('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todoistConnected, setTodoistConnected] = useState<boolean>(false);

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

  // Detect Todoist connection — any row with source 'todoist' OR the
  // todoistStatus IPC reports a connected token. Cheap proxy via tasksList.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const fn = (window as { aria?: { todoistStatus?: () => Promise<unknown> } }).aria
          ?.todoistStatus;
        if (fn) {
          const res = await fn();
          if (cancelled) return;
          const ok =
            !!res &&
            typeof res === 'object' &&
            'connected' in (res as object) &&
            (res as { connected: boolean }).connected === true;
          setTodoistConnected(ok);
          return;
        }
      } catch {
        /* fall through */
      }
      // Fallback: infer from any todoist row present
      const probe = await window.aria.tasksList({ source: 'todoist' });
      if (cancelled) return;
      if (!isErr(probe) && probe.rows.length > 0) setTodoistConnected(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openRows = useMemo(() => rows.filter((r) => !r.isCompleted), [rows]);
  const openCount = openRows.length;
  const overdueCount = useMemo(() => openRows.filter((r) => isOverdue(r.dueIso)).length, [openRows]);

  return (
    <section
      data-testid="tasks-screen"
      style={{
        padding: '32px 40px 80px',
        maxWidth: 'var(--container, 1120px)',
        margin: '0 auto',
        background: 'var(--ivory)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 18,
          marginBottom: 28,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: 'clamp(2rem, 4vw, 2.5rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1,
            }}
          >
            Tasks
          </h1>
          <span
            data-testid="tasks-count"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
            }}
          >
            {openCount} open
            {overdueCount > 0 && (
              <>
                {' · '}
                <span data-testid="tasks-overdue-count" style={{ color: 'var(--rose)' }}>
                  {overdueCount} overdue
                </span>
              </>
            )}
          </span>
        </div>

        {todoistConnected && (
          <span
            data-testid="tasks-todoist-status"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: 'var(--moss)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 6, height: 6, borderRadius: 50, background: 'var(--moss)' }}
            />
            Todoist connected
          </span>
        )}
      </header>

      {/* Source filter row */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 24,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
            marginRight: 8,
          }}
        >
          Source
        </span>

        {SOURCE_OPTIONS.map(({ value, label, icon }) => {
          const active = source === value;
          return (
            <button
              key={value}
              type="button"
              data-testid={`tasks-source-${value}`}
              aria-pressed={active}
              onClick={() => setSource(value)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 14px',
                fontFamily: 'var(--f-body)',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--paper)' : 'var(--ink-soft)',
                background: active ? 'var(--ink)' : 'var(--paper)',
                border: `1px solid ${active ? 'var(--ink)' : 'var(--rule-strong)'}`,
                borderRadius: 999,
                cursor: 'pointer',
                transition: `background 180ms ease, color 180ms ease, transform 140ms ${EASE_OUT}`,
              }}
              onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                {icon}
              </span>
              {label}
            </button>
          );
        })}

        <label
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--gray)',
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            data-testid="tasks-show-completed"
            checked={showCompleted}
            onChange={(event) => setShowCompleted(event.currentTarget.checked)}
            style={{ accentColor: 'var(--gold)', cursor: 'pointer' }}
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
            margin: '0 0 16px 0',
            padding: '8px 12px',
            background: 'rgba(184,73,58,0.06)',
            borderLeft: '2px solid var(--rose)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          {error}
        </p>
      )}

      {rows.length === 0 && !error && (
        <div
          data-testid="tasks-empty"
          style={{
            padding: '56px 32px',
            textAlign: 'center',
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontSize: '1.125rem',
            color: 'var(--gray)',
          }}
        >
          {source === 'todoist' && !todoistConnected
            ? 'Connect Todoist in Settings → Integrations to see tasks here.'
            : source === 'aria'
              ? 'No meeting actions yet. Paste a transcript in Meetings to extract some.'
              : 'No tasks yet.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </div>
    </section>
  );
}

import type { TaskRowDto } from '../../../shared/ipc-contract';

/**
 * Phase 9 re-skin: TaskRow.
 *
 * Behavioural invariants:
 *  - `task-source` textContent === one of:
 *      'Meeting action · Todoist synced' | 'Meeting action' | 'Todoist'
 *  - `task-note-link` href === `aria://notes/{noteId}`
 *  - parseMarkdownLinks export preserved (used by tests indirectly).
 */
export function TaskRow({ task }: { task: TaskRowDto }): JSX.Element {
  const completed = task.isCompleted;
  const priorityColor = priorityColorFor(task.priority);
  const dueInfo = dueChipInfo(task.dueIso);

  return (
    <article
      data-testid={`task-row-${task.id}`}
      className="card"
      style={{
        padding: '14px 18px',
        background: completed ? 'var(--ivory-deep)' : 'var(--paper)',
        opacity: completed ? 0.75 : 1,
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 1, minWidth: 0 }}>
          <Checkbox checked={completed} />
          <h3
            style={{
              margin: 0,
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: '1.0625rem',
              lineHeight: 1.35,
              letterSpacing: '-0.005em',
              color: completed ? 'var(--gray)' : 'var(--ink)',
              textDecoration: completed ? 'line-through' : 'none',
            }}
          >
            <MarkdownLinks text={task.content} />
          </h3>
        </div>
        <span
          data-testid="task-source"
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: 'var(--gray-soft)',
            whiteSpace: 'nowrap',
          }}
        >
          {taskSourceLabel(task)}
        </span>
      </header>

      <div
        style={{
          marginTop: 8,
          marginLeft: 30,
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: priorityColor,
          }}
          title={`Priority ${task.priority}`}
        />
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
          }}
        >
          P{task.priority}
        </span>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: dueInfo.color,
            padding: '2px 8px',
            border: `1px solid ${dueInfo.border}`,
            borderRadius: 'var(--radius-sm)',
            background: dueInfo.bg,
          }}
        >
          {task.dueIso ? `Due ${task.dueIso}` : 'No due date'}
        </span>
        {task.projectName && (
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
              padding: '2px 8px',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--ivory-deep)',
            }}
          >
            {task.projectName}
          </span>
        )}
        {task.labels.map((label) => (
          <span
            key={label}
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
            }}
          >
            #{label}
          </span>
        ))}
        {task.noteId && (
          <a
            href={`aria://notes/${task.noteId}`}
            data-testid="task-note-link"
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--gold-deep)',
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              textDecorationColor: 'rgba(184,134,11,0.5)',
            }}
          >
            Open meeting note →
          </a>
        )}
      </div>
    </article>
  );
}

function Checkbox({ checked }: { checked: boolean }): JSX.Element {
  return (
    <span
      aria-hidden
      style={{
        width: 18,
        height: 18,
        borderRadius: 4,
        border: `1.5px solid ${checked ? 'var(--gold)' : 'var(--rule-strong)'}`,
        background: checked ? 'rgba(184,134,11,0.1)' : 'var(--paper)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        marginTop: 2,
        color: 'var(--gold-deep)',
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {checked ? '✓' : ''}
    </span>
  );
}

function priorityColorFor(priority: number): string {
  if (priority >= 4) return 'var(--rose)';
  if (priority === 3) return 'var(--gold)';
  if (priority === 2) return 'var(--ink-soft)';
  return 'var(--gray-faint)';
}

function dueChipInfo(dueIso: string | null | undefined): {
  color: string;
  border: string;
  bg: string;
} {
  if (!dueIso) {
    return {
      color: 'var(--gray-soft)',
      border: 'var(--rule)',
      bg: 'transparent',
    };
  }
  const due = Date.parse(dueIso);
  if (Number.isNaN(due)) {
    return { color: 'var(--gray)', border: 'var(--rule)', bg: 'transparent' };
  }
  const now = Date.now();
  const dayMs = 86_400_000;
  if (due < now - dayMs) {
    return {
      color: 'var(--rose)',
      border: 'var(--rose)',
      bg: 'rgba(184,73,58,0.08)',
    };
  }
  if (due < now + 2 * dayMs) {
    return {
      color: 'var(--gold-deep)',
      border: 'var(--gold)',
      bg: 'rgba(184,134,11,0.08)',
    };
  }
  return { color: 'var(--gray)', border: 'var(--rule)', bg: 'transparent' };
}

function taskSourceLabel(task: TaskRowDto): string {
  if (task.source === 'aria' && task.remoteId) return 'Meeting action · Todoist synced';
  if (task.source === 'aria') return 'Meeting action';
  return 'Todoist';
}

function MarkdownLinks({ text }: { text: string }): JSX.Element {
  const parts = parseMarkdownLinks(text);
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === 'link') {
          return (
            <a
              key={`${part.href}-${index}`}
              href={part.href}
              target="_blank"
              rel="noreferrer"
              data-testid="task-content-link"
              style={taskLinkStyle()}
            >
              {part.label}
            </a>
          );
        }
        return <span key={`${part.text}-${index}`}>{part.text}</span>;
      })}
    </>
  );
}

function taskLinkStyle(): React.CSSProperties {
  return {
    color: 'var(--gold-deep)',
    textDecoration: 'underline',
    textDecorationColor: 'rgba(184,134,11,0.5)',
    textUnderlineOffset: 3,
    fontWeight: 600,
  };
}

type MarkdownPart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; href: string };

export function parseMarkdownLinks(text: string): MarkdownPart[] {
  const parts: MarkdownPart[] = [];
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push({ kind: 'text', text: text.slice(cursor, index) });
    }
    parts.push({ kind: 'link', label: match[1]!, href: match[2]! });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) {
    parts.push({ kind: 'text', text: text.slice(cursor) });
  }
  return parts.length > 0 ? parts : [{ kind: 'text', text }];
}

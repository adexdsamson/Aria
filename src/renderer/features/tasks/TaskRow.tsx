import type { TaskRowDto } from '../../../shared/ipc-contract';

export function TaskRow({ task }: { task: TaskRowDto }): JSX.Element {
  return (
    <article
      data-testid={`task-row-${task.id}`}
      style={{
        border: '1px solid var(--aria-border)',
        borderRadius: 8,
        padding: 'var(--aria-space-md)',
        background: task.isCompleted ? '#f9fafb' : '#fff',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 'var(--aria-type-lg)' }}>
          <MarkdownLinks text={task.content} />
        </h3>
        <span data-testid="task-source" style={{ color: 'var(--aria-fg-muted)' }}>
          {taskSourceLabel(task)}
        </span>
      </header>
      <p style={{ margin: '6px 0', color: 'var(--aria-fg-muted)' }}>
        {task.dueIso ? `Due ${task.dueIso}` : 'No due date'} · Priority {task.priority}
      </p>
      {task.projectName && <p style={{ margin: 0 }}>Project: {task.projectName}</p>}
      {task.labels.length > 0 && (
        <p style={{ margin: '6px 0 0 0' }}>Labels: {task.labels.join(', ')}</p>
      )}
      {task.noteId && (
        <a href={`aria://notes/${task.noteId}`} data-testid="task-note-link">
          Open meeting note
        </a>
      )}
    </article>
  );
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
    color: '#2563eb',
    textDecoration: 'underline',
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

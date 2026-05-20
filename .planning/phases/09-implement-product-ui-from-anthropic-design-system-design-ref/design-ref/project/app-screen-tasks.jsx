// app-screen-tasks.jsx — Tasks (Plan 06-03 shipped UI).
//
// Mirrors TasksScreen.tsx + TaskRow.tsx:
//   • Source filter: all | Todoist | Meeting actions (Aria-extracted)
//   • Show completed toggle
//   • Open count header
//   • Per-row: content (with markdown link parsing), source, due, priority,
//     project, labels, "Open meeting note" link if backed by a transcript
//   • Overdue rows pull a quiet warning state

function ScreenTasks({ onNav }) {
  const [source, setSource]     = React.useState('all');     // 'all' | 'todoist' | 'aria'
  const [completed, setCompleted] = React.useState(false);

  const rows = TASKS.filter(t => {
    if (!completed && t.completed) return false;
    if (source === 'aria'    && t.source !== 'aria')    return false;
    if (source === 'todoist' && t.source !== 'todoist') return false;
    return true;
  });

  const openCount = TASKS.filter(t => !t.completed).length;
  const overdueCount = TASKS.filter(t => !t.completed && t.overdue).length;

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '28px 32px 80px' }}>

      {/* Header */}
      <div style={{
        display:'flex', alignItems:'baseline', gap: 14,
        paddingBottom: 14, marginBottom: 18,
        borderBottom: '1px solid var(--rule)',
      }}>
        <h1 style={{ fontFamily:'var(--f-display)', fontWeight: 500, fontSize: '2.25rem', letterSpacing:'-0.015em' }}>
          Tasks
        </h1>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--gray-soft)' }}>
          {openCount} open · {overdueCount} overdue
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost" style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
                onClick={() => onNav('settings-integrations')}>
          Todoist connected
        </button>
      </div>

      {/* Source toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <span className="smallcaps" style={{ color: 'var(--gray-soft)', marginRight: 4 }}>Source</span>
        {[
          { v: 'all',     label: 'All',             icon: I.list },
          { v: 'todoist', label: 'Todoist',         icon: I.task },
          { v: 'aria',    label: 'Meeting actions', icon: I.sparkle },
        ].map(opt => {
          const on = source === opt.v;
          const Ic = opt.icon;
          return (
            <button key={opt.v} onClick={() => setSource(opt.v)} style={{
              all:'unset', boxSizing:'border-box', cursor:'default',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 12px', borderRadius: 999,
              fontSize: 12.5,
              border: `1px solid ${on ? 'var(--ink)' : 'var(--rule)'}`,
              background: on ? 'var(--ink)' : 'transparent',
              color: on ? 'var(--ivory)' : 'var(--gray)',
            }}>
              <Ic size={12} /> {opt.label}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--gray)', cursor: 'default' }}>
          <input type="checkbox" checked={completed} onChange={(e)=>setCompleted(e.target.checked)} style={{ accentColor: 'var(--gold)' }} />
          Show completed
        </label>
      </div>

      {/* Empty state */}
      {rows.length === 0 ? (
        <div style={{ padding: '64px 0', textAlign: 'center', color: 'var(--gray-soft)', fontStyle: 'italic' }}>
          No tasks {source !== 'all' && `from ${source === 'aria' ? 'meeting actions' : 'Todoist'} `}yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(t => <TaskRow key={t.id} task={t} onNav={onNav} />)}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, onNav }) {
  const parts = parseMarkdownLinks(task.content);
  const isCompleted = task.completed;

  const priorityColor = {
    p1: 'var(--rose)', p2: 'var(--gold)', p3: 'var(--gray)', p4: 'var(--gray-faint)',
  }[task.priority] || 'var(--gray)';

  return (
    <article style={{
      background: isCompleted ? 'var(--ivory-deep)' : 'var(--paper)',
      border: '1px solid var(--rule)',
      borderRadius: 8,
      padding: '14px 16px',
      display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 14,
      alignItems: 'flex-start',
      opacity: isCompleted ? 0.6 : 1,
    }}>
      {/* Checkbox + priority flag */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 2 }}>
        <input type="checkbox" checked={isCompleted} readOnly
               style={{ width: 16, height: 16, accentColor: 'var(--gold)' }} />
        <span title={`Priority ${task.priority}`} style={{
          width: 4, height: 16, borderRadius: 2, background: priorityColor,
        }} />
      </div>

      {/* Content */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--f-body)', fontSize: 15, fontWeight: 500,
          color: 'var(--ink)', lineHeight: 1.35, marginBottom: 6,
          textDecoration: isCompleted ? 'line-through' : 'none',
        }}>
          {parts.map((p, i) => p.kind === 'link'
            ? <a key={i} href={p.href} target="_blank" rel="noreferrer" style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 3 }}>{p.label}</a>
            : <span key={i}>{p.text}</span>)}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
                      fontFamily: 'var(--f-mono)', fontSize: 10.5,
                      letterSpacing: '0.06em', color: 'var(--gray)' }}>
          {/* Due */}
          {task.dueIso ? (
            <span style={{ color: task.overdue ? 'var(--rose)' : 'var(--gray)' }}>
              <I.clock size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {task.overdue ? 'OVERDUE · ' : 'Due '}{task.dueIso}
            </span>
          ) : (
            <span style={{ color: 'var(--gray-soft)' }}>no due date</span>
          )}

          {task.projectName && (
            <span><I.list size={11} style={{ verticalAlign: '-2px', marginRight: 4 }} />{task.projectName}</span>
          )}

          {(task.labels || []).map(l => (
            <span key={l} style={{
              padding: '1px 6px', borderRadius: 3,
              background: 'var(--ivory-deep)', border: '1px solid var(--rule)',
              color: 'var(--gray)', letterSpacing: '0.04em',
            }}>#{l}</span>
          ))}

          {task.citation && (
            <a href="#" onClick={(e)=>{ e.preventDefault(); onNav('meetings'); }}
               style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
              <I.link size={10} style={{ verticalAlign: '-1px', marginRight: 4 }} />
              Open meeting note
            </a>
          )}
        </div>
      </div>

      {/* Source badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', paddingTop: 2 }}>
        <SourceBadge task={task} />
      </div>
    </article>
  );
}

function SourceBadge({ task }) {
  if (task.source === 'aria') {
    const synced = !!task.remoteId;
    return (
      <span title={synced ? 'Meeting action · pushed to Todoist' : 'Meeting action · awaiting approval'}
            style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '2px 8px', borderRadius: 999,
        fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.12em',
        textTransform: 'uppercase',
        border: '1px solid rgba(184,134,11,0.25)',
        background: 'rgba(184,134,11,0.08)', color: 'var(--gold-deep)',
      }}>
        <I.sparkle size={10} /> meeting{synced ? ' · synced' : ''}
      </span>
    );
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 999,
      fontFamily: 'var(--f-mono)', fontSize: 9.5, letterSpacing: '0.12em',
      textTransform: 'uppercase',
      border: '1px solid var(--rule)',
      background: 'var(--ivory-deep)', color: 'var(--gray)',
    }}>
      <I.task size={10} /> todoist
    </span>
  );
}

// Markdown-link parser (mirrors TaskRow.tsx)
function parseMarkdownLinks(text) {
  const out = [];
  const re = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let cursor = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > cursor) out.push({ kind: 'text', text: text.slice(cursor, idx) });
    out.push({ kind: 'link', label: m[1], href: m[2] });
    cursor = idx + m[0].length;
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) });
  return out.length ? out : [{ kind: 'text', text }];
}

window.ScreenTasks = ScreenTasks;

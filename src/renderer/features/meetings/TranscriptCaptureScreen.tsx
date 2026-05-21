import { useState } from 'react';
import type { TranscriptNoteDto, TranscriptSourceKind } from '../../../shared/ipc-contract';
import { Button, Card, LabelRule } from '../../components/editorial';
import { NoteView } from './NoteView';

/**
 * Phase 9 re-skin: Meeting capture entry surface.
 * MEET-06 no-bot guardrail copy preserved verbatim.
 * All IPC (transcriptIngest, transcriptGetNote) untouched.
 */
export function TranscriptCaptureScreen({
  onIngested,
}: {
  /**
   * Optional callback fired after a successful ingest. Used by MeetingsScreen
   * to refresh the Recent list and switch back to the populated 3-pane view.
   */
  onIngested?: (noteId: string) => void;
} = {}): JSX.Element {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [sourceKind, setSourceKind] = useState<TranscriptSourceKind>('paste');
  const [note, setNote] = useState<TranscriptNoteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalMessage, setApprovalMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ingest(): Promise<void> {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setApprovalMessage(null);
    try {
      const res = await window.aria.transcriptIngest({ sourceKind, text, title: title || undefined });
      if ('error' in res) {
        setError(res.error);
        return;
      }
      if (res.taskBatchApprovalId && res.actionCount) {
        setApprovalMessage(
          `Created approval for ${res.actionCount} meeting action${res.actionCount === 1 ? '' : 's'}.`,
        );
      }
      const noteRes = await window.aria.transcriptGetNote({ noteId: res.noteId });
      if ('error' in noteRes) setError(noteRes.error);
      else setNote(noteRes.note);
      onIngested?.(res.noteId);
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File): Promise<void> {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const nextKind: TranscriptSourceKind =
      ext === 'vtt' || ext === 'srt' || ext === 'json' || ext === 'txt' ? ext : 'txt';
    setSourceKind(nextKind);
    setTitle(file.name.replace(/\.[^.]+$/, ''));
    setText(await file.text());
  }

  return (
    <section
      data-testid="transcript-capture-screen"
      style={{
        padding: '2.5rem 2rem 4rem',
        maxWidth: 'var(--container)',
        margin: '0 auto',
        color: 'var(--ink)',
        background: 'var(--ivory)',
      }}
    >
      <header style={{ marginBottom: 24, borderBottom: '1px solid var(--rule)', paddingBottom: 18 }}>
        <div
          className="smallcaps"
          style={{
            color: 'var(--gray-soft)',
            marginBottom: 8,
          }}
        >
          Paste or upload a transcript
        </div>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: '2rem',
            letterSpacing: '-0.01em',
            margin: 0,
            color: 'var(--ink)',
          }}
        >
          Meeting capture
        </h1>
        <p
          style={{
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            color: 'var(--gray)',
            lineHeight: 1.6,
            marginTop: 8,
            marginBottom: 0,
            maxWidth: '46em',
          }}
        >
          Paste a transcript or upload a text transcript file. Aria does not join meetings or record
          calls.
        </p>
      </header>

      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontFamily: 'var(--f-body)',
            }}
          >
            <span
              className="smallcaps"
              style={{ color: 'var(--gray)' }}
            >
              Meeting title
            </span>
            <input
              data-testid="transcript-title"
              value={title}
              placeholder="Meeting title"
              onChange={(event) => setTitle(event.target.value)}
              style={inputStyle()}
            />
          </label>

          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontFamily: 'var(--f-body)',
            }}
          >
            <span className="smallcaps" style={{ color: 'var(--gray)' }}>
              Upload file
            </span>
            <input
              data-testid="transcript-file"
              type="file"
              accept=".txt,.vtt,.srt,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                color: 'var(--gray)',
              }}
            />
            <span
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'var(--gray-soft)',
              }}
            >
              Supports plain text, VTT, SRT, JSON, Markdown, Otter export
            </span>
          </label>

          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              fontFamily: 'var(--f-body)',
            }}
          >
            <span className="smallcaps" style={{ color: 'var(--gray)' }}>
              Transcript
            </span>
            <textarea
              data-testid="transcript-text"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setSourceKind('paste');
              }}
              rows={12}
              placeholder="Paste transcript here, or drop a file…"
              style={{
                ...inputStyle(),
                minHeight: 220,
                padding: '12px 14px',
                fontFamily: 'var(--f-body)',
                fontSize: 14,
                lineHeight: 1.6,
                resize: 'vertical',
              }}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Button
              variant="primary"
              data-testid="transcript-ingest"
              disabled={busy || !text.trim()}
              onClick={() => void ingest()}
            >
              {busy ? 'Extracting…' : 'Extract action items'}
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <p
          data-testid="transcript-error"
          role="alert"
          style={{
            marginTop: 14,
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            letterSpacing: '0.08em',
            color: 'var(--rose)',
          }}
        >
          {error}
        </p>
      )}
      {approvalMessage && (
        <p
          data-testid="transcript-approval-created"
          style={{
            marginTop: 14,
            fontFamily: 'var(--f-body)',
            fontSize: 14,
            color: 'var(--moss)',
          }}
        >
          {approvalMessage} Go to Approvals to review and push to Todoist.
        </p>
      )}

      {note && (
        <div style={{ marginTop: 24 }}>
          <LabelRule label="Extracted note" align="left" />
          <div style={{ marginTop: 14 }}>
            <NoteView note={note} />
          </div>
        </div>
      )}

      <p
        className="smallcaps"
        style={{
          marginTop: 32,
          color: 'var(--gray-soft)',
          textAlign: 'center',
        }}
      >
        Aria does not join calls — paste only (MEET-06).
      </p>
    </section>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    minHeight: 44,
    padding: '0 12px',
    background: 'var(--paper)',
    color: 'var(--ink)',
    border: '1px solid var(--rule)',
    borderRadius: 'var(--radius)',
    fontFamily: 'var(--f-body)',
    fontSize: 14,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  };
}

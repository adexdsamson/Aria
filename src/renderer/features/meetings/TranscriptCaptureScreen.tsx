import { useState } from 'react';
import type { TranscriptNoteDto, TranscriptSourceKind } from '../../../shared/ipc-contract';
import { NoteView } from './NoteView';

export function TranscriptCaptureScreen(): JSX.Element {
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
        setApprovalMessage(`Created approval for ${res.actionCount} meeting action${res.actionCount === 1 ? '' : 's'}.`);
      }
      const noteRes = await window.aria.transcriptGetNote({ noteId: res.noteId });
      if ('error' in noteRes) setError(noteRes.error);
      else setNote(noteRes.note);
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
    <section data-testid="transcript-capture-screen" style={{ padding: 'var(--aria-space-xl)' }}>
      <h1 style={{ fontSize: 'var(--aria-type-3xl)', marginTop: 0 }}>Meeting Capture</h1>
      <p style={{ color: '#64748b' }}>
        Paste a transcript or upload a text transcript file. Aria does not join meetings or record calls.
      </p>
      <input
        data-testid="transcript-title"
        value={title}
        placeholder="Meeting title"
        onChange={(event) => setTitle(event.target.value)}
        style={{ width: '100%', padding: 8, marginBottom: 8 }}
      />
      <input
        data-testid="transcript-file"
        type="file"
        accept=".txt,.vtt,.srt,.json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
        }}
        style={{ display: 'block', marginBottom: 8 }}
      />
      <textarea
        data-testid="transcript-text"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setSourceKind('paste');
        }}
        rows={10}
        style={{ width: '100%', padding: 8, fontFamily: 'inherit' }}
      />
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          data-testid="transcript-ingest"
          disabled={busy || !text.trim()}
          onClick={() => void ingest()}
        >
          {busy ? 'Ingesting...' : 'Ingest transcript'}
        </button>
      </div>
      {error && <p data-testid="transcript-error" role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      {approvalMessage && (
        <p data-testid="transcript-approval-created" style={{ color: '#16a34a' }}>
          {approvalMessage} Go to Approvals to review and push to Todoist.
        </p>
      )}
      {note && <div style={{ marginTop: 16 }}><NoteView note={note} /></div>}
    </section>
  );
}

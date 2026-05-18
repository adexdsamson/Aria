/**
 * Plan 03-01 Task 2 — Approval queue dedicated route.
 *
 * Mounts at /approvals. Lists all approval rows in display states (pending,
 * generating, ready, interrupted, snoozed) with filter chips, multi-select
 * for batch approve, and per-card actions.
 *
 * No TanStack Query dependency (renderer doesn't pull it in for Plan 03-01;
 * the simple useEffect + reload pattern from BriefingScreen is sufficient).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApprovalRowDto, ApprovalUiState } from '../../../shared/ipc-contract';
import { ApprovalCard } from './ApprovalCard';

const FILTERABLE_STATES: ApprovalUiState[] = [
  'pending',
  'generating',
  'ready',
  'interrupted',
  'snoozed',
];

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

export function ApprovalsScreen(): JSX.Element {
  const [rows, setRows] = useState<ApprovalRowDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stateFilter, setStateFilter] = useState<Set<ApprovalUiState>>(
    new Set(FILTERABLE_STATES),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const res = await window.aria.approvalsList();
    if (isErr(res)) {
      setActionError(res.error);
      setRows([]);
    } else {
      setRows(res.rows);
      setActionError(null);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => rows.filter((r) => stateFilter.has(r.state)),
    [rows, stateFilter],
  );

  const toggleFilter = (s: ApprovalUiState): void => {
    const next = new Set(stateFilter);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setStateFilter(next);
  };

  const toggleSelect = (id: string, on: boolean): void => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    setSelected(next);
  };

  const runApprove = async (
    id: string,
    edited?: { body?: string; subject?: string },
  ): Promise<void> => {
    const res = await window.aria.approvalsApprove({ id, edited });
    if (isErr(res)) {
      setActionError(res.error);
      await load();
      return;
    }
    // Plan 03-04 Task 5 — for email_send approvals, chain into the Gmail
    // send adapter so the approve click drives the full approved -> sent
    // transition. The gmail-send IPC is the SINGLE call site for Gmail
    // sends; bypass attempts (non-approved rows, forced-explicit gaps) are
    // rejected by assertApproved inside the adapter (APPR-01 / APPR-07).
    const row = rows.find((r) => r.id === id);
    if (row && row.kind === 'email_send') {
      const sendRes = await window.aria.gmailSendApproved({ approvalId: id });
      if (isErr(sendRes)) setActionError(sendRes.error);
    }
    await load();
  };

  const runReject = async (id: string, reason?: string): Promise<void> => {
    const res = await window.aria.approvalsReject({ id, reason });
    if (isErr(res)) setActionError(res.error);
    await load();
  };

  const runSnooze = async (id: string, until: string): Promise<void> => {
    const res = await window.aria.approvalsSnooze({ id, until });
    if (isErr(res)) setActionError(res.error);
    await load();
  };

  const runBatchApprove = async (): Promise<void> => {
    setConfirmOpen(false);
    const ids = Array.from(selected);
    const res = await window.aria.approvalsBatchApprove({ ids });
    if (isErr(res)) setActionError(res.error);
    setSelected(new Set());
    await load();
  };

  const batchableCount = useMemo(
    () => Array.from(selected).filter((id) => rows.find((r) => r.id === id)?.state === 'ready').length,
    [rows, selected],
  );

  return (
    <section
      data-testid="approvals-screen"
      style={{ padding: 'var(--aria-space-xl)', color: 'var(--aria-fg)' }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
        <h1 style={{ fontSize: 'var(--aria-type-3xl)', margin: 0 }}>Approvals</h1>
        <span data-testid="approvals-count" style={{ color: '#6b7280' }}>
          ({visible.length} of {rows.length})
        </span>
      </header>

      <div
        role="group"
        aria-label="Filter by state"
        style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}
      >
        {FILTERABLE_STATES.map((s) => (
          <button
            key={s}
            type="button"
            data-testid={`approvals-filter-${s}`}
            aria-pressed={stateFilter.has(s)}
            onClick={() => toggleFilter(s)}
            style={{
              padding: '4px 10px',
              borderRadius: 12,
              border: '1px solid #d1d5db',
              background: stateFilter.has(s) ? '#1f2937' : '#fff',
              color: stateFilter.has(s) ? '#fff' : '#1f2937',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {actionError && (
        <p role="alert" data-testid="approvals-error" style={{ color: '#b91c1c', fontSize: 13 }}>
          {actionError}
        </p>
      )}

      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: 8,
            background: '#eff6ff',
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <span data-testid="approvals-batch-summary">
            {selected.size} selected ({batchableCount} ready to approve)
          </span>
          <button
            type="button"
            data-testid="approvals-batch-approve"
            disabled={batchableCount === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Batch approve
          </button>
          <button
            type="button"
            data-testid="approvals-batch-clear"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="approvals-batch-confirm"
          style={{
            border: '1px solid #d1d5db',
            background: '#f9fafb',
            padding: 12,
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          <p style={{ margin: '0 0 8px 0', fontSize: 13 }}>
            Approve {batchableCount} ready draft(s)? Approvals are final and unlock the send gate
            for each row. This action cannot be undone in batch.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              data-testid="approvals-batch-confirm-btn"
              onClick={() => void runBatchApprove()}
            >
              Confirm batch approve
            </button>
            <button
              type="button"
              data-testid="approvals-batch-cancel-btn"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!loaded && <p data-testid="approvals-loading">Loading…</p>}
      {loaded && visible.length === 0 && (
        <p data-testid="approvals-empty" style={{ color: '#6b7280' }}>
          No approvals match the current filter.
        </p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {visible.map((row) => (
          <li key={row.id}>
            <ApprovalCard
              row={row}
              selectable
              selected={selected.has(row.id)}
              onSelect={toggleSelect}
              onApprove={runApprove}
              onReject={runReject}
              onSnooze={runSnooze}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Plan 03-01 Task 2 — Approval queue dedicated route.
 *
 * Mounts at /approvals. Lists all approval rows in display states (pending,
 * generating, ready, interrupted, snoozed) with filter chips, multi-select
 * for batch approve, and per-card actions.
 *
 * Phase 9 Plan 03 — RE-SKINNED. Editorial filter pills, gold-tinted batch
 * action bar, ivory-deep confirm dialog. All IPC, state, data-testid, and
 * action handlers preserved verbatim.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApprovalRowDto, ApprovalUiState } from '../../../shared/ipc-contract';
import { Button } from '../../components/editorial';
import { ApprovalQueue } from './ApprovalQueue';
import { SkeletonRoot, SkeletonBlock, SkeletonLine } from '../../components/Skeleton';

const FILTERABLE_STATES: ApprovalUiState[] = [
  'pending',
  'generating',
  'ready',
  'sending',
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
    const row = rows.find((r) => r.id === id);
    if (row && row.kind === 'email_send') {
      const sendRes = await window.aria.gmailSendApproved({ approvalId: id });
      if (isErr(sendRes)) setActionError(sendRes.error);
    }
    if (row && row.kind === 'task_batch') {
      const pushRes = await window.aria.todoistPushApprovedActions({ approvalId: id });
      if (isErr(pushRes)) setActionError(pushRes.error);
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

  const runCancelStuck = async (id: string): Promise<void> => {
    const res = await window.aria.approvalsCancelStuck({ id });
    if (isErr(res)) setActionError(res.error);
    await load();
  };

  const batchableCount = useMemo(
    () => Array.from(selected).filter((id) => rows.find((r) => r.id === id)?.state === 'ready').length,
    [rows, selected],
  );

  return (
    <section
      data-testid="approvals-screen"
      style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 32px 80px', color: 'var(--ink)' }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          paddingBottom: 14,
          marginBottom: 18,
          borderBottom: '1px solid var(--rule)',
          flexWrap: 'wrap',
        }}
      >
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: '2.25rem',
            letterSpacing: '-0.015em',
            margin: 0,
          }}
        >
          Awaiting your call
        </h1>
        <span
          data-testid="approvals-count"
          className="smallcaps"
          style={{ color: 'var(--gray-soft)' }}
          aria-hidden="true"
        >
          {visible.length} of {rows.length}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            color: 'var(--gray)',
            fontSize: 14,
          }}
        >
          Nothing leaves Aria without this page.
        </span>
      </header>

      <div
        role="group"
        aria-label="Filter by state"
        style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <span
          className="smallcaps"
          style={{ color: 'var(--gray-soft)', marginRight: 4 }}
          aria-hidden="true"
        >
          Filter
        </span>
        {FILTERABLE_STATES.map((s) => {
          const on = stateFilter.has(s);
          const count = rows.filter((r) => r.state === s).length;
          return (
            <button
              key={s}
              type="button"
              data-testid={`approvals-filter-${s}`}
              aria-pressed={on}
              onClick={() => toggleFilter(s)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                borderRadius: 999,
                fontFamily: 'var(--f-mono)',
                fontSize: 10.5,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                border: `1px solid ${on ? 'var(--ink)' : 'var(--rule)'}`,
                background: on ? 'var(--ink)' : 'transparent',
                color: on ? 'var(--ivory)' : 'var(--gray)',
                cursor: 'pointer',
                transition: 'all var(--t)',
              }}
            >
              {s} <span style={{ opacity: 0.7 }}>· {count}</span>
            </button>
          );
        })}
      </div>

      {actionError && (
        <p
          role="alert"
          data-testid="approvals-error"
          style={{
            color: 'var(--rose)',
            fontSize: 13,
            background: 'rgba(184,73,58,0.08)',
            border: '1px solid rgba(184,73,58,0.25)',
            padding: '8px 12px',
            borderRadius: 6,
            margin: '0 0 12px 0',
          }}
        >
          {actionError}
        </p>
      )}

      {selected.size > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            background: 'rgba(184,134,11,0.08)',
            border: '1px solid rgba(184,134,11,0.25)',
            borderRadius: 6,
            marginBottom: 14,
          }}
        >
          <span data-testid="approvals-batch-summary" style={{ fontSize: 13, color: 'var(--ink)' }}>
            <strong>{selected.size}</strong> selected ·{' '}
            <span style={{ color: 'var(--gray)' }}>{batchableCount} ready to approve</span>
          </span>
          <span style={{ flex: 1 }} />
          <Button
            variant="primary"
            data-testid="approvals-batch-approve"
            disabled={batchableCount === 0}
            onClick={() => setConfirmOpen(true)}
            style={{
              minHeight: 30,
              padding: '0 14px',
              fontSize: 12.5,
              opacity: batchableCount === 0 ? 0.4 : 1,
            }}
          >
            Batch approve
          </Button>
          <Button
            variant="ghost"
            data-testid="approvals-batch-clear"
            onClick={() => setSelected(new Set())}
            style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
          >
            Clear
          </Button>
        </div>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="approvals-batch-confirm"
          style={{
            border: '1px solid var(--rule-strong)',
            background: 'var(--ivory-deep)',
            padding: '14px 18px',
            borderRadius: 6,
            marginBottom: 14,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <p style={{ margin: 0, flex: 1, minWidth: 240, color: 'var(--ink-soft)' }}>
            Approve {batchableCount} ready draft(s)? Approvals are final and unlock the send gate
            for each row. This action cannot be undone in batch.
          </p>
          <Button
            variant="primary"
            data-testid="approvals-batch-confirm-btn"
            onClick={() => void runBatchApprove()}
            style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
          >
            Confirm batch approve
          </Button>
          <Button
            variant="ghost"
            data-testid="approvals-batch-cancel-btn"
            onClick={() => setConfirmOpen(false)}
            style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5 }}
          >
            Cancel
          </Button>
        </div>
      )}

      {!loaded && (
        <div data-testid="approvals-loading">
          <SkeletonRoot style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[88, 72, 88, 64].map((h, i) => (
              <div
                key={i}
                style={{
                  padding: '16px 18px',
                  border: '1px solid var(--rule)',
                  borderRadius: 'var(--radius-lg)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <SkeletonLine width={56} height={10} />
                  <SkeletonLine width={120} height={13} />
                </div>
                <SkeletonBlock width="100%" height={h - 40} radius={4} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <SkeletonLine width={72} height={28} style={{ borderRadius: 6 }} />
                  <SkeletonLine width={72} height={28} style={{ borderRadius: 6 }} />
                </div>
              </div>
            ))}
          </SkeletonRoot>
        </div>
      )}
      {loaded && visible.length === 0 && (
        <p
          data-testid="approvals-empty"
          style={{
            padding: '48px 0',
            textAlign: 'center',
            color: 'var(--gray-soft)',
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontSize: 15,
          }}
        >
          No approvals match the current filter.
        </p>
      )}

      <ApprovalQueue
        rows={visible}
        selected={selected}
        onSelect={toggleSelect}
        onApprove={runApprove}
        onReject={runReject}
        onSnooze={runSnooze}
        onCancelStuck={runCancelStuck}
      />
    </section>
  );
}

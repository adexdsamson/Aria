/**
 * Phase 11 Plan 02 — ResearchScreen.
 * Two-column shell: 240px left rail (suggested + job list) + flex-1 right panel.
 * Subscribes to RESEARCH_REPORT_DONE push events via window.aria.onResearchReportDone.
 * Pattern: RecapScreen.tsx (two-pane layout).
 */
import { useEffect, useState } from 'react';
import type { ResearchJobDto, ResearchReportDto, ResearchFeedbackDto } from '../../../shared/ipc-contract';
import { NewResearchJobModal } from './NewResearchJobModal';
import { ReportDocumentView } from './ReportDocumentView';
import { ReportDashboardView } from './ReportDashboardView';
import { RerunModal } from './RerunModal';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

const statusBadgeStyle = (status: ResearchJobDto['status']): React.CSSProperties => {
  const colors: Record<string, { bg: string; color: string }> = {
    draft: { bg: 'rgba(184,134,11,0.12)', color: 'var(--gold-deep)' },
    running: { bg: 'rgba(41,128,185,0.12)', color: '#2980b9' },
    done: { bg: 'rgba(39,174,96,0.12)', color: '#27ae60' },
    failed: { bg: 'rgba(192,57,43,0.12)', color: '#c0392b' },
  };
  const c = colors[status] ?? colors.draft;
  return {
    fontFamily: 'var(--f-mono)',
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '2px 6px',
    borderRadius: 3,
    background: c.bg,
    color: c.color,
  };
};

export function ResearchScreen(): JSX.Element {
  const [jobs, setJobs] = useState<ResearchJobDto[]>([]);
  const [suggestions, setSuggestions] = useState<ResearchJobDto[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [reports, setReports] = useState<ResearchReportDto[]>([]);
  const [reportIndex, setReportIndex] = useState(0);
  const [view, setView] = useState<'document' | 'dashboard'>('document');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [rerunOpen, setRerunOpen] = useState(false);

  async function refreshJobs(): Promise<void> {
    const res = await window.aria.researchJobList({});
    if (isErr(res)) { setError(res.error); return; }
    setJobs(res.jobs);
    setLoaded(true);
  }

  async function refreshSuggestions(): Promise<void> {
    const res = await window.aria.researchSuggestionsGet({});
    if (!isErr(res)) setSuggestions(res.jobs);
  }

  async function loadReportsForJob(jobId: string): Promise<void> {
    const res = await window.aria.researchReportList({ jobId });
    if (isErr(res)) return;
    setReports(res.reports);
    setReportIndex(0);
  }

  useEffect(() => {
    void refreshJobs();
    void refreshSuggestions();
  }, []);

  useEffect(() => {
    if (!selectedJobId) { setReports([]); return; }
    void loadReportsForJob(selectedJobId);
  }, [selectedJobId]);

  // Push event subscription
  useEffect(() => {
    const off = window.aria.onResearchReportDone?.(({ jobId }) => {
      if (jobId === selectedJobId) void loadReportsForJob(jobId);
      void refreshJobs();
    });
    return () => off?.();
  }, [selectedJobId]);

  async function approveSuggestion(jobId: string): Promise<void> {
    await window.aria.researchSuggestionApprove({ jobId });
    void refreshJobs();
    void refreshSuggestions();
  }

  async function dismissSuggestion(jobId: string): Promise<void> {
    await window.aria.researchSuggestionDismiss({ jobId });
    void refreshSuggestions();
  }

  async function handleRerun(opts: { feedbackContext: string }): Promise<void> {
    if (!selectedJobId) return;
    await window.aria.researchJobRun({ jobId: selectedJobId, feedbackContext: opts.feedbackContext });
    void refreshJobs();
  }

  const currentReport = reports[reportIndex] ?? null;
  const allFeedback: ResearchFeedbackDto[] = currentReport?.sections.flatMap((s) => s.feedback ? [s.feedback] : []) ?? [];

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
      <div style={{ display: 'flex', height: '100%', background: 'var(--bg)' }}>
        {/* Left rail */}
        <aside
          style={{
            width: 240,
            borderRight: '1px solid var(--rule)',
            overflowY: 'auto',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Header */}
          <div style={{ padding: '16px 12px 8px', borderBottom: '1px solid var(--rule)' }}>
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--gold)',
                marginBottom: 8,
              }}
            >
              Research
            </div>
            <button
              onClick={() => setModalOpen(true)}
              style={{
                width: '100%',
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                background: 'var(--gold)',
                color: 'var(--bg)',
                border: 'none',
                borderRadius: 4,
                padding: '8px 0',
                cursor: 'pointer',
              }}
            >
              + New Research
            </button>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div style={{ borderBottom: '1px solid var(--rule)' }}>
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: 'var(--gray-soft)',
                  padding: '10px 12px 6px',
                }}
              >
                Suggested
              </div>
              {suggestions.map((j) => (
                <div
                  key={j.id}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 12,
                      marginBottom: 6,
                    }}
                  >
                    {j.title}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => void approveSuggestion(j.id)}
                      style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize: 11,
                        background: 'var(--gold)',
                        color: 'var(--bg)',
                        border: 'none',
                        borderRadius: 3,
                        padding: '3px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => void dismissSuggestion(j.id)}
                      style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize: 11,
                        background: 'none',
                        color: 'var(--gray-soft)',
                        border: '1px solid var(--rule)',
                        borderRadius: 3,
                        padding: '3px 8px',
                        cursor: 'pointer',
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Job list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {!loaded && (
              <div
                style={{
                  padding: 12,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  color: 'var(--gray-soft)',
                }}
              >
                Loading…
              </div>
            )}
            {loaded && jobs.length === 0 && (
              <div
                style={{
                  padding: 12,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  color: 'var(--gray-soft)',
                }}
              >
                No research jobs yet.
              </div>
            )}
            {jobs.map((j) => (
              <div
                key={j.id}
                onClick={() => setSelectedJobId(j.id)}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--rule)',
                  cursor: 'pointer',
                  borderLeft: j.id === selectedJobId ? '2px solid var(--gold)' : '2px solid transparent',
                  background: j.id === selectedJobId ? 'rgba(184,134,11,0.04)' : 'transparent',
                  animation: `fadeUp 200ms ${EASE_OUT} both`,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 12,
                    marginBottom: 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {j.title}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={statusBadgeStyle(j.status)}>{j.status}</span>
                  <span
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      color: 'var(--gray-soft)',
                    }}
                  >
                    {new Date(j.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                {j.domains.length > 0 && (
                  <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {j.domains.slice(0, 3).map((d) => (
                      <span
                        key={d}
                        style={{
                          fontFamily: 'var(--f-mono)',
                          fontSize: 10,
                          color: 'var(--gray-soft)',
                          background: 'rgba(184,134,11,0.07)',
                          borderRadius: 3,
                          padding: '1px 4px',
                        }}
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </aside>

        {/* Right panel */}
        <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {!selectedJobId && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'var(--f-serif)',
                fontStyle: 'italic',
                color: 'var(--gray-soft)',
                fontSize: 18,
              }}
            >
              Select a research job to view its report
            </div>
          )}

          {selectedJobId && currentReport && (
            <>
              {/* View toggle + actions */}
              <div
                style={{
                  padding: '12px 24px',
                  borderBottom: '1px solid var(--rule)',
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                <button
                  onClick={() => setView('document')}
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 12,
                    background: view === 'document' ? 'var(--gold)' : 'none',
                    color: view === 'document' ? 'var(--bg)' : 'var(--gray-soft)',
                    border: '1px solid var(--rule)',
                    borderRadius: 4,
                    padding: '5px 14px',
                    cursor: 'pointer',
                  }}
                >
                  Document
                </button>
                <button
                  onClick={() => setView('dashboard')}
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 12,
                    background: view === 'dashboard' ? 'var(--gold)' : 'none',
                    color: view === 'dashboard' ? 'var(--bg)' : 'var(--gray-soft)',
                    border: '1px solid var(--rule)',
                    borderRadius: 4,
                    padding: '5px 14px',
                    cursor: 'pointer',
                  }}
                >
                  Dashboard
                </button>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setRerunOpen(true)}
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 12,
                    background: 'none',
                    border: '1px solid var(--rule)',
                    borderRadius: 4,
                    padding: '5px 14px',
                    cursor: 'pointer',
                    color: 'var(--gray-soft)',
                  }}
                >
                  Re-run
                </button>
              </div>

              {view === 'document' && (
                <ReportDocumentView
                  report={currentReport}
                  totalVersions={reports.length}
                  hasPriorVersion={reportIndex < reports.length - 1}
                  hasNewerVersion={reportIndex > 0}
                  onOlderVersion={() => setReportIndex((i) => Math.min(i + 1, reports.length - 1))}
                  onNewerVersion={() => setReportIndex((i) => Math.max(i - 1, 0))}
                />
              )}
              {view === 'dashboard' && (
                <ReportDashboardView report={currentReport} />
              )}
            </>
          )}

          {selectedJobId && !currentReport && loaded && (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                gap: 16,
                fontFamily: 'var(--f-mono)',
                color: 'var(--gray-soft)',
              }}
            >
              <div style={{ fontSize: 14 }}>No report yet for this job.</div>
              <button
                onClick={() => void window.aria.researchJobRun({ jobId: selectedJobId }).then(() => void refreshJobs())}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 12,
                  background: 'var(--gold)',
                  color: 'var(--bg)',
                  border: 'none',
                  borderRadius: 4,
                  padding: '8px 20px',
                  cursor: 'pointer',
                }}
              >
                Run now
              </button>
            </div>
          )}
        </main>
      </div>

      {error && (
        <div
          style={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            color: '#c0392b',
            background: 'var(--bg)',
            border: '1px solid #c0392b',
            borderRadius: 4,
            padding: '8px 14px',
          }}
        >
          {error}
        </div>
      )}

      {modalOpen && (
        <NewResearchJobModal
          onClose={() => setModalOpen(false)}
          onCreated={(j) => {
            setJobs((prev) => [j, ...prev]);
            setSelectedJobId(j.id);
          }}
        />
      )}

      {rerunOpen && currentReport && (
        <RerunModal
          feedbackItems={allFeedback}
          onClose={() => setRerunOpen(false)}
          onRerun={handleRerun}
        />
      )}
    </>
  );
}

/**
 * Phase 11 Plan 02 — ResearchScreen.
 * Two-column shell: 260px left rail + flex-1 right panel.
 * Editorial redesign: serif job titles, status pips, refined empty state.
 */
import { useEffect, useState } from 'react';
import type { ResearchJobDto, ResearchReportDto, ResearchFeedbackDto } from '../../../shared/ipc-contract';
import { NewResearchJobModal } from './NewResearchJobModal';
import { ReportDocumentView } from './ReportDocumentView';
import { ReportDashboardView } from './ReportDashboardView';
import { RerunModal } from './RerunModal';

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';

function isErr(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

const STATUS_PIP: Record<ResearchJobDto['status'], { color: string; label: string }> = {
  draft:   { color: 'var(--gold)',   label: 'Draft'   },
  running: { color: '#3b82f6',       label: 'Running' },
  done:    { color: '#16a34a',       label: 'Done'    },
  failed:  { color: '#dc2626',       label: 'Failed'  },
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
  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;

  return (
    <>
      <style>{`
        @keyframes rs-fadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: none; }
        }
        @keyframes rs-pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.4; }
        }
        .rs-job-row { transition: background 120ms ease; }
        .rs-job-row:hover { background: rgba(184,134,11,0.03) !important; }
        .rs-pill-btn { transition: all 140ms ease; }
        .rs-pill-btn:hover { opacity: 0.85; }
        .rs-action-btn { transition: opacity 150ms ease; }
        .rs-action-btn:hover { opacity: 0.75; }
        .rs-new-btn:hover { filter: brightness(1.08); }
        .rs-new-btn { transition: filter 150ms ease; }
      `}</style>

      <div style={{ display: 'flex', height: '100%', background: 'var(--bg)' }}>

        {/* ── Left rail ── */}
        <aside style={{
          width: 260,
          borderRight: '1px solid var(--rule)',
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          background: 'var(--ivory, #faf8f4)',
        }}>
          {/* Rail header */}
          <div style={{ padding: '20px 16px 14px' }}>
            <div style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 12,
            }}>
              Research
            </div>
            <button
              className="rs-new-btn"
              onClick={() => setModalOpen(true)}
              style={{
                width: '100%',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                letterSpacing: '0.06em',
                background: 'var(--gold)',
                color: 'var(--bg, #fff)',
                border: 'none',
                borderRadius: 5,
                padding: '9px 0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              New Research
            </button>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div style={{ borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
              <div style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 9,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--ink-soft, #9b9080)',
                padding: '10px 16px 6px',
              }}>
                Suggested
              </div>
              {suggestions.map((j) => (
                <div key={j.id} style={{ padding: '8px 16px 10px', borderBottom: '1px solid var(--rule)' }}>
                  <div style={{
                    fontFamily: 'var(--f-serif, Georgia)',
                    fontSize: 13,
                    color: 'var(--ink)',
                    marginBottom: 8,
                    lineHeight: 1.35,
                  }}>
                    {j.title}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      className="rs-pill-btn"
                      onClick={() => void approveSuggestion(j.id)}
                      style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.05em',
                        background: 'var(--gold)', color: 'var(--bg)',
                        border: 'none', borderRadius: 3, padding: '3px 9px', cursor: 'pointer',
                      }}
                    >Approve</button>
                    <button
                      className="rs-pill-btn"
                      onClick={() => void dismissSuggestion(j.id)}
                      style={{
                        fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.05em',
                        background: 'none', color: 'var(--ink-soft, #9b9080)',
                        border: '1px solid var(--rule)', borderRadius: 3, padding: '3px 9px', cursor: 'pointer',
                      }}
                    >Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Job list */}
          <div style={{ flex: 1, overflowY: 'auto', borderTop: suggestions.length === 0 ? '1px solid var(--rule)' : undefined }}>
            {!loaded && (
              <div style={{ padding: '20px 16px', fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--ink-soft, #9b9080)' }}>
                Loading…
              </div>
            )}

            {loaded && jobs.length === 0 && (
              <div style={{
                padding: '32px 16px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                textAlign: 'center',
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                </svg>
                <div style={{ fontFamily: 'var(--f-serif, Georgia)', fontStyle: 'italic', fontSize: 14, color: 'var(--ink-soft, #9b9080)', lineHeight: 1.5 }}>
                  No research jobs yet.<br/>Start one above.
                </div>
              </div>
            )}

            {jobs.map((j, idx) => {
              const pip = STATUS_PIP[j.status] ?? STATUS_PIP.draft;
              const isActive = j.id === selectedJobId;
              return (
                <div
                  key={j.id}
                  className="rs-job-row"
                  onClick={() => setSelectedJobId(j.id)}
                  style={{
                    padding: '11px 16px',
                    borderBottom: '1px solid var(--rule)',
                    cursor: 'pointer',
                    borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
                    background: isActive ? 'rgba(184,134,11,0.05)' : 'transparent',
                    animation: `rs-fadeUp 200ms ${EASE} ${idx * 30}ms both`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        background: pip.color,
                        flexShrink: 0,
                        marginTop: 5,
                        animation: j.status === 'running' ? `rs-pulse 1.4s ease infinite` : undefined,
                      }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'var(--f-serif, Georgia)',
                        fontSize: 13,
                        color: 'var(--ink)',
                        lineHeight: 1.35,
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        marginBottom: 5,
                      }}>
                        {j.title}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          fontFamily: 'var(--f-mono)',
                          fontSize: 9,
                          letterSpacing: '0.07em',
                          textTransform: 'uppercase',
                          color: pip.color,
                        }}>
                          {pip.label}
                        </span>
                        <span style={{
                          fontFamily: 'var(--f-mono)',
                          fontSize: 9,
                          color: 'var(--ink-soft, #9b9080)',
                        }}>
                          {new Date(j.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>
                      {j.domains.length > 0 && (
                        <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                          {j.domains.slice(0, 2).map((d) => (
                            <span key={d} style={{
                              fontFamily: 'var(--f-mono)',
                              fontSize: 9,
                              color: 'var(--ink-soft, #9b9080)',
                              background: 'rgba(184,134,11,0.08)',
                              borderRadius: 2,
                              padding: '1px 5px',
                            }}>
                              {d}
                            </span>
                          ))}
                          {j.domains.length > 2 && (
                            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 9, color: 'var(--ink-soft, #9b9080)' }}>
                              +{j.domains.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* ── Right panel ── */}
        <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

          {/* Empty state — no selection */}
          {!selectedJobId && (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              padding: 40,
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(184,134,11,0.3)" strokeWidth="1" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                <line x1="8" y1="11" x2="14" y2="11"/>
                <line x1="11" y1="8" x2="11" y2="14"/>
              </svg>
              <div style={{
                fontFamily: 'var(--f-serif, Georgia)',
                fontStyle: 'italic',
                fontSize: 17,
                color: 'var(--ink-soft, #9b9080)',
                textAlign: 'center',
                lineHeight: 1.5,
              }}>
                Select a research job<br/>to view its report
              </div>
            </div>
          )}

          {/* Report panel */}
          {selectedJobId && currentReport && (
            <>
              {/* Panel header */}
              <div style={{
                padding: '14px 28px',
                borderBottom: '1px solid var(--rule)',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--ivory, #faf8f4)',
              }}>
                {/* View toggle — pill style */}
                <div style={{
                  display: 'flex',
                  background: 'var(--bg)',
                  border: '1px solid var(--rule)',
                  borderRadius: 6,
                  padding: 2,
                  gap: 2,
                }}>
                  {(['document', 'dashboard'] as const).map((v) => (
                    <button
                      key={v}
                      className="rs-pill-btn"
                      onClick={() => setView(v)}
                      style={{
                        fontFamily: 'var(--f-mono)',
                        fontSize: 11,
                        letterSpacing: '0.04em',
                        background: view === v ? 'var(--gold)' : 'transparent',
                        color: view === v ? 'var(--bg)' : 'var(--ink-soft, #6b6455)',
                        border: 'none',
                        borderRadius: 4,
                        padding: '5px 14px',
                        cursor: 'pointer',
                      }}
                    >
                      {v.charAt(0).toUpperCase() + v.slice(1)}
                    </button>
                  ))}
                </div>

                <div style={{ flex: 1 }} />

                {selectedJob && (
                  <div style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    color: STATUS_PIP[selectedJob.status]?.color ?? 'var(--gold)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}>
                    <span style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: STATUS_PIP[selectedJob.status]?.color ?? 'var(--gold)',
                      display: 'inline-block',
                      animation: selectedJob.status === 'running' ? `rs-pulse 1.4s ease infinite` : undefined,
                    }} />
                    {STATUS_PIP[selectedJob.status]?.label}
                  </div>
                )}

                <button
                  className="rs-action-btn"
                  onClick={() => setRerunOpen(true)}
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    letterSpacing: '0.04em',
                    background: 'none',
                    border: '1px solid var(--rule)',
                    borderRadius: 4,
                    padding: '6px 14px',
                    cursor: 'pointer',
                    color: 'var(--ink-soft, #6b6455)',
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
              {view === 'dashboard' && <ReportDashboardView report={currentReport} />}
            </>
          )}

          {/* Selected job but no report yet */}
          {selectedJobId && !currentReport && loaded && (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 20,
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(184,134,11,0.35)" strokeWidth="1" strokeLinecap="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <div style={{
                fontFamily: 'var(--f-serif, Georgia)',
                fontStyle: 'italic',
                fontSize: 16,
                color: 'var(--ink-soft, #9b9080)',
              }}>
                No report yet for this job.
              </div>
              <button
                className="rs-new-btn"
                onClick={() => void window.aria.researchJobRun({ jobId: selectedJobId }).then(() => void refreshJobs())}
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  letterSpacing: '0.06em',
                  background: 'var(--gold)',
                  color: 'var(--bg)',
                  border: 'none',
                  borderRadius: 5,
                  padding: '9px 22px',
                  cursor: 'pointer',
                }}
              >
                Run now
              </button>
            </div>
          )}
        </main>
      </div>

      {/* Error toast */}
      {error && (
        <div style={{
          position: 'fixed', bottom: 16, right: 16,
          fontFamily: 'var(--f-mono)', fontSize: 11,
          color: '#dc2626', background: 'var(--bg)',
          border: '1px solid #dc2626', borderRadius: 4,
          padding: '8px 14px',
          animation: `rs-fadeUp 200ms ${EASE} both`,
        }}>
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

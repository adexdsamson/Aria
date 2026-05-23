/**
 * Phase 11 Plan 02 — ReportDocumentView.
 * Renders rich research reports: executive summary + key takeaways,
 * deep findings with analysis/keyPoints/actionableInsights,
 * recommendations ranked by priority, sources table, version nav.
 */
import type { ResearchReportDto, ResearchReportSectionDto } from '../../../shared/ipc-contract';
import { FeedbackBar } from './FeedbackBar';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// ---- Schema types (must match ResearchSynthesisSchema in ResearchService) ----

interface SummarySection {
  executive?: string;
  summary?: string; // legacy fallback
  keyTakeaways?: string[];
}

interface Finding {
  heading: string;
  // new fields
  analysis?: string;
  keyPoints?: string[];
  actionableInsights?: string[];
  // legacy fallback
  body?: string;
  sourceUrls: string[];
}

interface Recommendation {
  action: string;
  rationale: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  timeframe: string;
}

interface Source {
  title: string;
  url: string;
  domain: string;
  relevance?: string;
}

// ---- Helpers ----

function parseSection(section: ResearchReportSectionDto): unknown {
  try { return JSON.parse(section.contentJson); } catch { return null; }
}

const PRIORITY_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  critical: { bg: 'rgba(180,30,30,0.08)', color: '#b41e1e', label: 'CRITICAL' },
  high:     { bg: 'rgba(180,140,30,0.10)', color: 'var(--gold)', label: 'HIGH' },
  medium:   { bg: 'rgba(60,100,160,0.08)', color: '#3c64a0', label: 'MEDIUM' },
  low:      { bg: 'rgba(100,100,100,0.06)', color: 'var(--ink-soft, #6b6455)', label: 'LOW' },
};

// ---- Component ----

export interface ReportDocumentViewProps {
  report: ResearchReportDto;
  totalVersions: number;
  onOlderVersion: () => void;
  onNewerVersion: () => void;
  hasPriorVersion: boolean;
  hasNewerVersion: boolean;
}

export function ReportDocumentView({
  report,
  totalVersions,
  onOlderVersion,
  onNewerVersion,
  hasPriorVersion,
  hasNewerVersion,
}: ReportDocumentViewProps): JSX.Element {

  // Parse all sections
  const summarySection = report.sections.find((s) => s.sectionType === 'summary');
  const findingsSection = report.sections.find((s) => s.sectionType === 'findings');
  const recsSection = report.sections.find((s) => s.sectionType === 'recommendations');
  const sourcesSection = report.sections.find((s) => s.sectionType === 'sources');

  const summaryData = summarySection ? (parseSection(summarySection) as SummarySection | null) : null;
  const execText = summaryData?.executive ?? summaryData?.summary ?? report.summary ?? null;
  const keyTakeaways: string[] = summaryData?.keyTakeaways ?? [];

  const allFindings: (Finding & { sectionId: string })[] = [];
  if (findingsSection) {
    const data = parseSection(findingsSection);
    if (Array.isArray(data)) {
      for (const f of data as Finding[]) allFindings.push({ ...f, sectionId: findingsSection.id });
    }
  }

  const recommendations: Recommendation[] = [];
  if (recsSection) {
    const data = parseSection(recsSection);
    if (Array.isArray(data)) recommendations.push(...(data as Recommendation[]));
  }

  const allSources: Source[] = [];
  if (sourcesSection) {
    const data = parseSection(sourcesSection);
    if (Array.isArray(data)) allSources.push(...(data as Source[]));
    else if (data && typeof data === 'object' && Array.isArray((data as { sources?: unknown }).sources)) {
      allSources.push(...((data as { sources: Source[] }).sources));
    }
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: none; }
        }
        .rpt-finding:hover { background: rgba(184,134,11,0.03); }
        .rpt-rec-card:hover { transform: translateX(2px); }
        .rpt-source-row:hover td { background: rgba(184,134,11,0.04); }
      `}</style>

      <div style={{ padding: '32px 40px 48px', maxWidth: 800, margin: '0 auto' }}>

        {/* ── Executive Summary ── */}
        {execText && (
          <div
            style={{
              borderLeft: '3px solid var(--gold)',
              paddingLeft: 20,
              marginBottom: 28,
              animation: `fadeUp 320ms ${EASE_OUT} both`,
            }}
          >
            <div style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 10,
            }}>
              Executive Summary
            </div>
            <p style={{
              fontFamily: 'var(--f-serif)',
              fontStyle: 'italic',
              fontSize: 16,
              lineHeight: 1.7,
              color: 'var(--ink)',
              margin: '0 0 12px',
            }}>
              {execText}
            </p>
            {report.confidenceScore != null && (
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray-soft)' }}>
                Confidence: {report.confidenceScore}%
              </div>
            )}
          </div>
        )}

        {/* ── Key Takeaways ── */}
        {keyTakeaways.length > 0 && (
          <div
            style={{
              background: 'rgba(184,134,11,0.05)',
              border: '1px solid rgba(184,134,11,0.18)',
              borderRadius: 6,
              padding: '16px 20px',
              marginBottom: 32,
              animation: `fadeUp 320ms ${EASE_OUT} 40ms both`,
            }}
          >
            <div style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 10,
            }}>
              Key Takeaways
            </div>
            <ul style={{ margin: 0, padding: '0 0 0 18px' }}>
              {keyTakeaways.map((pt, i) => (
                <li key={i} style={{
                  fontFamily: 'var(--f-sans, sans-serif)',
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: 'var(--ink)',
                  marginBottom: i < keyTakeaways.length - 1 ? 6 : 0,
                }}>
                  {pt}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Findings ── */}
        {allFindings.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <div style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 14,
            }}>
              Key Findings
            </div>

            {allFindings.map((f, i) => (
              <div
                key={i}
                className="rpt-finding"
                style={{
                  border: '1px solid var(--rule)',
                  borderRadius: 7,
                  padding: '20px 22px',
                  marginBottom: 14,
                  transition: 'background 0.15s',
                  animation: `fadeUp 320ms ${EASE_OUT} both`,
                  animationDelay: `${60 + i * 40}ms`,
                }}
              >
                {/* Finding heading */}
                <div style={{
                  fontFamily: 'var(--f-serif)',
                  fontWeight: 600,
                  fontSize: 16,
                  color: 'var(--ink)',
                  marginBottom: 10,
                  lineHeight: 1.3,
                }}>
                  {f.heading}
                </div>

                {/* Analysis (new) or body (legacy) */}
                {(f.analysis ?? f.body) && (
                  <p style={{
                    fontFamily: 'var(--f-sans, sans-serif)',
                    fontSize: 13.5,
                    lineHeight: 1.7,
                    color: 'var(--ink)',
                    margin: '0 0 14px',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {f.analysis ?? f.body}
                  </p>
                )}

                {/* Key points */}
                {f.keyPoints && f.keyPoints.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'var(--gray-soft)',
                      marginBottom: 6,
                    }}>
                      Key Points
                    </div>
                    <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                      {f.keyPoints.map((pt, j) => (
                        <li key={j} style={{
                          fontFamily: 'var(--f-sans, sans-serif)',
                          fontSize: 13,
                          lineHeight: 1.55,
                          color: 'var(--ink)',
                          marginBottom: 4,
                        }}>
                          {pt}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actionable insights */}
                {f.actionableInsights && f.actionableInsights.length > 0 && (
                  <div style={{
                    background: 'rgba(184,134,11,0.05)',
                    borderRadius: 4,
                    padding: '10px 14px',
                    marginBottom: 12,
                  }}>
                    <div style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'var(--gold)',
                      marginBottom: 6,
                    }}>
                      Actions
                    </div>
                    <ul style={{ margin: 0, padding: '0 0 0 16px' }}>
                      {f.actionableInsights.map((a, j) => (
                        <li key={j} style={{
                          fontFamily: 'var(--f-sans, sans-serif)',
                          fontSize: 13,
                          lineHeight: 1.55,
                          color: 'var(--ink)',
                          marginBottom: j < f.actionableInsights!.length - 1 ? 4 : 0,
                        }}>
                          {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Source URLs */}
                {f.sourceUrls && f.sourceUrls.length > 0 && (
                  <div style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 11,
                    color: 'var(--gray-soft)',
                    marginBottom: 8,
                    lineHeight: 1.5,
                  }}>
                    Sources: {f.sourceUrls.join(' · ')}
                  </div>
                )}

                <FeedbackBar reportId={report.id} sectionId={f.sectionId} />
              </div>
            ))}
          </div>
        )}

        {/* ── Recommendations ── */}
        {recommendations.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <div style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 14,
            }}>
              Recommendations
            </div>
            {recommendations.map((rec, i) => {
              const ps = PRIORITY_STYLE[rec.priority] ?? PRIORITY_STYLE.medium;
              return (
                <div
                  key={i}
                  className="rpt-rec-card"
                  style={{
                    display: 'flex',
                    gap: 14,
                    border: '1px solid var(--rule)',
                    borderRadius: 6,
                    padding: '14px 18px',
                    marginBottom: 10,
                    transition: 'transform 0.15s',
                    animation: `fadeUp 320ms ${EASE_OUT} both`,
                    animationDelay: `${80 + i * 35}ms`,
                  }}
                >
                  <div style={{ flexShrink: 0, paddingTop: 2 }}>
                    <span style={{
                      display: 'inline-block',
                      background: ps.bg,
                      color: ps.color,
                      fontFamily: 'var(--f-mono)',
                      fontSize: 9,
                      letterSpacing: '0.12em',
                      borderRadius: 3,
                      padding: '2px 7px',
                      whiteSpace: 'nowrap',
                    }}>
                      {ps.label}
                    </span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: 'var(--f-sans, sans-serif)',
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--ink)',
                      marginBottom: 4,
                      lineHeight: 1.3,
                    }}>
                      {rec.action}
                    </div>
                    <div style={{
                      fontFamily: 'var(--f-sans, sans-serif)',
                      fontSize: 13,
                      color: 'var(--ink-soft, #6b6455)',
                      lineHeight: 1.55,
                      marginBottom: 6,
                    }}>
                      {rec.rationale}
                    </div>
                    <div style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 11,
                      color: 'var(--gray-soft)',
                    }}>
                      {rec.timeframe}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Sources ── */}
        {allSources.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              marginBottom: 12,
            }}>
              Sources
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--f-mono)', fontSize: 12 }}>
              <thead>
                <tr>
                  {(['Title', 'Domain', 'Relevance', 'URL'] as const).map((h) => (
                    <th key={h} style={{
                      textAlign: 'left',
                      padding: '6px 8px 6px 0',
                      color: 'var(--gray-soft)',
                      fontWeight: 400,
                      borderBottom: '1px solid var(--rule)',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allSources.map((s, i) => (
                  <tr key={i} className="rpt-source-row">
                    <td style={{ padding: '7px 8px 7px 0', borderBottom: '1px solid var(--rule)' }}>{s.title}</td>
                    <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--rule)', color: 'var(--gray-soft)' }}>{s.domain}</td>
                    <td style={{ padding: '7px 8px', borderBottom: '1px solid var(--rule)', color: 'var(--gray-soft)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.relevance ?? '—'}
                    </td>
                    <td style={{ padding: '7px 0', borderBottom: '1px solid var(--rule)' }}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--gold)', textDecoration: 'none' }}
                      >
                        {s.url.slice(0, 55)}{s.url.length > 55 ? '…' : ''}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Whole-report feedback ── */}
        <FeedbackBar reportId={report.id} sectionId={null} />

        {/* ── Version nav ── */}
        <div style={{
          borderTop: '1px solid var(--rule)',
          padding: '14px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 28,
        }}>
          <button
            onClick={onOlderVersion}
            disabled={!hasPriorVersion}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              borderRadius: 4,
              padding: '5px 14px',
              fontFamily: 'var(--f-mono)',
              fontSize: 12,
              cursor: hasPriorVersion ? 'pointer' : 'not-allowed',
              color: hasPriorVersion ? 'inherit' : 'var(--gray-soft)',
            }}
          >
            ← Older
          </button>
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12, color: 'var(--gray-soft)' }}>
            Generated · {formatTs(report.generatedAt)} · Version {report.version} of {totalVersions}
          </span>
          <button
            onClick={onNewerVersion}
            disabled={!hasNewerVersion}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              borderRadius: 4,
              padding: '5px 14px',
              fontFamily: 'var(--f-mono)',
              fontSize: 12,
              cursor: hasNewerVersion ? 'pointer' : 'not-allowed',
              color: hasNewerVersion ? 'inherit' : 'var(--gray-soft)',
            }}
          >
            Newer →
          </button>
        </div>
      </div>
    </>
  );
}

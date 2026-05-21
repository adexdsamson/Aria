/**
 * Phase 11 Plan 02 — ReportDocumentView.
 * Summary card + key findings + sources table + version nav footer.
 * Pattern: BriefingScreen.tsx (editorial section cascade).
 */
import type { ResearchReportDto, ResearchReportSectionDto } from '../../../shared/ipc-contract';
import { FeedbackBar } from './FeedbackBar';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

function formatTs(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

interface Finding {
  heading: string;
  body: string;
  sourceUrls: string[];
}

interface Source {
  title: string;
  url: string;
  domain: string;
  relevance?: string;
}

function parseSection(section: ResearchReportSectionDto): unknown {
  try {
    return JSON.parse(section.contentJson);
  } catch {
    return null;
  }
}

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
  const findingsSections = report.sections.filter((s) => s.sectionType === 'findings');
  const sourcesSections = report.sections.filter((s) => s.sectionType === 'sources');

  const allFindings: (Finding & { sectionId: string })[] = [];
  for (const sec of findingsSections) {
    const data = parseSection(sec);
    if (Array.isArray(data)) {
      for (const f of data as Finding[]) {
        allFindings.push({ ...f, sectionId: sec.id });
      }
    }
  }

  const allSources: Source[] = [];
  for (const sec of sourcesSections) {
    const data = parseSection(sec);
    if (Array.isArray(data)) {
      allSources.push(...(data as Source[]));
    }
  }

  return (
    <>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: none; }
        }
      `}</style>
      <div style={{ padding: 32, maxWidth: 760, margin: '0 auto' }}>
        {/* Summary card */}
        {report.summary && (
          <div
            style={{
              borderLeft: '3px solid var(--gold)',
              paddingLeft: 16,
              marginBottom: 24,
              background: 'rgba(184,134,11,0.04)',
              animation: `fadeUp 320ms ${EASE_OUT} both`,
            }}
          >
            <p
              style={{
                fontFamily: 'var(--f-serif)',
                fontStyle: 'italic',
                fontSize: 16,
                lineHeight: 1.6,
                margin: '12px 0',
              }}
            >
              {report.summary}
            </p>
            {report.confidenceScore != null && (
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  color: 'var(--gray-soft)',
                  marginBottom: 8,
                }}
              >
                Confidence: {report.confidenceScore}%
              </div>
            )}
          </div>
        )}

        {/* Key findings */}
        {allFindings.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--gold)',
                marginBottom: 12,
              }}
            >
              Key Findings
            </div>
            {allFindings.map((f, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--rule)',
                  borderRadius: 6,
                  padding: 16,
                  marginBottom: 12,
                  animation: `fadeUp 320ms ${EASE_OUT} both`,
                  animationDelay: `${i * 50}ms`,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--f-serif)',
                    fontWeight: 600,
                    fontSize: 15,
                    marginBottom: 6,
                  }}
                >
                  {f.heading}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 13,
                    lineHeight: 1.5,
                    marginBottom: 8,
                  }}
                >
                  {f.body}
                </div>
                {f.sourceUrls && f.sourceUrls.length > 0 && (
                  <div
                    style={{
                      fontFamily: 'var(--f-mono)',
                      fontSize: 11,
                      color: 'var(--gray-soft)',
                    }}
                  >
                    Sources: {f.sourceUrls.join(', ')}
                  </div>
                )}
                <FeedbackBar reportId={report.id} sectionId={f.sectionId} />
              </div>
            ))}
          </div>
        )}

        {/* Sources table */}
        {allSources.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--gold)',
                marginBottom: 12,
              }}
            >
              Sources
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--f-mono)', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--gray-soft)', fontWeight: 400, borderBottom: '1px solid var(--rule)' }}>Title</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--gray-soft)', fontWeight: 400, borderBottom: '1px solid var(--rule)' }}>Domain</th>
                  <th style={{ textAlign: 'left', padding: '6px 0', color: 'var(--gray-soft)', fontWeight: 400, borderBottom: '1px solid var(--rule)' }}>URL</th>
                </tr>
              </thead>
              <tbody>
                {allSources.map((s, i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>{s.title}</td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--rule)', color: 'var(--gray-soft)' }}>{s.domain}</td>
                    <td style={{ padding: '6px 0', borderBottom: '1px solid var(--rule)' }}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--gold)', textDecoration: 'none' }}
                      >
                        {s.url.slice(0, 60)}{s.url.length > 60 ? '…' : ''}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Whole-report feedback */}
        <FeedbackBar reportId={report.id} sectionId={null} />

        {/* Version nav footer */}
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            padding: '12px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            marginTop: 24,
          }}
        >
          <button
            onClick={onOlderVersion}
            disabled={!hasPriorVersion}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              borderRadius: 4,
              padding: '4px 12px',
              fontFamily: 'var(--f-mono)',
              fontSize: 12,
              cursor: hasPriorVersion ? 'pointer' : 'not-allowed',
              color: hasPriorVersion ? 'inherit' : 'var(--gray-soft)',
            }}
          >
            ← Older
          </button>
          <span
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 12,
              color: 'var(--gray-soft)',
            }}
          >
            Generated · {formatTs(report.generatedAt)} · Version {report.version} of {totalVersions}
          </span>
          <button
            onClick={onNewerVersion}
            disabled={!hasNewerVersion}
            style={{
              background: 'none',
              border: '1px solid var(--rule)',
              borderRadius: 4,
              padding: '4px 12px',
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

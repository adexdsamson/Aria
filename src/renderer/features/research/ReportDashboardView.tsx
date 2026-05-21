/**
 * Phase 11 Plan 02 — ReportDashboardView.
 * 4-stat cards + CSS-only coverage chart + 2-col findings grid + sources table.
 * Pattern: RecapScreen.tsx (stat card layout).
 */
import type { ResearchReportDto, ResearchReportSectionDto } from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

interface Finding {
  heading: string;
  body: string;
  sourceUrls?: string[];
}

interface Source {
  title: string;
  url: string;
  domain: string;
}

function parseSection(section: ResearchReportSectionDto): unknown {
  try {
    return JSON.parse(section.contentJson);
  } catch {
    return null;
  }
}

export interface ReportDashboardViewProps {
  report: ResearchReportDto;
}

export function ReportDashboardView({ report }: ReportDashboardViewProps): JSX.Element {
  const findingsSections = report.sections.filter((s) => s.sectionType === 'findings');
  const sourcesSections = report.sections.filter((s) => s.sectionType === 'sources');

  const allFindings: Finding[] = [];
  for (const sec of findingsSections) {
    const data = parseSection(sec);
    if (Array.isArray(data)) allFindings.push(...(data as Finding[]));
  }

  const allSources: Source[] = [];
  for (const sec of sourcesSections) {
    const data = parseSection(sec);
    if (Array.isArray(data)) allSources.push(...(data as Source[]));
  }

  // Derive coverage data from sources
  const domainMap = new Map<string, number>();
  for (const s of allSources) {
    domainMap.set(s.domain, (domainMap.get(s.domain) ?? 0) + 1);
  }
  const domainEntries = [...domainMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxCount = domainEntries.reduce((m, [, n]) => Math.max(m, n), 1);
  const coverageData = domainEntries.map(([domain, count]) => ({
    domain,
    pct: Math.round((count / maxCount) * 100),
  }));

  const stats = [
    { label: 'Sources found', value: String(allSources.length) },
    { label: 'Domains covered', value: String(domainMap.size) },
    { label: 'Key findings', value: String(allFindings.length) },
    { label: 'Confidence', value: report.confidenceScore != null ? `${report.confidenceScore}%` : '—' },
  ];

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto' }}>
      {/* Stat cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 24,
        }}
      >
        {stats.map(({ label, value }) => (
          <div
            key={label}
            style={{
              border: '1px solid var(--rule)',
              borderRadius: 6,
              padding: '12px 16px',
            }}
          >
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                color: 'var(--gray-soft)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontFamily: 'var(--f-serif)',
                fontSize: 28,
                marginTop: 4,
              }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Coverage chart */}
      {coverageData.length > 0 && (
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
            Source Coverage
          </div>
          {coverageData.map(({ domain, pct }) => (
            <div
              key={domain}
              style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}
            >
              <span
                style={{
                  width: 120,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  flexShrink: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {domain}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  background: 'var(--rule)',
                  borderRadius: 4,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    width: `${pct}%`,
                    height: '100%',
                    background: 'var(--gold)',
                    borderRadius: 4,
                    transition: `width 400ms ${EASE_OUT}`,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  color: 'var(--gray-soft)',
                  width: 36,
                  textAlign: 'right',
                }}
              >
                {pct}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Findings grid */}
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 12,
            }}
          >
            {allFindings.map((f, i) => (
              <div
                key={i}
                style={{
                  border: '1px solid var(--rule)',
                  borderRadius: 6,
                  padding: 14,
                }}
              >
                <div
                  style={{
                    fontFamily: 'var(--f-serif)',
                    fontWeight: 600,
                    fontSize: 14,
                    marginBottom: 4,
                  }}
                >
                  {f.heading}
                </div>
                <div
                  style={{
                    fontFamily: 'var(--f-mono)',
                    fontSize: 12,
                    color: 'var(--gray-soft)',
                    lineHeight: 1.4,
                  }}
                >
                  {f.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sources table */}
      {allSources.length > 0 && (
        <div>
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
    </div>
  );
}

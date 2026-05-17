/**
 * SettingsScreen — composite shell mounting every Phase-1 settings subsection
 * (Plan 03 Task 2). Replaces the placeholder created by Plan 01b.
 *
 * Subsections:
 *   - /settings              → redirect to /settings/status
 *   - /settings/status       → <StatusPanel/>          (this plan)
 *   - /settings/frontier-key → <FrontierKeySection/>   (this plan)
 *   - /settings/ollama       → <OllamaSection/>        (this plan)
 *   - /settings/onboarding   → <BackupRestoreSection/> (Plan 02; re-exported)
 *   - /settings/diagnostics  → placeholder mount (Plan 04 wave 5 replaces it)
 *
 * Plan 04 will edit this file again to import and mount <DiagnosticsSection/>.
 */
import type * as React from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { BackupRestoreSection } from '../onboarding/BackupRestoreSection';
import { BriefingSettingsSection } from './BriefingSettingsSection';
import { DiagnosticsSection } from './DiagnosticsSection';
import { FrontierKeySection } from './FrontierKeySection';
import { IntegrationsSection } from './IntegrationsSection';
import { NewsSourcesSection } from './NewsSourcesSection';
import { OllamaSection } from './OllamaSection';
import { StatusPanel } from './StatusPanel';

const TABS: ReadonlyArray<{ to: string; label: string }> = [
  { to: 'status', label: 'Status' },
  { to: 'frontier-key', label: 'Frontier key' },
  { to: 'ollama', label: 'Local model' },
  { to: 'integrations', label: 'Integrations' },
  { to: 'news-sources', label: 'News sources' },
  { to: 'briefing', label: 'Briefing' },
  { to: 'onboarding', label: 'Backup & restore' },
  { to: 'diagnostics', label: 'Diagnostics' },
];

export function SettingsScreen(): JSX.Element {
  return (
    <div style={containerStyle()}>
      <aside style={tabsStyle()} aria-label="Settings sections">
        <h1 style={{ fontSize: 'var(--aria-type-2xl)', margin: 0, marginBottom: 'var(--aria-space-md)' }}>
          Settings
        </h1>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {TABS.map((t) => (
            <li key={t.to} style={{ marginBottom: 4 }}>
              <NavLink
                to={t.to}
                data-testid={`settings-nav-${t.to}`}
                style={({ isActive }) => ({
                  display: 'block',
                  padding: '6px 10px',
                  borderRadius: 6,
                  textDecoration: 'none',
                  color: isActive ? 'var(--aria-accent-fg)' : 'var(--aria-fg)',
                  backgroundColor: isActive ? 'var(--aria-accent)' : 'transparent',
                })}
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </aside>
      <div style={{ flex: '1 1 auto', overflowY: 'auto', minWidth: 0 }}>
        <Routes>
          <Route index element={<Navigate to="status" replace />} />
          <Route path="status" element={<StatusPanel />} />
          <Route path="frontier-key" element={<FrontierKeySection />} />
          <Route path="ollama" element={<OllamaSection />} />
          <Route path="integrations" element={<IntegrationsSection />} />
          <Route
            path="news-sources"
            element={
              <div data-testid="settings-news-sources-route">
                {/* mount point for data-testid="settings-news-sources" (NewsSourcesSection root) */}
                <NewsSourcesSection />
              </div>
            }
          />
          <Route
            path="briefing"
            element={
              <div data-testid="settings-briefing">
                {/* mount point — BriefingSettingsSection root also carries data-testid="settings-briefing" */}
                <BriefingSettingsSection />
              </div>
            }
          />
          <Route path="onboarding" element={<BackupRestoreSection />} />
          <Route path="diagnostics" element={<DiagnosticsSection />} />
          <Route path="*" element={<Navigate to="status" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function containerStyle(): React.CSSProperties {
  return { display: 'flex', height: '100%', width: '100%' };
}

function tabsStyle(): React.CSSProperties {
  return {
    width: 220,
    flex: '0 0 220px',
    borderRight: '1px solid var(--aria-border)',
    padding: 'var(--aria-space-md)',
    boxSizing: 'border-box',
  };
}

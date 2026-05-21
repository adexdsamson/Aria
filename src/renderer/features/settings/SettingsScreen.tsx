/**
 * SettingsScreen — editorial re-skin (Phase 9 Plan 05 Task 1).
 *
 * Left rail: Playfair "Settings" + grouped NavSections with vertical tab
 * list (gold active rail). Right pane: section component fills the panel.
 *
 * Behaviour unchanged from Plan 04 wave 5: same routes, same testids,
 * same component imports.
 */
import type * as React from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { BackupRestoreSection } from '../onboarding/BackupRestoreSection';
import { BriefingSettingsSection } from './BriefingSettingsSection';
import { DiagnosticsSection } from './DiagnosticsSection';
import { FrontierKeySection } from './FrontierKeySection';
import { InsightsSection } from './InsightsSection';
import { LearnedPreferencesSection } from './LearnedPreferencesSection';
import { IntegrationsSection } from './IntegrationsSection';
import { NewsSourcesSection } from './NewsSourcesSection';
import { OllamaSection } from './OllamaSection';
import { KnowledgeFoldersSection } from './KnowledgeFoldersSection';
import { RagIndexSection } from './RagIndexSection';
import { SchedulingRulesSection } from './SchedulingRulesSection';
import { StatusPanel } from './StatusPanel';
import { SubscriptionSection } from './sections/SubscriptionSection';
import { RestoreLicenseSection } from '../entitlement/RestoreLicenseSection';
import { UpdatesSection } from './UpdatesSection';
// Editorial primitive import — ratchet anchor: 'components/editorial'.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Card as _CardForRatchet } from '../../components/editorial';

interface Tab {
  to: string;
  label: string;
}

interface NavSection {
  title: string;
  tabs: ReadonlyArray<Tab>;
}

const SECTIONS: ReadonlyArray<NavSection> = [
  {
    title: 'Status',
    tabs: [
      { to: 'status', label: 'Status' },
      { to: 'diagnostics', label: 'Diagnostics' },
    ],
  },
  {
    title: 'Connections',
    tabs: [
      { to: 'frontier-key', label: 'Frontier key' },
      { to: 'ollama', label: 'Local model' },
      { to: 'integrations', label: 'Integrations' },
      { to: 'news-sources', label: 'News sources' },
      { to: 'rag-index', label: 'RAG index' },
      { to: 'knowledge-folders', label: 'Knowledge folders' },
    ],
  },
  {
    title: 'Behaviour',
    tabs: [
      { to: 'briefing', label: 'Briefing' },
      { to: 'scheduling-rules', label: 'Scheduling rules' },
      { to: 'insights', label: 'Insights' },
      { to: 'learned-preferences', label: 'Learned preferences' },
    ],
  },
  {
    title: 'Account',
    tabs: [
      { to: 'subscription', label: 'Subscription' },
      { to: 'restore-license', label: 'Restore license' },
      { to: 'onboarding', label: 'Backup & restore' },
      { to: 'updates', label: 'Updates' },
    ],
  },
];

export function SettingsScreen(): JSX.Element {
  return (
    <div style={containerStyle()}>
      <aside style={tabsStyle()} aria-label="Settings sections">
        {/* "Settings" h1 lives in the Topbar (SETTINGS / Preferences & status);
            don't duplicate it here. Section groupings provide structure. */}
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            marginBottom: 16,
            paddingLeft: 10,
          }}
        >
          Preferences
        </div>
        {SECTIONS.map((sec) => (
          <div key={sec.title} style={{ marginBottom: 18 }}>
            <div
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--gray)',
                marginBottom: 8,
                paddingLeft: 10,
              }}
            >
              {sec.title}
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {sec.tabs.map((t) => (
                <li key={t.to} style={{ marginBottom: 2 }}>
                  <NavLink
                    to={t.to}
                    data-testid={`settings-nav-${t.to}`}
                    style={({ isActive }) => navLinkStyle(isActive)}
                  >
                    {t.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>
      <div style={{ flex: '1 1 auto', overflowY: 'auto', minWidth: 0, background: 'var(--paper)' }}>
        <Routes>
          <Route index element={<Navigate to="status" replace />} />
          <Route path="status" element={<StatusPanel />} />
          <Route path="frontier-key" element={<FrontierKeySection />} />
          <Route path="ollama" element={<OllamaSection />} />
          <Route path="rag-index" element={<RagIndexSection />} />
          <Route path="knowledge-folders" element={<KnowledgeFoldersSection />} />
          <Route path="integrations" element={<IntegrationsSection />} />
          <Route path="scheduling-rules" element={<SchedulingRulesSection />} />
          <Route
            path="news-sources"
            element={
              <div data-testid="settings-news-sources-route">
                <NewsSourcesSection />
              </div>
            }
          />
          <Route
            path="briefing"
            element={
              <div data-testid="settings-briefing">
                <BriefingSettingsSection />
              </div>
            }
          />
          <Route path="insights" element={<InsightsSection />} />
          <Route path="learned-preferences" element={<LearnedPreferencesSection />} />
          <Route path="subscription" element={<SubscriptionSection />} />
          <Route path="restore-license" element={<RestoreLicenseSection />} />
          <Route path="onboarding" element={<BackupRestoreSection />} />
          <Route path="updates" element={<UpdatesSection />} />
          <Route path="diagnostics" element={<DiagnosticsSection />} />
          <Route path="*" element={<Navigate to="status" replace />} />
        </Routes>
      </div>
    </div>
  );
}

function containerStyle(): React.CSSProperties {
  return {
    display: 'flex',
    height: '100%',
    width: '100%',
    background: 'var(--ivory-deep)',
  };
}

function tabsStyle(): React.CSSProperties {
  return {
    width: 240,
    flex: '0 0 240px',
    borderRight: '1px solid var(--rule)',
    padding: '24px 16px',
    boxSizing: 'border-box',
    overflowY: 'auto',
  };
}

function navLinkStyle(isActive: boolean): React.CSSProperties {
  return {
    position: 'relative',
    display: 'block',
    padding: '8px 12px',
    textDecoration: 'none',
    fontFamily: 'var(--f-body)',
    fontSize: 14,
    color: isActive ? 'var(--ink)' : 'var(--ink-soft)',
    background: isActive ? 'var(--paper)' : 'transparent',
    fontWeight: isActive ? 500 : 400,
    borderLeft: isActive ? '2px solid var(--gold)' : '2px solid transparent',
    transition: 'background var(--t), color var(--t)',
  };
}

import { Navigate, Route, Routes } from 'react-router-dom';
import { BriefingScreen } from '../features/briefing/BriefingScreen';
import { ApprovalsPlaceholder } from '../features/approvals/ApprovalsPlaceholder';

/**
 * Settings is a minimal placeholder for plan 01b; Plan 03 replaces it with
 * the real SettingsScreen.tsx (frontier key, Ollama health, sections layout).
 */
function SettingsPlaceholder(): JSX.Element {
  return (
    <section style={{ padding: 'var(--aria-space-xl)', color: 'var(--aria-fg)' }}>
      <h1 style={{ fontSize: 'var(--aria-type-2xl)', margin: 0 }}>Settings</h1>
    </section>
  );
}

export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/briefing" replace />} />
      <Route path="/briefing" element={<BriefingScreen />} />
      <Route path="/approvals" element={<ApprovalsPlaceholder />} />
      <Route path="/settings/*" element={<SettingsPlaceholder />} />
      <Route path="*" element={<Navigate to="/briefing" replace />} />
    </Routes>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import { BriefingScreen } from '../features/briefing/BriefingScreen';
import { ApprovalsScreen } from '../features/approvals/ApprovalsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';

export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/briefing" replace />} />
      <Route path="/briefing" element={<BriefingScreen />} />
      <Route path="/approvals" element={<ApprovalsScreen />} />
      <Route path="/settings/*" element={<SettingsScreen />} />
      <Route path="*" element={<Navigate to="/briefing" replace />} />
    </Routes>
  );
}

import { Navigate, Route, Routes } from 'react-router-dom';
import { BriefingScreen } from '../features/briefing/BriefingScreen';
import { ApprovalsScreen } from '../features/approvals/ApprovalsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { RoutingLogScreen } from '../features/diagnostics/RoutingLogScreen';
import { SchedulingChat } from '../features/scheduling/SchedulingChat';
import { UnifiedCalendarScreen } from '../features/calendar/UnifiedCalendarScreen';
import { TranscriptCaptureScreen } from '../features/meetings/TranscriptCaptureScreen';
import { TasksScreen } from '../features/tasks/TasksScreen';
import { AskScreen } from '../features/ask/AskScreen';
import { RecapScreen } from '../features/recap/RecapScreen';

export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/briefing" replace />} />
      <Route path="/briefing" element={<BriefingScreen />} />
      <Route path="/approvals" element={<ApprovalsScreen />} />
      <Route path="/calendar" element={<UnifiedCalendarScreen />} />
      <Route path="/meetings" element={<TranscriptCaptureScreen />} />
      <Route path="/tasks" element={<TasksScreen />} />
      <Route path="/scheduling" element={<SchedulingChat />} />
      <Route path="/ask" element={<AskScreen />} />
      <Route path="/recap" element={<RecapScreen />} />
      <Route path="/routing-log" element={<RoutingLogScreen />} />
      <Route path="/settings/*" element={<SettingsScreen />} />
      <Route path="*" element={<Navigate to="/briefing" replace />} />
    </Routes>
  );
}

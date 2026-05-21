import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { BriefingScreen } from '../features/briefing/BriefingScreen';
import { ApprovalsScreen } from '../features/approvals/ApprovalsScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { RoutingLogScreen } from '../features/diagnostics/RoutingLogScreen';
import { SchedulingChat } from '../features/scheduling/SchedulingChat';
import { UnifiedCalendarScreen } from '../features/calendar/UnifiedCalendarScreen';
import { MeetingsScreen } from '../features/meetings/MeetingsScreen';
import { TasksScreen } from '../features/tasks/TasksScreen';
import { AskScreen } from '../features/ask/AskScreen';
import { RecapScreen } from '../features/recap/RecapScreen';
import { ResearchScreen } from '../features/research/ResearchScreen';
import { PaywallScreen } from '../features/entitlement/PaywallScreen';
import { useEntitlement } from '../features/entitlement/useEntitlement';
import { isLocked } from '../features/entitlement/types';

/**
 * Plan 08.1-03 Task 6 — Read-only allow-list for the locked-state guard.
 *
 * When the entitlement gate is closed (trial-locked / pro-locked) every
 * route EXCEPT these renders <PaywallScreen/> instead of its normal content.
 *
 * Adding a new read-only-safe route = adding a single prefix here. Adding a
 * new write-action route = no edit needed — paywall covers it by default.
 */
const READ_ONLY_ALLOW_LIST: readonly string[] = [
  '/settings', // covers /settings/* subroutes
  '/briefing',
  '/transcripts',
  '/meetings', // read-only listing only; capture is gated downstream by assertEntitled
  '/approvals', // queue is read-only at the UI level
  '/inbox',
  '/calendar',
  '/insights',
  '/recap',
  '/learning',
  '/routing-log',
  '/tasks',
  '/ask', // read-only-from-cache; live ask gated by assertEntitled at IPC layer
  '/research', // read-only listing; job create + re-run gated by assertEntitled at IPC layer
];

export function isReadOnlyAllowed(pathname: string): boolean {
  return READ_ONLY_ALLOW_LIST.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * Wraps a route element with the locked-state guard. When the entitlement
 * state is locked AND the current pathname is not in the allow-list, swap
 * the page content for <PaywallScreen/>. Otherwise render the page as-is.
 *
 * Centralizing the guard here means routes do NOT have to import
 * useEntitlement themselves — adding a new route is a one-line edit.
 */
function LockedGuard({ children }: { children: ReactElement }): JSX.Element {
  const { state } = useEntitlement();
  const location = useLocation();
  if (isLocked(state) && !isReadOnlyAllowed(location.pathname)) {
    return <PaywallScreen />;
  }
  return children;
}

export function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/briefing" replace />} />
      <Route path="/briefing" element={<LockedGuard><BriefingScreen /></LockedGuard>} />
      <Route path="/approvals" element={<LockedGuard><ApprovalsScreen /></LockedGuard>} />
      <Route path="/calendar" element={<LockedGuard><UnifiedCalendarScreen /></LockedGuard>} />
      <Route path="/meetings" element={<LockedGuard><MeetingsScreen /></LockedGuard>} />
      <Route path="/tasks" element={<LockedGuard><TasksScreen /></LockedGuard>} />
      <Route path="/scheduling" element={<LockedGuard><SchedulingChat /></LockedGuard>} />
      <Route path="/ask" element={<LockedGuard><AskScreen /></LockedGuard>} />
      <Route path="/recap" element={<LockedGuard><RecapScreen /></LockedGuard>} />
      <Route path="/routing-log" element={<LockedGuard><RoutingLogScreen /></LockedGuard>} />
      <Route path="/research" element={<LockedGuard><ResearchScreen /></LockedGuard>} />
      <Route path="/settings/*" element={<LockedGuard><SettingsScreen /></LockedGuard>} />
      <Route path="*" element={<Navigate to="/briefing" replace />} />
    </Routes>
  );
}

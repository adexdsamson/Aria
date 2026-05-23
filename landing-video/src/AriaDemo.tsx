import React from 'react';
import { useCurrentFrame, AbsoluteFill, Sequence } from 'remotion';
import { SceneIntro } from './scenes/SceneIntro';
import { SceneBriefing } from './scenes/SceneBriefing';
import { SceneTriage } from './scenes/SceneTriage';
import { SceneCalendar } from './scenes/SceneCalendar';
import { SceneAsk } from './scenes/SceneAsk';
import { SceneOutro } from './scenes/SceneOutro';
import { T } from './tokens';

// Scene timing (frames @ 30fps)
const INTRO_START    = 0;    // 0–90   (3s)
const BRIEF_START    = 90;   // 90–270 (6s)
const TRIAGE_START   = 270;  // 270–450(6s)
const CAL_START      = 450;  // 450–630(6s)
const ASK_START      = 630;  // 630–810(6s)
const OUTRO_START    = 810;  // 810–900(3s)

export const AriaDemo: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill style={{ background: T.ivory, fontFamily: T.fBody }}>
      <WindowChrome frame={frame} />

      <Sequence from={INTRO_START}  durationInFrames={120}><SceneIntro  /></Sequence>
      <Sequence from={BRIEF_START}  durationInFrames={210}><SceneBriefing /></Sequence>
      <Sequence from={TRIAGE_START} durationInFrames={210}><SceneTriage /></Sequence>
      <Sequence from={CAL_START}    durationInFrames={210}><SceneCalendar /></Sequence>
      <Sequence from={ASK_START}    durationInFrames={210}><SceneAsk /></Sequence>
      <Sequence from={OUTRO_START}  durationInFrames={90}><SceneOutro /></Sequence>
    </AbsoluteFill>
  );
};

// ----------------------------------------------------------------------------
// WindowChrome — persistent window title bar + sidebar mirroring the real app's
// SideNav (src/renderer/components/SideNav.tsx) at 256px width.
// ----------------------------------------------------------------------------

function WindowChrome({ frame }: { frame: number }) {
  const briefingActive  = frame >= BRIEF_START  && frame < TRIAGE_START;
  const approvalsActive = frame >= TRIAGE_START && frame < CAL_START;
  const calendarActive  = frame >= CAL_START    && frame < ASK_START;
  const askActive       = frame >= ASK_START    && frame < OUTRO_START;
  const showSidebar     = frame >= BRIEF_START  && frame < OUTRO_START;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Window title bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 40,
        background: T.ink,
        display: 'flex', alignItems: 'center', paddingLeft: 20, gap: 8,
      }}>
        {(['#FF5F57','#FFBD2E','#28C840'] as const).map((c, i) => (
          <div key={i} style={{ width: 13, height: 13, borderRadius: '50%', background: c }} />
        ))}
        <span style={{
          position: 'absolute', left: '50%', transform: 'translateX(-50%)',
          fontFamily: T.fDisplay, fontSize: 15, fontWeight: 500,
          color: 'rgba(255,255,255,0.8)', letterSpacing: '0.02em',
        }}>
          Aria — chief of staff
        </span>
      </div>

      {showSidebar && (
        <aside style={{
          position: 'absolute', top: 40, left: 0, bottom: 0, width: 256,
          background: T.ivory, borderRight: `1px solid ${T.rule}`,
          display: 'flex', flexDirection: 'column',
          padding: '14px 12px 12px',
          boxSizing: 'border-box',
        }}>
          {/* Brand row */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 4px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                width: 30, height: 30, borderRadius: 6,
                border: `1px solid ${T.rule}`,
                background: T.paper,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{
                  fontFamily: T.fDisplay, fontWeight: 500, fontSize: 19,
                  color: T.ink, lineHeight: 1,
                  borderBottom: `1.5px solid ${T.gold}`,
                }}>A</span>
              </div>
              <div>
                <div style={{ fontFamily: T.fDisplay, fontSize: 18, fontWeight: 500, lineHeight: 1.1 }}>Aria</div>
                <div style={{ fontFamily: T.fMono, fontSize: 9, color: T.graySoft, letterSpacing: '0.18em', textTransform: 'uppercase' }}>chief of staff</div>
              </div>
            </div>
          </div>

          {/* Cmd-K trigger */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 10px',
            background: T.paper, border: `1px solid ${T.rule}`,
            borderRadius: 6, color: T.gray, fontSize: 12.5,
            marginBottom: 6,
          }}>
            <span style={{ width: 14, height: 14, display: 'inline-flex', color: T.gold }}>{IconSearch}</span>
            <span style={{ flex: 1 }}>Ask Aria</span>
            <span style={{
              fontFamily: T.fMono, fontSize: 10, padding: '2px 6px',
              border: `1px solid ${T.ruleStrong}`, borderRadius: 4,
              color: T.gray, letterSpacing: '0.06em',
            }}>⌘K</span>
          </div>

          {/* Workspace */}
          <NavSection label="Workspace">
            <NavItem icon={IconBriefing}  label="Briefing"     active={briefingActive} />
            <NavItem icon={IconApprovals} label="Approvals"    active={approvalsActive} badge={3} badgeGold />
            <NavItem icon={IconCalendar}  label="Calendar"     active={calendarActive} />
            <NavItem icon={IconMeetings}  label="Meetings"     active={false} />
            <NavItem icon={IconTasks}     label="Tasks"        active={false} badge={5} />
            <NavItem icon={IconScheduling} label="Scheduling"  active={false} />
            <NavItem icon={IconAsk}       label="Ask Aria"     active={askActive} />
            <NavItem icon={IconRecap}     label="Weekly Recap" active={false} />
            <NavItem icon={IconResearch}  label="Research"     active={false} />
          </NavSection>

          {/* System */}
          <NavSection label="System">
            <NavItem icon={IconSettings}   label="Settings"    active={false} />
            <NavItem icon={IconRoutingLog} label="Routing log" active={false} />
          </NavSection>

          <div style={{ flex: 1 }} />

          {/* Footer status */}
          <div style={{
            padding: '10px 10px 4px', marginTop: 8,
            borderTop: `1px solid ${T.rule}`,
            display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <StatusRow label="LOCAL"    value="llama3.1:8b · ready" dotColor={T.gold} />
            <StatusRow label="FRONTIER" value="anthropic · configured" dotColor={T.graySoft} />
          </div>
        </aside>
      )}
    </AbsoluteFill>
  );
}

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10, marginBottom: 4 }}>
      <div style={{ padding: '0 12px 6px' }}>
        <span style={{
          fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
          letterSpacing: '0.22em', textTransform: 'uppercase',
          color: T.graySoft,
        }}>
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function NavItem({
  icon, label, active, badge, badgeGold,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  badgeGold?: boolean;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '7px 10px',
      borderRadius: 6, margin: '1px 0',
      color: active ? T.ink : T.gray,
      background: active ? T.ivoryDeep : 'transparent',
      position: 'relative',
      fontFamily: T.fBody, fontSize: 13.5,
      fontWeight: active ? 500 : 400,
    }}>
      {active && (
        <span style={{
          position: 'absolute', left: -2, top: 6, bottom: 6, width: 2,
          background: T.gold, borderRadius: 2,
        }} />
      )}
      <span style={{
        width: 17, height: 17, display: 'inline-flex',
        color: active ? T.gold : T.graySoft,
      }}>{icon}</span>
      <span style={{
        flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
          letterSpacing: '0.05em',
          padding: '1px 6px', borderRadius: 4,
          color: badgeGold ? T.goldDeep : T.gray,
          background: badgeGold ? 'rgba(184,134,11,0.12)' : T.ivoryDeep,
          border: badgeGold ? `1px solid rgba(184,134,11,0.2)` : `1px solid ${T.rule}`,
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}

function StatusRow({ label, value, dotColor }: { label: string; value: string; dotColor: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
      <span style={{
        fontFamily: T.fMono, color: T.graySoft, letterSpacing: '0.16em',
        textTransform: 'uppercase',
      }}>{label}</span>
      <span style={{ fontFamily: T.fMono, color: T.gray, fontSize: 10 }}>{value}</span>
    </div>
  );
}

// ---- Inline SVG icons (1.5 stroke, currentColor) — mirror SideNav.tsx -------

function Svg({ d }: { d: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const IconBriefing   = <Svg d="M4 5h16M4 9h16M4 13h10M4 17h6" />;
const IconApprovals  = <Svg d="M5 12l4 4 10-10" />;
const IconCalendar   = <Svg d="M3 8h18M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM8 2v4M16 2v4" />;
const IconMeetings   = <Svg d="M3 7h13l5 5v5a2 2 0 0 1-2 2H3z M7 11h9 M7 15h6" />;
const IconTasks      = <Svg d="M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />;
const IconScheduling = <Svg d="M21 11.5a8.4 8.4 0 0 1-15-5A8.4 8.4 0 0 1 21 11.5z M3 21l3-3" />;
const IconAsk        = <Svg d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />;
const IconRecap      = <Svg d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6" />;
const IconResearch   = <Svg d="M21 21l-4.35-4.35 M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z M11 8v3 M9.5 9.5l3 3" />;
const IconSettings   = <Svg d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />;
const IconRoutingLog = <Svg d="M9 2v6 M15 2v6 M5 8h14v12H5z M9 12h6 M9 16h6" />;
const IconSearch     = <Svg d="M21 21l-4.35-4.35 M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />;

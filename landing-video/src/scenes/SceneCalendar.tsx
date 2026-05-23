import React from 'react';
import { useCurrentFrame, AbsoluteFill, interpolate } from 'remotion';
import { T } from '../tokens';
import { fadeIn, slideUp } from '../easing';

/**
 * SceneCalendar — mirrors the real UnifiedCalendarScreen.tsx:
 *   - Topbar "Unified Calendar · Week of N month"
 *   - 2-column: account list (with checkboxes + Write Scope caption) | 7-day week grid
 */
const DAYS = [
  { label: 'Mon', date: 19 },
  { label: 'Tue', date: 20 },
  { label: 'Wed', date: 21, today: true },
  { label: 'Thu', date: 22 },
  { label: 'Fri', date: 23 },
  { label: 'Sat', date: 24 },
  { label: 'Sun', date: 25 },
];

const ACCOUNTS = [
  { provider: 'G', label: 'alex@aldridgeco.com', color: '#4285F4', visible: true },
  { provider: 'M', label: 'alex@aldridge.co',    color: '#0078D4', visible: true },
];

// Events laid out as (dayIndex, startHour, durationHours, title, account)
const EVENTS = [
  { day: 0, start: 9,  len: 1,  title: 'Standup',          account: 0 },
  { day: 0, start: 14, len: 1,  title: 'Brief Sarah',      account: 0 },
  { day: 1, start: 9,  len: 2,  title: 'Series B prep',    account: 0 },
  { day: 1, start: 13, len: 1,  title: 'Lunch · David',    account: 1 },
  { day: 1, start: 15, len: 1.5,title: 'Acme Q3 review',   account: 0 },
  { day: 2, start: 9,  len: 1,  title: 'Series B close',   account: 0 },
  { day: 2, start: 12.5, len: 1,title: 'Lunch · Sarah',    account: 1 },
  { day: 2, start: 15, len: 1.5,title: 'Board prep — Q3',  account: 0 },
  { day: 3, start: 10, len: 2,  title: 'Investor intro',   account: 0 },
  { day: 4, start: 9,  len: 8,  title: 'Travel · SFO→JFK', account: 1 },
];

const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17];
const CELL_H = 64;

export const SceneCalendar: React.FC = () => {
  const frame = useCurrentFrame();

  const sceneIn  = fadeIn(frame, 0, 15);
  const sceneOut = interpolate(frame, [175, 205], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const opacity  = Math.min(sceneIn, sceneOut);

  const c = (start: number) => ({
    opacity: fadeIn(frame, start, 18),
    transform: `translateY(${slideUp(frame, start, 18)}px)`,
  });

  return (
    <AbsoluteFill style={{ left: 256, top: 40, background: T.ivory, opacity }}>
      <div style={{
        padding: '36px 48px 60px', color: T.ink,
        height: '100%', boxSizing: 'border-box',
      }}>
        {/* Page title (mirrors Topbar copy in real app) */}
        <div style={{
          ...c(8),
          display: 'flex', alignItems: 'baseline', gap: 14,
          paddingBottom: 14, marginBottom: 24,
          borderBottom: `1px solid ${T.rule}`,
        }}>
          <h1 style={{
            fontFamily: T.fDisplay, fontWeight: 500,
            fontSize: 36, letterSpacing: '-0.015em',
            margin: 0,
          }}>
            Unified Calendar
          </h1>
          <span style={{
            fontFamily: T.fDisplay, fontStyle: 'italic',
            fontSize: 18, color: T.gray,
          }}>
            Week of 19 May
          </span>
          <span style={{ flex: 1 }} />
          <span style={{
            fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: T.graySoft,
          }}>
            ALL TIMES · America/New_York
          </span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '260px 1fr',
          gap: 32, alignItems: 'flex-start',
        }}>
          {/* Sidebar — accounts + write scope */}
          <aside style={c(16)}>
            <div style={{
              fontFamily: T.fMono, fontSize: 11, fontWeight: 500,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              color: T.graySoft, marginBottom: 14,
            }}>
              Accounts
            </div>
            {ACCOUNTS.map((a) => (
              <div key={a.label} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0',
              }}>
                <Checkbox checked={a.visible} />
                <span style={{
                  width: 22, height: 22, borderRadius: 4,
                  background: a.color, color: T.ivory,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: T.fMono, fontSize: 12, fontWeight: 600,
                  flexShrink: 0,
                }}>{a.provider}</span>
                <span style={{
                  fontFamily: T.fBody, fontSize: 13.5,
                  color: T.inkSoft, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{a.label}</span>
              </div>
            ))}

            <div style={{
              marginTop: 32, paddingTop: 20,
              borderTop: `1px solid ${T.rule}`,
            }}>
              <div style={{
                fontFamily: T.fMono, fontSize: 11, fontWeight: 500,
                letterSpacing: '0.22em', textTransform: 'uppercase',
                color: T.gray, marginBottom: 10,
              }}>
                Write scope
              </div>
              <p style={{
                margin: 0, fontSize: 13.5, lineHeight: 1.6,
                color: T.inkSoft,
              }}>
                v1 only edits self-only, non-recurring events. Multi-attendee and
                recurring events stay read-only — Aria will refuse.
              </p>
            </div>
          </aside>

          {/* 7-day week grid */}
          <div style={c(24)}>
            {/* Day header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '60px repeat(7, 1fr)',
              borderBottom: `1px solid ${T.rule}`,
              marginBottom: 4,
            }}>
              <span />
              {DAYS.map((d) => (
                <div key={d.label} style={{
                  padding: '8px 6px',
                  textAlign: 'center',
                  borderBottom: d.today ? `2px solid ${T.gold}` : '2px solid transparent',
                }}>
                  <div style={{
                    fontFamily: T.fMono, fontSize: 10, fontWeight: 500,
                    letterSpacing: '0.2em', textTransform: 'uppercase',
                    color: d.today ? T.gold : T.gray,
                  }}>{d.label}</div>
                  <div style={{
                    fontFamily: T.fDisplay, fontSize: 22, fontWeight: 500,
                    color: d.today ? T.gold : T.ink, lineHeight: 1.2,
                  }}>{d.date}</div>
                </div>
              ))}
            </div>

            {/* Grid body */}
            <div style={{ position: 'relative' }}>
              {HOURS.map((h) => (
                <div key={h} style={{
                  display: 'grid',
                  gridTemplateColumns: '60px repeat(7, 1fr)',
                  height: CELL_H,
                  borderTop: `1px dotted ${T.rule}`,
                }}>
                  <span style={{
                    fontFamily: T.fMono, fontSize: 10,
                    color: T.grayFaint, letterSpacing: '0.06em',
                    paddingTop: 4, textAlign: 'right', paddingRight: 8,
                  }}>{formatHour(h)}</span>
                  {DAYS.map((_, di) => <div key={di} />)}
                </div>
              ))}

              {/* Events overlay */}
              {EVENTS.map((ev, i) => {
                const account = ACCOUNTS[ev.account];
                const top = (ev.start - HOURS[0]) * CELL_H + 2;
                const height = ev.len * CELL_H - 4;
                return (
                  <div key={i} style={{
                    position: 'absolute',
                    top, height,
                    left: `calc(60px + ${ev.day} * (100% - 60px) / 7 + 3px)`,
                    width: `calc((100% - 60px) / 7 - 6px)`,
                    background: hexToRgba(account.color, 0.10),
                    borderLeft: `2.5px solid ${account.color}`,
                    borderRadius: 4,
                    padding: '5px 8px',
                    overflow: 'hidden',
                    boxSizing: 'border-box',
                  }}>
                    <div style={{
                      fontFamily: T.fBody, fontSize: 12, fontWeight: 500,
                      color: T.ink, lineHeight: 1.3,
                      overflow: 'hidden', textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>{ev.title}</div>
                    {height >= CELL_H && (
                      <div style={{
                        fontFamily: T.fMono, fontSize: 9,
                        color: T.gray, letterSpacing: '0.06em',
                        marginTop: 2,
                      }}>{formatHour(ev.start)}–{formatHour(ev.start + ev.len)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

function formatHour(h: number): string {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const period = hour >= 12 ? 'pm' : 'am';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return min === 0 ? `${h12}${period}` : `${h12}:${String(min).padStart(2, '0')}${period}`;
}

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <div style={{
      width: 16, height: 16, borderRadius: 3,
      border: `1px solid ${checked ? T.gold : T.ruleStrong}`,
      background: checked ? T.gold : T.paper,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {checked && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={T.ivory} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l4 4 10-10" />
        </svg>
      )}
    </div>
  );
}

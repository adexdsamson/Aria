// app-entitlement.jsx — trial / paywall / subscription surfaces (Plan 08.1).
//
// Three components:
//   • TrialBanner — escalates info → warn → urgent at day 50 / 55 / 59 + grace
//   • PaywallScreen — full-screen lock for trial-locked / pro-locked
//   • SettingsSubscription / SettingsRestore — settings tabs
//
// Mirrors the codebase contract:
//   trial-active-quiet | trial-active-day50 | trial-active-day55 | trial-active-day59
//   trial-expired-grace | trial-locked | pro-active | pro-grace | pro-locked
//   clock-skew-warn (wrapping any of the above)

function baseEntitlement(s) { return s?.kind === 'clock-skew-warn' ? s.underlyingState : s; }
function isLocked(s) {
  if (!s) return false;
  if (s.kind === 'trial-locked' || s.kind === 'pro-locked') return true;
  if (s.kind === 'clock-skew-warn') return isLocked(s.underlyingState);
  return false;
}

// ───────── Trial banner ─────────
function TrialBanner({ state, onSubscribe, onDismiss }) {
  const [dismissed, setDismissed] = React.useState(false);
  if (!state || dismissed) return null;

  let tone, text, showSubscribe = true, kind;
  if (state.kind === 'clock-skew-warn') {
    tone = 'info';
    text = `Your system clock looks off by ~${Math.abs(state.skewDays)} days. Aria uses signed timestamps — check your clock settings.`;
    showSubscribe = false;
    kind = 'clock-skew';
  } else {
    const s = baseEntitlement(state);
    if (s.kind === 'trial-active-day50') { tone = 'info'; text = `${s.daysRemaining} days left in your Aria trial.`; kind = 'day50'; }
    else if (s.kind === 'trial-active-day55') { tone = 'warn'; text = `${s.daysRemaining} days left in your trial.`; kind = 'day55'; }
    else if (s.kind === 'trial-active-day59') { tone = 'urgent'; text = `${s.daysRemaining} day${s.daysRemaining===1?'':'s'} left. Your trial ends soon.`; kind = 'day59'; }
    else if (s.kind === 'trial-expired-grace') { tone = 'urgent'; text = 'Your trial has ended. You can subscribe or activate a key — your data is safe.'; kind = 'grace'; }
    else if (s.kind === 'pro-grace') { tone = 'warn'; text = `Aria couldn't verify your subscription in ${s.daysUntilLock} days. Reconnect to clear this.`; kind = 'pro-grace'; }
    else return null;
  }

  const tones = {
    info:   { bg: 'rgba(184,134,11,0.08)', fg: 'var(--gold-deep)', border: 'rgba(184,134,11,0.30)' },
    warn:   { bg: 'rgba(184,134,11,0.16)', fg: '#7A4A06',          border: 'rgba(184,134,11,0.50)' },
    urgent: { bg: 'rgba(184,73,58,0.12)',  fg: '#7A2B20',          border: 'rgba(184,73,58,0.35)' },
  }[tone];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '8px 24px',
      background: tones.bg,
      borderBottom: `1px solid ${tones.border}`,
      color: tones.fg,
      fontSize: 13, fontWeight: 500,
    }}>
      {kind === 'clock-skew' ? <I.clock size={14} /> : <I.flame size={14} />}
      <span style={{ flex: 1 }}>{text}</span>
      {showSubscribe && (
        <button onClick={onSubscribe} style={{
          all:'unset', boxSizing:'border-box', cursor:'default',
          padding: '4px 12px', borderRadius: 4,
          border: '1px solid currentColor', fontSize: 12.5, fontWeight: 600,
          letterSpacing: '0.02em',
        }}>Subscribe →</button>
      )}
      <button aria-label="Dismiss" onClick={() => { setDismissed(true); onDismiss?.(); }} style={{
        all:'unset', cursor:'default', padding: '2px 4px', color: 'inherit', opacity: 0.7,
      }}>
        <I.x size={13} />
      </button>
    </div>
  );
}

// ───────── Paywall (full-screen lock) ─────────
function PaywallScreen({ state, onActivate, onExit }) {
  const [showForm, setShowForm] = React.useState(false);
  const s = baseEntitlement(state);
  const isTrialLocked = s.kind === 'trial-locked';
  const isProLocked = s.kind === 'pro-locked';

  const heading = isTrialLocked ? 'Your trial has ended' : "We couldn't verify your subscription";
  const subhead = isTrialLocked
    ? "Aria's daily briefing + chief-of-staff actions are paused. Your data is safe — you can still read existing briefings, transcripts, and queued approvals, and export anything you need."
    : "Aria couldn't reach the activation server for the last 14 days. Reconnect to the internet, then click Refresh in Settings → Subscription. Your data is safe and still readable.";

  return (
    <div style={{
      maxWidth: 720, margin: '60px auto', padding: '0 32px',
    }}>
      {/* Editorial masthead */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12,
                    paddingBottom: 14, marginBottom: 28,
                    borderBottom: '1px solid var(--rule)' }}>
        <span className="smallcaps" style={{ color: 'var(--gold)' }}>Aria \u00b7 Paywall</span>
        <span style={{ width: 4, height: 4, borderRadius: 50, background: 'var(--gray-faint)' }} />
        <span className="smallcaps" style={{ color: 'var(--gray)' }}>
          {isTrialLocked ? `Trial ended ${s.trialExpiresAt}` : `Last verified ${s.lastVerifiedAt}`}
        </span>
      </div>

      <h1 style={{
        fontFamily: 'var(--f-display)', fontWeight: 500,
        fontSize: 'clamp(2rem, 5vw, 3rem)', letterSpacing: '-0.02em',
        marginBottom: 18,
      }}>{heading}</h1>

      <p className="serif italic" style={{
        fontSize: 18, color: 'var(--gray)', lineHeight: 1.55, marginBottom: 28, maxWidth: '36em',
      }}>{subhead}</p>

      {/* Plan card */}
      <div style={{
        background: 'var(--paper)', border: '1px solid var(--rule)',
        borderTop: '2px solid var(--gold)',
        borderRadius: 8, padding: '24px 26px', marginBottom: 20,
        display: 'grid', gridTemplateColumns: '1fr auto', gap: 20, alignItems: 'center',
      }}>
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)' }}>Aria Pro</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 500, lineHeight: 1, margin: '4px 0 6px' }}>
            $45 / mo \u00b7 <span style={{ color: 'var(--gray)' }}>$420 / yr</span>
          </div>
          <div style={{ fontSize: 13, color: 'var(--gray)', maxWidth: '34em', lineHeight: 1.55 }}>
            Daily briefing, voice-matched drafting, meeting capture, scheduling agent, Ask Aria (RAG), and weekly recap export. Up to 3 devices.
          </div>
        </div>
        <button className="btn btn-primary" style={{ minHeight: 40, padding: '0 22px', fontSize: 13.5 }}>
          Subscribe <I.arrow_r size={13} />
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
        <span className="smallcaps" style={{ color: 'var(--gray-soft)' }}>or</span>
        <span style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
      </div>

      {!showForm ? (
        <button className="btn btn-outline" onClick={() => setShowForm(true)}
                style={{ minHeight: 36, padding: '0 16px', fontSize: 13 }}>
          <I.key size={13} /> I have a license key
        </button>
      ) : (
        <LicenseKeyForm onCancel={() => setShowForm(false)} onActivated={() => { setShowForm(false); onActivate?.(); }} />
      )}

      {/* Read-only escape hatches */}
      <div style={{
        marginTop: 32, paddingTop: 18,
        borderTop: '1px solid var(--rule)',
        display: 'flex', gap: 18, flexWrap: 'wrap',
        fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase',
      }}>
        {isProLocked && (
          <a href="#" style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
            Manage existing subscription →
          </a>
        )}
        <a href="#" onClick={(e)=>{e.preventDefault(); onExit?.('briefing');}}
           style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Read existing briefings →
        </a>
        <a href="#" onClick={(e)=>{e.preventDefault(); onExit?.('settings');}}
           style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Settings & export →
        </a>
        <a href="#" style={{ color: 'var(--rose)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Sign out / clear license
        </a>
      </div>
    </div>
  );
}

// ───────── License-key form ─────────
const KEY_RE = /^ARIA-[0-9A-HJKMNP-TV-Z]{26}-[0-9A-F]{4}$/i;
function LicenseKeyForm({ onCancel, onActivated }) {
  const [key, setKey] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [hint, setHint] = React.useState(null);
  const [err, setErr] = React.useState(null);

  function submit(e) {
    e.preventDefault();
    setHint(null); setErr(null);
    const t = key.trim();
    if (!KEY_RE.test(t)) {
      setHint("Doesn't look like a valid Aria key — they start with 'ARIA-'.");
      return;
    }
    setBusy(true);
    setTimeout(() => { setBusy(false); onActivated?.(); }, 800);
  }

  return (
    <form onSubmit={submit} style={{
      background: 'var(--paper)',
      border: '1px solid var(--rule-strong)',
      borderRadius: 8, padding: 18,
    }}>
      <label className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 6, display: 'block' }}>License key</label>
      <input value={key} onChange={(e) => setKey(e.target.value)}
             placeholder="ARIA-XXXXXXXXXXXXXXXXXXXXXXXXXX-XXXX"
             autoComplete="off" spellCheck={false} disabled={busy}
             style={{
               width: '100%', padding: '10px 12px',
               border: '1px solid var(--rule-strong)', borderRadius: 4,
               fontFamily: 'var(--f-mono)', fontSize: 13, letterSpacing: '0.04em',
             }} />
      {hint && <p style={{ marginTop: 6, fontSize: 12, color: 'var(--rose)' }}>{hint}</p>}
      {err && <p style={{ marginTop: 6, fontSize: 12, color: 'var(--rose)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <button type="submit" disabled={busy} className="btn btn-primary"
                style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}>
          {busy ? 'Activating…' : 'Activate'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-ghost"
                style={{ minHeight: 32, padding: '0 12px', fontSize: 12.5 }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// ───────── Settings: Subscription ─────────
function SettingsSubscription({ state, onChangeState }) {
  const [showForm, setShowForm] = React.useState(false);
  const s = baseEntitlement(state);
  const badge = (() => {
    switch (s.kind) {
      case 'pro-active':  return { label: 'Pro · active',  tone: 'moss' };
      case 'pro-grace':   return { label: `Pro · grace (${s.daysUntilLock}d to lock)`, tone: 'gold' };
      case 'pro-locked':  return { label: 'Pro · locked',  tone: 'rose' };
      case 'trial-active-quiet':
      case 'trial-active-day50':
      case 'trial-active-day55':
      case 'trial-active-day59':
        return { label: `Trial · ${s.daysRemaining} day${s.daysRemaining===1?'':'s'} left`, tone: 'gold' };
      case 'trial-expired-grace': return { label: 'Trial · expired (grace)', tone: 'rose' };
      case 'trial-locked':        return { label: 'Trial · ended', tone: 'rose' };
      default: return { label: 'Unknown', tone: 'neutral' };
    }
  })();
  const tones = {
    moss:    { bg: 'rgba(91,110,58,0.12)',  fg: '#3F4E26',          border: 'rgba(91,110,58,0.25)' },
    gold:    { bg: 'rgba(184,134,11,0.10)', fg: 'var(--gold-deep)', border: 'rgba(184,134,11,0.25)' },
    rose:    { bg: 'rgba(184,73,58,0.10)',  fg: '#7A2B20',          border: 'rgba(184,73,58,0.25)' },
    neutral: { bg: 'var(--ivory-deep)',     fg: 'var(--gray)',       border: 'var(--rule)' },
  }[badge.tone];
  const isPro = s.kind?.startsWith('pro-');
  const isTrial = s.kind?.startsWith('trial-');

  return (
    <>
      <SettingsHead
        eyebrow="Settings · Subscription"
        title="Plan & billing"
        sub="Aria runs on a 60-day no-card trial; after that, subscribe or activate a license key. Your data stays on this machine either way." />

      <div className="card" style={{ marginBottom: 18, padding: '22px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '4px 12px',
            borderRadius: 999,
            background: tones.bg, color: tones.fg,
            border: `1px solid ${tones.border}`,
            fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.12em',
            textTransform: 'uppercase', fontWeight: 600,
          }}>{badge.label}</span>
          {state.kind === 'clock-skew-warn' && (
            <span className="smallcaps" style={{ color: 'var(--rose)' }}>
              clock skew ~{Math.abs(state.skewDays)}d
            </span>
          )}
        </div>

        <div style={{ fontFamily: 'var(--f-display)', fontSize: 24, fontWeight: 500, marginBottom: 4 }}>
          {isPro ? 'Aria Pro' : isTrial ? 'Aria Trial' : 'Aria'}
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 18, maxWidth: '40em' }}>
          {isPro && s.kind === 'pro-active' && `Renews ${s.subscriptionUntil}. Up to 3 devices, full feature set.`}
          {isPro && s.kind === 'pro-grace'  && `Last successful verification ${s.lastVerifiedAt}. Reconnect to refresh.`}
          {isPro && s.kind === 'pro-locked' && `Subscription verification failed. Last attempt ${s.lastVerifiedAt}.`}
          {isTrial && `Trial expires ${s.trialExpiresAt}. Subscribe to keep drafting, scheduling, and recaps.`}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {(isTrial || s.kind === 'trial-locked' || s.kind === 'trial-expired-grace') && (
            <button className="btn btn-primary" style={{ minHeight: 34, padding: '0 16px', fontSize: 13 }}>
              <I.bolt size={12} /> Subscribe
            </button>
          )}
          {isPro && (
            <button className="btn btn-outline" style={{ minHeight: 34, padding: '0 14px', fontSize: 13 }}>
              Manage subscription
            </button>
          )}
          <button className="btn btn-ghost" style={{ minHeight: 34, padding: '0 12px', fontSize: 13 }}>
            <I.refresh size={12} /> Refresh now
          </button>
          <button className="btn btn-ghost" style={{ minHeight: 34, padding: '0 12px', fontSize: 13 }}
                  onClick={() => setShowForm(v => !v)}>
            <I.key size={12} /> {showForm ? 'Hide form' : 'Activate a license key'}
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn btn-ghost" style={{ minHeight: 34, padding: '0 12px', fontSize: 13, color: 'var(--rose)' }}>
            <I.trash size={12} /> Sign out / clear license
          </button>
        </div>

        {showForm && (
          <div style={{ marginTop: 14 }}>
            <LicenseKeyForm onCancel={() => setShowForm(false)} onActivated={() => setShowForm(false)} />
          </div>
        )}
      </div>

      {/* State picker — prototype only */}
      <div style={{
        border: '1px dashed var(--rule-strong)', padding: '12px 14px',
        borderRadius: 6, fontSize: 12.5, color: 'var(--gray)',
      }}>
        <span className="smallcaps" style={{ color: 'var(--gold)', marginRight: 8 }}>Prototype</span>
        Cycle entitlement state:
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {Object.keys(ENTITLEMENT_STATES).map(k => (
            <button key={k} onClick={() => onChangeState?.(k)} style={{
              all:'unset', boxSizing:'border-box', cursor:'default',
              padding: '3px 9px', borderRadius: 4,
              border: '1px solid var(--rule)', background: 'var(--paper)',
              color: 'var(--gray)',
              fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.06em',
            }}>{k}</button>
          ))}
        </div>
      </div>
    </>
  );
}

// ───────── Settings: Restore license ─────────
function SettingsRestoreLicense() {
  return (
    <>
      <SettingsHead
        eyebrow="Settings · Restore"
        title="Restore from email"
        sub="Check your email for a message from Aria with the subject 'Your Aria license key'. The key starts with ARIA-." />
      <div className="card" style={{ padding: '22px 24px', marginBottom: 14 }}>
        <LicenseKeyForm onCancel={()=>{}} onActivated={()=>{}} />
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--gray)' }}>
        Didn't get the email?{' '}
        <a href="https://aria.app/help/restore" target="_blank" rel="noreferrer"
           style={{ color: 'var(--gold)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Open the restore help page →
        </a>
      </p>
    </>
  );
}

// ───────── Settings: Insights ─────────
function SettingsInsights() {
  const labels = {
    calendar_load: 'Calendar load',
    response_time: 'Response time',
    recurring_themes: 'Recurring themes',
    approval_edits: 'Draft edit pattern',
  };
  return (
    <>
      <SettingsHead
        eyebrow="Settings · Insights"
        title="Patterns from your data"
        sub="Aria derives weekly insights from your own data only — numeric aggregates only ever leave your machine; raw content does not." />

      {INSIGHTS_V2.state === 'locked' && (
        <div style={{
          background: 'rgba(184,134,11,0.08)',
          border: '1px solid rgba(184,134,11,0.30)',
          borderRadius: 6, padding: '14px 18px', marginBottom: 14,
        }}>
          <strong style={{ fontSize: 14 }}>Insights unlock in {INSIGHTS_V2.daysRemaining} days.</strong>
          <p style={{ margin: '6px 0 0 0', fontSize: 13, color: 'var(--gray)' }}>
            Aria needs 14 days of history per data source before computing insights.
          </p>
        </div>
      )}

      {INSIGHTS_V2.state === 'unlocked' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {INSIGHTS_V2.rows.map(row => (
            <div key={row.id} className="card" style={{ padding: '18px 20px' }}>
              <div className="smallcaps" style={{ color: 'var(--gold)', marginBottom: 6 }}>{labels[row.kind] || row.kind}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {row.sentences.map((s, i) => (
                  <li key={i} style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-outline" style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}>
          <I.refresh size={12} /> Recompute now
        </button>
        <span className="smallcaps" style={{ color: 'var(--gray-soft)' }}>
          last computed 17 May \u00b7 06:01 \u00b7 routed local
        </span>
      </div>
    </>
  );
}

// ───────── Settings: Learned preferences ─────────
function SettingsLearnedPreferences() {
  const [view, setView] = React.useState('prefs');
  const [confirming, setConfirming] = React.useState(null);
  const r = LEARNED_PREFS;

  const fields = [
    { path: 'voice.terseness',                 label: 'Voice — terseness',                value: r.preferences.voice.terseness },
    { path: 'voice.formality',                 label: 'Voice — formality',                value: r.preferences.voice.formality },
    { path: 'voice.preferredSignoff',          label: 'Voice — preferred sign-off',       value: r.preferences.voice.preferredSignoff },
    { path: 'briefing.sectionOrder',           label: 'Briefing — section order',         value: r.preferences.briefing.sectionOrder },
    { path: 'scheduling.preferredMeetingLength', label: 'Scheduling — preferred lengths',  value: r.preferences.scheduling.preferredMeetingLength },
    { path: 'triage.vipDomains',               label: 'Triage — VIP domains',             value: r.preferences.triage.vipDomains },
  ];

  return (
    <>
      <SettingsHead
        eyebrow="Settings · Learning"
        title="What Aria has learned"
        sub={`Last updated ${r.lastUpdatedAt} \u00b7 ${r.signalsCount.toLocaleString()} signals seen \u00b7 nothing leaves this device.`} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {['prefs','signal-log'].map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            all:'unset', boxSizing:'border-box', cursor:'default',
            padding: '4px 12px', borderRadius: 999,
            border: `1px solid ${view === v ? 'var(--ink)' : 'var(--rule)'}`,
            background: view === v ? 'var(--ink)' : 'transparent',
            color: view === v ? 'var(--ivory)' : 'var(--gray)',
            fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>{v === 'prefs' ? 'Preferences' : 'Signal log'}</button>
        ))}
        <span style={{ flex: 1 }} />
        {view === 'prefs' && (
          <button className="btn btn-ghost" style={{ minHeight: 30, padding: '0 12px', fontSize: 12.5, color: 'var(--rose)' }}
                  onClick={() => setConfirming({ kind: 'all', path: 'ALL learned preferences' })}>
            <I.trash size={11} /> Reset all
          </button>
        )}
      </div>

      {view === 'prefs' ? (
        <div className="card" style={{ padding: '8px 0' }}>
          {fields.map(f => (
            <div key={f.path} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 20px',
              borderBottom: '1px solid var(--rule)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, color: 'var(--ink)', marginBottom: 2 }}>{f.label}</div>
                <code style={{ fontFamily: 'var(--f-mono)', fontSize: 11.5, color: 'var(--gray-soft)' }}>
                  {JSON.stringify(f.value)}
                </code>
              </div>
              <button className="btn btn-ghost" style={{ minHeight: 28, padding: '0 12px', fontSize: 12 }}
                      onClick={() => setConfirming({ kind: 'field', path: f.path })}>
                Reset
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '140px 90px 140px 1fr',
            padding: '10px 16px', background: 'var(--ivory-deep)',
            borderBottom: '1px solid var(--rule)',
            fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: 'var(--gray-soft)',
          }}>
            <div>When</div><div>Source</div><div>Kind</div><div>Payload</div>
          </div>
          {LEARNING_SIGNALS.map(s => (
            <div key={s.id} style={{
              display: 'grid', gridTemplateColumns: '140px 90px 140px 1fr',
              padding: '8px 16px', borderBottom: '1px solid var(--rule)',
              fontSize: 12, alignItems: 'center',
            }}>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray)' }}>{s.occurredAt}</div>
              <div style={{ color: 'var(--gray)' }}>{s.source}</div>
              <div style={{ color: 'var(--ink-soft)' }}>{s.kind}</div>
              <code style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray-soft)',
                             overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {JSON.stringify(s.payload)}
              </code>
            </div>
          ))}
        </div>
      )}

      {confirming && (
        <DisconnectDialog
          title={`Reset ${confirming.kind === 'all' ? 'ALL learned preferences' : `"${confirming.path}"`}?`}
          body="This rolls the preference back to its default. Aria will keep learning from new signals — but everything it inferred up to now goes away. This cannot be undone."
          confirmLabel="Reset"
          onCancel={() => setConfirming(null)}
          onConfirm={() => setConfirming(null)} />
      )}
    </>
  );
}

// ───────── Settings: Updates ─────────
function SettingsUpdates() {
  const [phase, setPhase] = React.useState('available');  // idle | checking | available | downloading | downloaded | error
  const [pct, setPct] = React.useState(0);

  function check() {
    setPhase('checking');
    setTimeout(() => setPhase('available'), 700);
  }
  function download() {
    setPhase('downloading');
    setPct(0);
    const id = setInterval(() => {
      setPct(p => {
        const n = p + 8 + Math.random() * 6;
        if (n >= 100) { clearInterval(id); setPhase('downloaded'); return 100; }
        return n;
      });
    }, 180);
  }
  function restart() { setPhase('downloaded'); }

  const u = UPDATES;

  return (
    <>
      <SettingsHead
        eyebrow="Settings · Updates"
        title="Software updates"
        sub="Aria auto-updates on the tester channel by default. Notarized binaries; signature verified before install." />

      <div className="card" style={{ marginBottom: 14, padding: '18px 22px',
                                     display: 'flex', alignItems: 'center', gap: 18 }}>
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)' }}>Channel</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 500, marginTop: 2 }}>
            {u.channel}
          </div>
        </div>
        <span style={{ width: 1, height: 36, background: 'var(--rule)' }} />
        <div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)' }}>Installed</div>
          <div style={{ fontFamily: 'var(--f-mono)', fontSize: 16, color: 'var(--ink)', marginTop: 2 }}>v{u.currentVersion}</div>
        </div>
        <span style={{ flex: 1 }} />
        <button className="btn btn-outline" onClick={check}
                style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}>
          {phase === 'checking' ? 'Checking…' : <><I.refresh size={11} /> Check for updates</>}
        </button>
      </div>

      {phase === 'available' && (
        <div className="card" style={{ padding: '18px 22px', borderLeft: '2px solid var(--gold)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <I.bolt size={14} style={{ color: 'var(--gold)' }} />
            <span style={{ fontFamily: 'var(--f-display)', fontSize: 18, fontWeight: 500 }}>v{u.availableVersion} available</span>
            <span className="smallcaps" style={{ color: 'var(--gray-soft)' }}>released {u.releaseDate}</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" onClick={download} style={{ minHeight: 30, padding: '0 14px', fontSize: 12.5 }}>
              <I.download size={11} /> Download
            </button>
          </div>
          <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginTop: 12, marginBottom: 8 }}>What's new</div>
          <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.6 }}>
            {u.notes.map((n, i) => <li key={i} style={{ marginBottom: 2 }}>{n}</li>)}
          </ul>
        </div>
      )}

      {phase === 'downloading' && (
        <div className="card" style={{ padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <span style={{ fontFamily: 'var(--f-display)', fontSize: 17 }}>Downloading v{u.availableVersion}</span>
            <span style={{ flex: 1 }} />
            <span className="mono" style={{ fontSize: 12 }}>{Math.round(pct)}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--ivory-deep)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: 'var(--gold)', transition: 'width 120ms' }} />
          </div>
        </div>
      )}

      {phase === 'downloaded' && (
        <div className="card" style={{ padding: '18px 22px', borderLeft: '2px solid var(--moss)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <I.check size={14} style={{ color: '#3F4E26' }} />
            <span style={{ fontFamily: 'var(--f-display)', fontSize: 17 }}>v{u.availableVersion} ready to install</span>
            <span style={{ flex: 1 }} />
            <button onClick={restart} className="btn btn-primary"
                    style={{ minHeight: 30, padding: '0 14px', fontSize: 12.5 }}>
              Install & restart
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ───────── DisconnectConfirmDialog primitive ─────────
function DisconnectDialog({ title, body, confirmLabel = 'Disconnect and wipe data', onConfirm, onCancel }) {
  React.useEffect(() => {
    function k(e) { if (e.key === 'Escape') onCancel?.(); }
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCancel]);
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, zIndex: 250,
      background: 'rgba(26,26,26,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e)=>e.stopPropagation()} style={{
        width: 'min(480px, 90vw)',
        background: 'var(--ivory)',
        border: '1px solid var(--rule-strong)',
        borderRadius: 8, padding: '22px 24px',
        boxShadow: '0 20px 60px rgba(26,26,26,0.20)',
      }}>
        <h3 style={{ fontFamily: 'var(--f-display)', fontSize: 20, fontWeight: 500, margin: '0 0 10px 0' }}>
          {title}
        </h3>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
          {body}
        </p>
        <div style={{ marginTop: 18, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button onClick={onCancel} className="btn btn-ghost" style={{ minHeight: 32, padding: '0 14px', fontSize: 12.5 }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{
            all:'unset', boxSizing: 'border-box', cursor:'default',
            background: 'var(--rose)', color: 'var(--ivory)',
            padding: '0 16px', minHeight: 32, borderRadius: 6,
            fontSize: 12.5, fontWeight: 500,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            <I.trash size={11} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

window.TrialBanner = TrialBanner;
window.PaywallScreen = PaywallScreen;
window.SettingsSubscription = SettingsSubscription;
window.SettingsRestoreLicense = SettingsRestoreLicense;
window.SettingsInsights = SettingsInsights;
window.SettingsLearnedPreferences = SettingsLearnedPreferences;
window.SettingsUpdates = SettingsUpdates;
window.DisconnectDialog = DisconnectDialog;
window.baseEntitlement = baseEntitlement;
window.isEntitlementLocked = isLocked;

// app-screen-onboarding.jsx — first-run wizard, faithful to OnboardingWizard.tsx
//
// The shipped flow has four steps (no license, no Ollama, no Google scope —
// those moved to Settings):
//   I.   Recovery phrase  — show 12 BIP39 words in a 4×3 grid; gate Continue
//                            behind "I've written these down"
//   II.  Confirm phrase   — 3-position challenge against the words
//   III. News picker      — country bundle + 1–4 sectors
//   IV.  Daily password   — min 8 chars; seals the vault and opens the DB
//
// After seal, the buffered news selection is persisted via newsSetBundle.

const ONBOARDING_WORDS = [
  'copper', 'lantern', 'river', 'august',
  'field',  'candle',  'forge', 'autumn',
  'silver', 'meadow',  'cinder','quartz',
];

// Three positions the wizard challenges in step II (1-indexed words 3, 7, 11)
const CHALLENGE = [2, 6, 10];

const STEPS = [
  { id: 'show',     num: 'I',   label: 'Recovery phrase',  hint: 'Twelve words, write them down' },
  { id: 'confirm',  num: 'II',  label: 'Confirm phrase',   hint: 'Three positions, no peeking' },
  { id: 'news',     num: 'III', label: 'News sources',     hint: 'Country bundle + sectors' },
  { id: 'password', num: 'IV',  label: 'Daily password',   hint: 'You will type this every day' },
  { id: 'done',     num: 'V',   label: 'Ready',            hint: 'Open Aria' },
];

function ScreenOnboarding({ onNav }) {
  const [step, setStep] = React.useState(0);
  const [acknowledged, setAck] = React.useState(false);
  const [confirmGuesses, setConfirmGuesses] = React.useState(['', '', '']);
  const [news, setNews] = React.useState({ country: 'NG', sectors: new Set(['gov','finance']) });
  const [password, setPassword] = React.useState('');
  const [sealError, setSealError] = React.useState(null);
  const [sealing, setSealing] = React.useState(false);

  const current = STEPS[step];

  // Step-completion gates
  const canAdvance =
    current.id === 'show'     ? acknowledged :
    current.id === 'confirm'  ? CHALLENGE.every((idx, i) => confirmGuesses[i].trim().toLowerCase() === ONBOARDING_WORDS[idx]) :
    current.id === 'news'     ? news.country && news.sectors.size >= 1 && news.sectors.size <= 4 :
    current.id === 'password' ? password.length >= 8 :
    true;

  function next() {
    if (current.id === 'password') {
      // Simulate seal
      setSealing(true);
      setSealError(null);
      setTimeout(() => {
        // Always succeeds in this prototype; in the real app this calls
        // window.aria.onboardingSeal({ dailyPassword, passphrase }).
        setSealing(false);
        setStep(s => s + 1);
      }, 900);
    } else {
      setStep(s => s + 1);
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>

      {/* Stepper */}
      <aside style={{
        width: 280, padding: '40px 28px',
        borderRight: '1px solid var(--rule)',
        flexShrink: 0, display: 'flex', flexDirection: 'column',
        background: 'var(--ivory)',
      }}>
        <div style={{ marginBottom: 36 }}>
          <MonogramSquare size={40} />
          <div style={{ marginTop: 16 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: '1.625rem',
                          fontWeight: 500, letterSpacing: '-0.01em' }}>Aria</div>
            <div style={{ fontFamily: 'var(--f-display)', fontStyle: 'italic',
                          fontSize: 13, color: 'var(--gray)', marginTop: 4 }}>
              First-run setup
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {STEPS.map((s, i) => (
            <button key={s.id}
              onClick={() => i < step && setStep(i)} // allow back, not forward
              style={{
                all: 'unset', boxSizing: 'border-box',
                cursor: i < step ? 'default' : 'not-allowed',
                display: 'grid', gridTemplateColumns: '32px 1fr',
                gap: 14, padding: '12px 4px', position: 'relative',
                opacity: i > step ? 0.45 : 1,
              }}>
              {i < STEPS.length - 1 && (
                <span style={{
                  position: 'absolute', left: 19.5, top: 40, bottom: -8,
                  width: 1, background: i < step ? 'var(--gold)' : 'var(--rule)',
                }} />
              )}
              <span style={{
                width: 30, height: 30, borderRadius: 50,
                background: i < step ? 'var(--gold)' : i === step ? 'var(--paper)' : 'transparent',
                border: '1px solid ' + (i <= step ? 'var(--gold)' : 'var(--rule)'),
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--f-display)', fontSize: 12,
                color: i < step ? '#fff' : i === step ? 'var(--gold)' : 'var(--gray)',
                position: 'relative', zIndex: 2,
              }}>
                {i < step ? <I.check size={14} /> : s.num}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                <span className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 2 }}>
                  Step {s.num}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: i === step ? 500 : 400,
                               color: i === step ? 'var(--ink)' : 'var(--gray)' }}>
                  {s.label}
                </span>
                <span style={{ fontFamily: 'var(--f-display)', fontStyle: 'italic',
                               fontSize: 11.5, color: 'var(--gray-soft)', marginTop: 2 }}>
                  {s.hint}
                </span>
              </div>
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        <div style={{
          fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.1em',
          color: 'var(--gray-soft)', lineHeight: 1.7,
          paddingTop: 18, borderTop: '1px solid var(--rule)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <I.lock size={12} style={{ color: 'var(--gold)' }} /> LOCAL ONLY
          </div>
          Setup happens entirely on this machine. Nothing is transmitted until you connect an account in Settings.
        </div>
      </aside>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '56px 64px 80px' }}>
        <div style={{ maxWidth: 640 }}>
          {current.id === 'show'     && <StepShow acknowledged={acknowledged} setAck={setAck} />}
          {current.id === 'confirm'  && <StepConfirm guesses={confirmGuesses} setGuesses={setConfirmGuesses} />}
          {current.id === 'news'     && <StepNewsPicker news={news} setNews={setNews} />}
          {current.id === 'password' && <StepPassword password={password} setPassword={setPassword} error={sealError} sealing={sealing} />}
          {current.id === 'done'     && <StepDone />}

          {/* Nav */}
          <div style={{ display: 'flex', gap: 12, marginTop: 48,
                        paddingTop: 24, borderTop: '1px solid var(--rule)' }}>
            {step > 0 && current.id !== 'done' && (
              <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>
                <I.chevron_l size={14} /> Back
              </button>
            )}
            <span style={{ flex: 1 }} />
            {current.id === 'done' ? (
              <button className="btn btn-primary" onClick={() => onNav('briefing')}>
                Open Aria <I.arrow_r size={14} />
              </button>
            ) : (
              <button className="btn btn-primary"
                      onClick={next}
                      disabled={!canAdvance || sealing}>
                {sealing ? 'Sealing the vault…' :
                  current.id === 'password' ? 'Finish setup' : 'Continue'}
                <I.chevron_r size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── shared ──────────────────────────────────────────────────────────────────
function OnboardingHead({ eyebrow, title, sub }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div className="smallcaps" style={{ color: 'var(--gold)', marginBottom: 12 }}>
        {eyebrow}
      </div>
      <h1 style={{
        fontSize: 'clamp(2.25rem, 4vw, 2.875rem)', lineHeight: 1.06,
        fontWeight: 500, letterSpacing: '-0.02em', marginBottom: 14,
      }}>{title}</h1>
      {sub && (
        <p style={{
          fontFamily: 'var(--f-display)', fontStyle: 'italic',
          fontSize: '1.125rem', lineHeight: 1.55,
          color: 'var(--gray)', maxWidth: '32em',
        }}>{sub}</p>
      )}
    </div>
  );
}

// ── I. Show recovery phrase (BIP39 12 words, 4×3 grid) ─────────────────────
function StepShow({ acknowledged, setAck }) {
  return (
    <>
      <OnboardingHead
        eyebrow="Step I · Recovery phrase"
        title="Twelve words, written down."
        sub="This is the only thing that recovers your data. Write the words on paper — in order — and keep them somewhere safe. Aria will never show them again."
      />

      <div style={{
        padding: '4px 6px', background: 'var(--paper)',
        border: '1px solid var(--rule)', borderRadius: 8,
        marginBottom: 24,
      }}>
        <ol style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 0, padding: 0, margin: 0, listStyle: 'none',
        }}>
          {ONBOARDING_WORDS.map((w, i) => (
            <li key={i} style={{
              display: 'flex', alignItems: 'baseline', gap: 8,
              padding: '14px 16px',
              borderRight:  ((i + 1) % 4 === 0) ? 'none'                  : '1px dotted var(--rule)',
              borderBottom: (i < 8)             ? '1px dotted var(--rule)' : 'none',
            }}>
              <span style={{
                fontFamily: 'var(--f-mono)', fontSize: 10, color: 'var(--gray-soft)',
                letterSpacing: '0.1em', minWidth: 18, textAlign: 'right',
              }}>{String(i + 1).padStart(2, '0')}</span>
              <span style={{
                fontFamily: 'var(--f-mono)', fontSize: 14,
                color: 'var(--ink)', letterSpacing: '0.02em',
              }}>{w}</span>
            </li>
          ))}
        </ol>
      </div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '16px 18px', background: 'var(--ivory-deep)',
        borderLeft: '2px solid var(--gold)', borderRadius: 4,
        marginBottom: 20,
      }}>
        <I.shield size={16} style={{ color: 'var(--gold)', marginTop: 2, flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6 }}>
          The phrase is generated locally, sealed into your vault with scrypt, and never written to disk. Lose it <em style={{ color: 'var(--ink)' }}>and</em> forget your daily password, and your data cannot be recovered.
        </div>
      </div>

      <label style={{
        display: 'flex', alignItems: 'center', gap: 12,
        cursor: 'default', padding: '12px 0',
      }}>
        <input type="checkbox"
               checked={acknowledged}
               onChange={(e) => setAck(e.target.checked)}
               style={{ accentColor: 'var(--gold)', width: 16, height: 16 }} />
        <span style={{ fontSize: 14, color: 'var(--ink)' }}>
          I've written these words down somewhere safe.
        </span>
      </label>
    </>
  );
}

// ── II. Confirm phrase (3-position challenge) ──────────────────────────────
function StepConfirm({ guesses, setGuesses }) {
  return (
    <>
      <OnboardingHead
        eyebrow="Step II · Confirm phrase"
        title="Three from twelve."
        sub="Type the words at the positions Aria asks for. This is your proof that the phrase is written down somewhere you can read."
      />

      <div style={{ display: 'grid', gap: 18 }}>
        {CHALLENGE.map((idx, i) => {
          const expected = ONBOARDING_WORDS[idx];
          const value = guesses[i];
          const correct = value && value.trim().toLowerCase() === expected;
          const incorrect = value && !correct;
          return (
            <div key={i}>
              <label className="smallcaps"
                     style={{ display: 'block', marginBottom: 8, color: 'var(--gray)' }}>
                Word #{idx + 1}
              </label>
              <input type="text" value={value}
                onChange={(e) => {
                  const v = e.target.value;
                  setGuesses(prev => prev.map((g, k) => k === i ? v : g));
                }}
                placeholder="…"
                autoComplete="off"
                style={{
                  all: 'unset', boxSizing: 'border-box', width: '100%',
                  padding: '14px 16px',
                  background: correct ? 'rgba(91,110,58,0.06)' : 'var(--paper)',
                  border: '1px solid ' + (correct ? 'var(--moss)' : incorrect ? 'var(--rose)' : 'var(--rule)'),
                  borderRadius: 6,
                  fontFamily: 'var(--f-mono)', fontSize: 15,
                  color: 'var(--ink)', letterSpacing: '0.02em',
                }} />
              {incorrect && (
                <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5,
                              color: 'var(--rose)', marginTop: 6,
                              letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Not a match for word #{idx + 1}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--gray-soft)', marginTop: 20,
                  fontFamily: 'var(--f-display)', fontStyle: 'italic' }}>
        Stuck? Go back and read them again. The check is local — nothing leaves your laptop.
      </p>
    </>
  );
}

// ── III. News picker (country + sectors) ──────────────────────────────────
function StepNewsPicker({ news, setNews }) {
  const COUNTRIES = [
    { code: 'NG', label: 'Nigeria',        hasBundle: true },
    { code: 'US', label: 'United States',  hasBundle: false },
    { code: 'UK', label: 'United Kingdom', hasBundle: false },
    { code: 'KE', label: 'Kenya',          hasBundle: false },
    { code: 'ZA', label: 'South Africa',   hasBundle: false },
  ];
  const SECTORS = [
    { id: 'gov',     label: 'Government & policy' },
    { id: 'finance', label: 'Finance & markets' },
    { id: 'tech',    label: 'Technology' },
    { id: 'energy',  label: 'Energy' },
  ];

  function toggle(id) {
    setNews(prev => {
      const s = new Set(prev.sectors);
      if (s.has(id)) s.delete(id);
      else if (s.size < 4) s.add(id);
      return { ...prev, sectors: s };
    });
  }

  const selected = COUNTRIES.find(c => c.code === news.country);

  return (
    <>
      <OnboardingHead
        eyebrow="Step III · News sources"
        title="What should the wire say?"
        sub="Aria pulls up to three news items into your morning brief. Tell her which country and which sectors to follow; you can change this any time."
      />

      <div className="smallcaps" style={{ marginBottom: 10 }}>Country</div>
      <select
        value={news.country}
        onChange={(e) => setNews({ ...news, country: e.target.value })}
        style={{
          appearance: 'none', boxSizing: 'border-box', width: '100%',
          padding: '14px 16px',
          background: 'var(--paper)', border: '1px solid var(--rule)',
          borderRadius: 6, fontFamily: 'var(--f-body)', fontSize: 15,
          color: 'var(--ink)',
          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6B6B' stroke-width='2' stroke-linecap='round'><path d='m6 9 6 6 6-6'/></svg>\")",
          backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center',
          paddingRight: 40,
        }}>
        {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
      </select>
      {selected && !selected.hasBundle && (
        <div style={{
          marginTop: 10, padding: '10px 14px',
          background: 'var(--ivory-deep)', borderRadius: 4,
          fontSize: 12.5, color: 'var(--gray)',
          fontFamily: 'var(--f-display)', fontStyle: 'italic',
        }}>
          More countries coming soon — selecting now seeds zero feeds.
        </div>
      )}

      <div className="smallcaps" style={{ marginBottom: 10, marginTop: 28 }}>
        Sectors · pick 1–4
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {SECTORS.map(s => (
          <label key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px', cursor: 'default',
            border: '1px solid ' + (news.sectors.has(s.id) ? 'var(--gold)' : 'var(--rule)'),
            background: news.sectors.has(s.id) ? 'rgba(184,134,11,0.04)' : 'var(--paper)',
            borderRadius: 6,
          }}>
            <input type="checkbox" checked={news.sectors.has(s.id)}
                   onChange={() => toggle(s.id)}
                   style={{ accentColor: 'var(--gold)' }} />
            <span style={{ fontSize: 14 }}>{s.label}</span>
          </label>
        ))}
      </div>
    </>
  );
}

// ── IV. Daily password (min 8) ────────────────────────────────────────────
function StepPassword({ password, setPassword, error, sealing }) {
  // Simple strength meter
  const strength = (() => {
    let s = 0;
    if (password.length >= 8)  s++;
    if (password.length >= 12) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/\d/.test(password))   s++;
    if (/[^A-Za-z0-9]/.test(password)) s++;
    return s; // 0..5
  })();

  return (
    <>
      <OnboardingHead
        eyebrow="Step IV · Daily password"
        title="What you'll type each morning."
        sub="Aria locks itself when the laptop sleeps. This password unlocks the vault every day; if you forget it, the 12-word phrase recovers you."
      />

      <div className="smallcaps" style={{ marginBottom: 10 }}>Password · minimum 8 characters</div>
      <input type="password" value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
        placeholder="••••••••"
        style={{
          all: 'unset', boxSizing: 'border-box', width: '100%',
          padding: '16px 18px', background: 'var(--paper)',
          border: '1px solid var(--rule)', borderRadius: 6,
          fontFamily: 'var(--f-mono)', fontSize: 16,
          color: 'var(--ink)', letterSpacing: '0.08em',
        }} />

      {/* strength bars */}
      <div style={{ display: 'flex', gap: 4, marginTop: 12, marginBottom: 8 }}>
        {[1,2,3,4,5].map(n => (
          <div key={n} style={{
            flex: 1, height: 3, borderRadius: 2,
            background: n <= strength
              ? (strength <= 2 ? 'var(--rose)' : strength <= 3 ? 'var(--gold)' : 'var(--moss)')
              : 'var(--rule)',
          }} />
        ))}
      </div>
      <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5,
                    letterSpacing: '0.12em', textTransform: 'uppercase',
                    color: strength <= 2 ? 'var(--rose)' : strength <= 3 ? 'var(--gold)' : 'var(--moss)' }}>
        {password.length === 0 ? '\u00A0' :
         strength <= 2 ? 'Weak — Aria recommends a sentence' :
         strength <= 3 ? 'OK' : 'Strong'}
      </div>

      {error && (
        <div style={{
          marginTop: 18, padding: '12px 14px',
          background: 'rgba(184,73,58,0.08)',
          border: '1px solid var(--rose)', borderRadius: 4,
          fontSize: 13, color: 'var(--rose)',
        }}>{error}</div>
      )}

      <div style={{ marginTop: 28, padding: '14px 16px',
                    background: 'var(--ivory-deep)', borderRadius: 6,
                    fontSize: 12.5, color: 'var(--gray)', lineHeight: 1.6,
                    fontFamily: 'var(--f-display)', fontStyle: 'italic' }}>
        Choosing Finish runs scrypt against this password, seals your recovery phrase into the vault, and opens the encrypted SQLite database for the first time.
      </div>
    </>
  );
}

// ── Done ────────────────────────────────────────────────────────────────────
function StepDone() {
  return (
    <div style={{ textAlign: 'center', padding: '32px 0' }}>
      <div style={{ marginBottom: 32, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', gap: 18 }}>
        <span style={{
          fontFamily: 'var(--f-display)', fontSize: '4rem',
          color: 'var(--gold)', fontStyle: 'italic', lineHeight: 1,
        }}>❦</span>
        <h1 style={{
          fontSize: 'clamp(2.5rem, 5vw, 3.25rem)', fontStyle: 'italic',
          fontWeight: 400, letterSpacing: '-0.02em', margin: 0,
        }}>The vault is sealed.</h1>
        <p style={{
          fontFamily: 'var(--f-display)', fontSize: '1.125rem',
          color: 'var(--gray)', fontStyle: 'italic',
          maxWidth: '30em', lineHeight: 1.55, margin: 0,
        }}>
          Connect Gmail and Google Calendar in Settings, then come back tomorrow morning. Aria will have a briefing waiting.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    gap: 12, marginTop: 40 }}>
        <DoneStat number="247 MB" label="encrypted DB" />
        <DoneStat number="3"       label="schema migrations" />
        <DoneStat number="0"       label="bytes off-device" />
      </div>
    </div>
  );
}

function DoneStat({ number, label }) {
  return (
    <div style={{ padding: '18px 16px', border: '1px solid var(--rule)',
                  borderRadius: 6, background: 'var(--paper)' }}>
      <div style={{ fontFamily: 'var(--f-display)', fontSize: '1.625rem',
                    fontWeight: 500, letterSpacing: '-0.01em' }}>{number}</div>
      <div className="smallcaps" style={{ marginTop: 4, color: 'var(--gray)' }}>{label}</div>
    </div>
  );
}

window.ScreenOnboarding = ScreenOnboarding;

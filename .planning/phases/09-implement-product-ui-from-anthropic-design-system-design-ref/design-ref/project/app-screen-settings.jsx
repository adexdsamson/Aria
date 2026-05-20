// app-screen-settings.jsx — Settings shell + the 8 tabs the codebase actually ships.
//
// Tabs (mirror SettingsScreen.tsx):
//   1. Status              — StatusPanel: integration + routing health rollup
//   2. Frontier key        — FrontierKeySection (safeStorage-backed)
//   3. Local model         — OllamaSection (probe + install hint)
//   4. Integrations        — IntegrationsSection (Google connect/reconnect)
//   5. News sources        — NewsSourcesSection (country bundle + custom feeds)
//   6. Briefing            — BriefingSettingsSection (time, days)
//   7. Backup & restore    — BackupRestoreSection
//   8. Diagnostics         — DiagnosticsSection (Ask Aria + routing_log)

function ScreenSettings({ onNav, entitlement, onChangeEntitlement }) {
  const TABS = [
    { id: 'status',        label: 'Status' },
    { id: 'subscription',  label: 'Subscription' },
    { id: 'frontier',      label: 'Frontier key' },
    { id: 'ollama',        label: 'Local model' },
    { id: 'rag',           label: 'RAG index' },
    { id: 'integrations',  label: 'Integrations' },
    { id: 'scheduling',    label: 'Scheduling rules' },
    { id: 'news',          label: 'News sources' },
    { id: 'briefing',      label: 'Briefing' },
    { id: 'insights',      label: 'Insights' },
    { id: 'learning',      label: 'Learned preferences' },
    { id: 'restore',       label: 'Restore license' },
    { id: 'backup',        label: 'Backup & restore' },
    { id: 'updates',       label: 'Updates' },
    { id: 'diagnostics',   label: 'Diagnostics' },
  ];
  const [tab, setTab] = React.useState(() => window.__ariaSettingsTab || 'status');

  // Honor cross-screen deep-link (e.g. "Ask Aria" shortcut in the shell)
  React.useEffect(() => {
    if (window.__ariaSettingsTab) {
      setTab(window.__ariaSettingsTab);
      window.__ariaSettingsTab = null;
    }
  });

  return (
    <div style={{ display: 'flex', height: '100%' }}>

      {/* Section nav */}
      <aside style={{ width: 224, borderRight: '1px solid var(--rule)',
                      flexShrink: 0, padding: '20px 12px',
                      background: 'var(--ivory)' }}>
        <div className="smallcaps" style={{ padding: '0 10px 10px', color: 'var(--gray-soft)' }}>
          Preferences
        </div>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            all: 'unset', boxSizing: 'border-box', cursor: 'default',
            display: 'block', width: '100%', padding: '8px 12px',
            borderRadius: 6, marginBottom: 1, position: 'relative',
            background: tab === t.id ? 'var(--ivory-deep)' : 'transparent',
            color: tab === t.id ? 'var(--ink)' : 'var(--gray)',
            fontSize: 13.5, fontWeight: tab === t.id ? 500 : 400,
            transition: 'all var(--t)',
          }}
          onMouseEnter={(e) => { if (tab !== t.id) e.currentTarget.style.background = 'var(--ivory-deep)'; }}
          onMouseLeave={(e) => { if (tab !== t.id) e.currentTarget.style.background = 'transparent'; }}>
            {tab === t.id && <span style={{ position:'absolute', left: -2, top: 8, bottom: 8, width: 2, background: 'var(--gold)', borderRadius: 2 }} />}
            {t.label}
          </button>
        ))}
      </aside>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 40px 60px', minWidth: 0 }}>
        {tab === 'status'       && <SettingsStatus />}
        {tab === 'subscription' && <SettingsSubscription state={entitlement} onChangeState={onChangeEntitlement} />}
        {tab === 'frontier'     && <SettingsFrontierKey />}
        {tab === 'ollama'       && <SettingsOllama />}
        {tab === 'rag'          && <SettingsRagIndex />}
        {tab === 'integrations' && <SettingsIntegrations />}
        {tab === 'scheduling'   && <SettingsSchedulingRules />}
        {tab === 'news'         && <SettingsNewsSources />}
        {tab === 'briefing'     && <SettingsBriefing />}
        {tab === 'insights'     && <SettingsInsights />}
        {tab === 'learning'     && <SettingsLearnedPreferences />}
        {tab === 'restore'      && <SettingsRestoreLicense />}
        {tab === 'backup'       && <SettingsBackup />}
        {tab === 'updates'      && <SettingsUpdates />}
        {tab === 'diagnostics'  && <SettingsDiagnostics />}
      </div>
    </div>
  );
}

// ── shared ──────────────────────────────────────────────────────────────────
function SettingsHead({ eyebrow, title, sub }) {
  return (
    <div style={{ marginBottom: 28, paddingBottom: 14, borderBottom: '1px solid var(--rule)' }}>
      {eyebrow && (
        <div className="smallcaps" style={{ color: 'var(--gold)', marginBottom: 8 }}>{eyebrow}</div>
      )}
      <h2 style={{ fontSize: '1.75rem', fontWeight: 500, marginBottom: 8, letterSpacing: '-0.01em' }}>
        {title}
      </h2>
      {sub && (
        <p style={{ color: 'var(--gray)', fontSize: 14.5, lineHeight: 1.6, maxWidth: '40em',
                    fontFamily: 'var(--f-display)', fontStyle: 'italic' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function SettingRow({ label, value, action, children }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '200px 1fr auto',
      gap: 18, padding: '14px 0', borderBottom: '1px solid var(--rule)',
      alignItems: 'baseline',
    }}>
      <span style={{
        fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'var(--gray)',
      }}>{label}</span>
      <span style={{ fontSize: 14, color: 'var(--ink)' }}>{children ?? value}</span>
      {action ?? <span />}
    </div>
  );
}

// ── 1. Status ───────────────────────────────────────────────────────────────
function SettingsStatus() {
  const rows = [
    { key: 'Gmail',           detail: 'eleanor@northwind.co · last sync 09:34 · 247 mails indexed',  kind: 'ok' },
    { key: 'Google Calendar', detail: 'eleanor@northwind.co · last sync 09:30 · 14 upcoming events', kind: 'ok' },
    { key: 'News feeds',      detail: 'NG bundle · 4 sectors active · last poll 06:55',              kind: 'ok' },
    { key: 'Briefing',        detail: "Today's brief generated 07:00 · 4 sources · route FRONTIER",  kind: 'ok' },
    { key: 'Frontier API',    detail: 'Anthropic claude-sonnet · key in Keychain · last used 09:32', kind: 'ok' },
    { key: 'Local model',     detail: 'Ollama · localhost:11434 · llama3.1:8b ready',                kind: 'ok' },
    { key: 'Encrypted DB',    detail: 'SQLCipher chacha20 · 247 MB · backed up 16 May 23:11',        kind: 'ok' },
  ];
  return (
    <>
      <SettingsHead
        eyebrow="Setting · I"
        title="Status"
        sub="A one-glance rollup of every integration and service Aria depends on. Anything amber is a soft warning; anything red is blocking."
      />
      <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', borderRadius: 6 }}>
        {rows.map((r, i) => (
          <div key={r.key} style={{
            display: 'grid', gridTemplateColumns: '20px 180px 1fr auto',
            gap: 14, padding: '14px 18px', alignItems: 'baseline',
            borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
          }}>
            <StatusDot kind={r.kind} />
            <span style={{ fontSize: 14, fontWeight: 500 }}>{r.key}</span>
            <span style={{ fontSize: 13, color: 'var(--gray)' }}>{r.detail}</span>
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.15em',
              textTransform: 'uppercase', color: 'var(--moss)',
            }}>OK</span>
          </div>
        ))}
      </div>
      <p style={{ marginTop: 16, fontSize: 12.5, color: 'var(--gray-soft)',
                  fontFamily: 'var(--f-display)', fontStyle: 'italic' }}>
        Cron registry size · 3 · suspend / resume invariant holds.
      </p>
    </>
  );
}

// ── 2. Frontier key ─────────────────────────────────────────────────────────
function SettingsFrontierKey() {
  const [show, setShow] = React.useState(false);
  return (
    <>
      <SettingsHead
        eyebrow="Setting · II"
        title="Frontier API key"
        sub="The Anthropic / OpenAI / Google key Aria uses for the heavy reasoning. Stored only in the operating-system keychain via Electron safeStorage; never written to the database."
      />
      <div className="card" style={{ padding: '22px 24px', marginBottom: 18 }}>
        <div className="smallcaps" style={{ marginBottom: 10 }}>Provider</div>
        <div style={{ display:'flex', gap: 8, marginBottom: 18 }}>
          {['Anthropic','OpenAI','Google'].map((p, i) => (
            <span key={p} style={{
              padding: '6px 14px', borderRadius: 4,
              border: '1px solid ' + (i === 0 ? 'var(--gold)' : 'var(--rule)'),
              background: i === 0 ? 'rgba(184,134,11,0.08)' : 'var(--paper)',
              color: i === 0 ? 'var(--gold-deep)' : 'var(--gray)',
              fontFamily: 'var(--f-mono)', fontSize: 11.5, letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}>{p}</span>
          ))}
        </div>

        <div className="smallcaps" style={{ marginBottom: 8 }}>API key</div>
        <div style={{ display:'flex', gap: 8 }}>
          <input type={show ? 'text' : 'password'}
            defaultValue="sk-ant-api03-jH4kQ2…(redacted)…9wLa"
            style={{
              all: 'unset', boxSizing: 'border-box', flex: 1,
              padding: '12px 14px', background: 'var(--ivory-deep)',
              border: '1px solid var(--rule)', borderRadius: 6,
              fontFamily: 'var(--f-mono)', fontSize: 13, color: 'var(--ink)',
              letterSpacing: '0.03em',
            }} />
          <button className="btn btn-outline" onClick={() => setShow(s => !s)}
                  style={{ minHeight: 40, padding: '0 14px', fontSize: 12.5 }}>
            {show ? 'Hide' : 'Show'}
          </button>
          <button className="btn btn-outline"
                  style={{ minHeight: 40, padding: '0 14px', fontSize: 12.5 }}>
            Rotate
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
          <StatusDot kind="ok" />
          <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, letterSpacing: '0.12em',
                         textTransform: 'uppercase', color: 'var(--moss)' }}>
            Validated · stored in macOS Keychain · last used 09:32
          </span>
        </div>
      </div>

      <div style={{ padding: '14px 18px', background: 'var(--ivory-deep)', borderRadius: 6,
                    fontSize: 13, color: 'var(--gray)', lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--ink)' }}>On Linux,</strong> if the safeStorage backend is <span style={{ fontFamily: 'var(--f-mono)' }}>basic_text</span> (no libsecret), Aria refuses to write the key and asks you to install <span style={{ fontFamily: 'var(--f-mono)' }}>libsecret</span> or keep using local-only routes.
      </div>
    </>
  );
}

// ── 3. Local model (Ollama) ─────────────────────────────────────────────────
function SettingsOllama() {
  const models = [
    { name: 'llama3.1:8b-instruct', size: '4.7 GB', role: 'Sensitive routing & classification', ok: true },
    { name: 'nomic-embed-text:1.5', size: '274 MB', role: 'Embeddings (Phase 7 RAG)',            ok: true },
    { name: 'qwen2.5:7b',           size: '4.4 GB', role: 'Backup classifier (optional)',         ok: false },
  ];
  return (
    <>
      <SettingsHead
        eyebrow="Setting · III"
        title="Local model"
        sub="Ollama runs alongside Aria as a sidecar on localhost:11434. Sensitive content — PII, financial language — is routed here so it never leaves the machine."
      />
      <div className="card" style={{ padding: '20px 24px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <I.cpu size={22} style={{ color: 'var(--gold)' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--f-display)', fontSize: '1.125rem', fontWeight: 500 }}>
              Ollama · localhost:11434
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>
              Reachable · OpenAI-compatible · v0.4.7
            </div>
          </div>
          <StatusDot kind="ok" />
          <button className="btn btn-ghost"
                  style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}>
            Re-probe
          </button>
        </div>
      </div>

      <div className="smallcaps" style={{ marginBottom: 12 }}>Installed models</div>
      <div className="card" style={{ padding: '0 24px' }}>
        {models.map((m, i) => (
          <div key={m.name} style={{
            display: 'grid', gridTemplateColumns: '20px 1fr auto auto',
            gap: 14, padding: '14px 0', borderTop: i === 0 ? 'none' : '1px dotted var(--rule)',
            alignItems: 'baseline',
          }}>
            <input type="checkbox" defaultChecked={m.ok} style={{ accentColor: 'var(--gold)' }} />
            <div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 12.5, color: 'var(--ink)' }}>{m.name}</div>
              <div style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 2 }}>{m.role}</div>
            </div>
            <span style={{ fontFamily:'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)',
                           letterSpacing: '0.05em' }}>{m.size}</span>
            <span style={{ fontFamily:'var(--f-mono)', fontSize: 10, color: m.ok ? 'var(--moss)' : 'var(--gold)',
                           letterSpacing: '0.15em', textTransform: 'uppercase', minWidth: 70, textAlign: 'right' }}>
              {m.ok ? 'Installed' : 'Pull'}
            </span>
          </div>
        ))}
      </div>

      <p style={{ marginTop: 18, fontSize: 12.5, color: 'var(--gray-soft)', fontStyle: 'italic',
                  fontFamily: 'var(--f-display)' }}>
        With Ollama not installed, Aria warns and offers install instructions instead of silent failure.
      </p>
    </>
  );
}

// ── 4. Integrations ─────────────────────────────────────────────────────────
function SettingsIntegrations() {
  return (
    <>
      <SettingsHead
        eyebrow="Setting · IV"
        title="Integrations"
        sub="Where Aria reads from. Read scope first; send scope (Phase 3) and calendar-write scope (Phase 4) are requested only when you ship them."
      />

      <div className="smallcaps" style={{ marginBottom: 10 }}>Connected</div>
      <IntegrationRow logo="G" name="Gmail"
        account="eleanor@northwind.co"
        scope="readonly · gmail.metadata, gmail.readonly"
        last="Last sync 09:34"
        status="ok" />
      <IntegrationRow logo="G" name="Google Calendar"
        account="eleanor@northwind.co"
        scope="readonly · calendar.events.readonly"
        last="Last sync 09:30"
        status="ok" />

      <div className="smallcaps" style={{ marginBottom: 10, marginTop: 28 }}>Coming next</div>
      <IntegrationRow logo="M" name="Outlook · Calendar"
        account="—"
        scope="readonly (planned · Phase 5)"
        last="Not connected"
        status="planned" />
      <IntegrationRow logo="T" name="Todoist"
        account="—"
        scope="read + write (planned · Phase 6)"
        last="Not connected"
        status="planned" />

      <div style={{ padding: '14px 18px', background: 'var(--ivory-deep)', borderRadius: 6,
                    fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, marginTop: 24 }}>
        <strong style={{ color: 'var(--ink)' }}>Gmail send scope</strong> is in CASA review and ships in Phase 3 with the Approval queue. Until then, Aria reads only.
      </div>
    </>
  );
}

function IntegrationRow({ logo, name, account, scope, last, status }) {
  const planned = status === 'planned';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '16px 18px', marginBottom: 8,
      border: '1px solid ' + (planned ? 'var(--rule)' : 'var(--rule-strong)'),
      background: planned ? 'var(--ivory-deep)' : 'var(--paper)',
      borderRadius: 8, opacity: planned ? 0.85 : 1,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: 'var(--ivory-deep)', border: '1px solid var(--rule)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--f-display)', fontSize: 17, fontWeight: 500,
        color: planned ? 'var(--gray-soft)' : 'var(--ink)',
      }}>{logo}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 500 }}>{name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--gray)' }}>{account}</div>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.05em',
                      color: 'var(--gray-soft)', marginTop: 4 }}>
          {scope}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      color: planned ? 'var(--gray-soft)' : 'var(--moss)' }}>
          {planned ? 'Planned' : 'Connected'}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--gray-soft)', marginTop: 4 }}>{last}</div>
      </div>
      <button className="btn btn-ghost"
              style={{ minHeight: 32, padding: '0 12px', fontSize: 12 }}>
        {planned ? 'Notify me' : 'Manage'}
      </button>
    </div>
  );
}

// ── 5. News sources ─────────────────────────────────────────────────────────
function SettingsNewsSources() {
  const COUNTRIES = ['NG','US','UK','KE','ZA'];
  const SECTORS   = [
    { id: 'gov',     label: 'Government & policy' },
    { id: 'finance', label: 'Finance & markets' },
    { id: 'tech',    label: 'Technology' },
    { id: 'energy',  label: 'Energy' },
  ];
  const [country, setCountry] = React.useState('NG');
  const [sectors, setSectors] = React.useState(new Set(['gov','finance','tech']));

  function toggle(id) {
    setSectors(prev => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });
  }

  return (
    <>
      <SettingsHead
        eyebrow="Setting · V"
        title="News sources"
        sub="What appears under News in your morning brief. Currently sourced from a curated NG bundle plus Hacker News; more country bundles are coming in subsequent waves."
      />

      <div className="smallcaps" style={{ marginBottom: 10 }}>Home country</div>
      <div style={{ display:'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {COUNTRIES.map(c => (
          <button key={c} onClick={() => setCountry(c)} style={{
            all: 'unset', boxSizing: 'border-box', cursor: 'default',
            padding: '8px 16px', borderRadius: 4,
            border: '1px solid ' + (country === c ? 'var(--gold)' : 'var(--rule)'),
            background: country === c ? 'rgba(184,134,11,0.08)' : 'var(--paper)',
            color: country === c ? 'var(--gold-deep)' : 'var(--gray)',
            fontFamily: 'var(--f-mono)', fontSize: 11.5,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>{c}</button>
        ))}
      </div>
      {country !== 'NG' && (
        <div style={{ padding: '12px 16px', background: 'var(--ivory-deep)',
                      borderLeft: '2px solid var(--gold)', borderRadius: 4,
                      marginBottom: 24, fontSize: 13, color: 'var(--gray)',
                      fontFamily: 'var(--f-display)', fontStyle: 'italic' }}>
          More countries coming soon — selecting now seeds zero feeds.
        </div>
      )}

      <div className="smallcaps" style={{ marginBottom: 10 }}>Sectors of interest</div>
      <div style={{ display:'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 28 }}>
        {SECTORS.map(s => (
          <label key={s.id} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 16px',
            border: '1px solid ' + (sectors.has(s.id) ? 'var(--gold)' : 'var(--rule)'),
            background: sectors.has(s.id) ? 'rgba(184,134,11,0.04)' : 'var(--paper)',
            borderRadius: 6, cursor: 'default',
          }}>
            <input type="checkbox" checked={sectors.has(s.id)}
                   onChange={() => toggle(s.id)}
                   style={{ accentColor: 'var(--gold)' }} />
            <span style={{ fontSize: 14 }}>{s.label}</span>
          </label>
        ))}
      </div>

      <div className="smallcaps" style={{ marginBottom: 10 }}>Active feeds</div>
      <div className="card" style={{ padding: '0 22px' }}>
        {[
          { source: 'The Cable',      kind: 'RSS',       url: 'thecable.ng/feed',                 sector: 'gov',     ok: true },
          { source: 'Premium Times',  kind: 'RSS',       url: 'premiumtimesng.com/feed',          sector: 'gov',     ok: true },
          { source: 'Nairametrics',   kind: 'RSS',       url: 'nairametrics.com/feed',            sector: 'finance', ok: true },
          { source: 'Bloomberg NG',   kind: 'RSS',       url: 'bloomberg.com/africa.rss',         sector: 'finance', ok: true },
          { source: 'Hacker News',    kind: 'API',       url: 'news.ycombinator.com (front)',     sector: 'tech',    ok: true },
        ].map((f, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '20px 1fr 80px auto',
            gap: 14, padding: '12px 0', borderTop: i === 0 ? 'none' : '1px dotted var(--rule)',
            alignItems: 'baseline',
          }}>
            <StatusDot kind={f.ok ? 'ok' : 'warn'} />
            <div>
              <div style={{ fontSize: 13.5 }}>{f.source}</div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)', marginTop: 2 }}>
                {f.url}
              </div>
            </div>
            <span style={{ fontFamily:'var(--f-mono)', fontSize: 10, letterSpacing: '0.1em',
                           textTransform:'uppercase', color: 'var(--gray)' }}>{f.kind}</span>
            <button className="btn btn-ghost"
                    style={{ minHeight: 28, padding: '0 8px', fontSize: 11 }}>Remove</button>
          </div>
        ))}
      </div>
      <button className="btn btn-outline" style={{ marginTop: 18, height: 38, padding: '0 16px' }}>
        <I.plus size={13} /> Add custom RSS feed
      </button>
    </>
  );
}

// ── 6. Briefing ─────────────────────────────────────────────────────────────
function SettingsBriefing() {
  const TIMES = ['06:00','06:30','07:00','07:30','08:00','08:30','09:00','manual'];
  const [time, setTime] = React.useState('07:00');
  return (
    <>
      <SettingsHead
        eyebrow="Setting · VI"
        title="Briefing"
        sub="When the morning brief is generated. The scheduler runs through node-cron, coalesces across sleep / wake with Electron powerMonitor, and uses lastFiredDate to avoid double-firing."
      />

      <div className="smallcaps" style={{ marginBottom: 10 }}>Delivery time</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 8, marginBottom: 24 }}>
        {TIMES.map(t => (
          <button key={t} onClick={() => setTime(t)} style={{
            all: 'unset', boxSizing: 'border-box', cursor: 'default',
            padding: '14px 0', textAlign: 'center',
            border: '1px solid ' + (time === t ? 'var(--gold)' : 'var(--rule)'),
            background: time === t ? 'rgba(184,134,11,0.08)' : 'var(--paper)',
            color: time === t ? 'var(--gold-deep)' : 'var(--ink)',
            borderRadius: 6,
            fontFamily: 'var(--f-display)', fontSize: '1.0625rem', fontWeight: 500,
          }}>{t}</button>
        ))}
      </div>

      <SettingRow label="Time zone" value="America/New_York" />
      <SettingRow label="Days"      value="Monday — Friday" />
      <SettingRow label="LLM route" value="Frontier (Anthropic claude-sonnet) with PII redaction; falls back to local Ollama if offline" />
      <SettingRow label="Sections"  value="Today's Calendar · Priority Email · News" />
      <SettingRow label="Schema"    value="generateObject(BriefingSchema) · validated before render" />

      <p style={{ marginTop: 18, fontSize: 12.5, color: 'var(--gray-soft)',
                  fontFamily: 'var(--f-display)', fontStyle: 'italic' }}>
        If your IMPORTANT mailbox is empty, the Priority Email block shows a documented Phase-2 placeholder. Aria's own priority classifier replaces it in Phase 3.
      </p>
    </>
  );
}

// ── 7. Backup & restore ─────────────────────────────────────────────────────
function SettingsBackup() {
  return (
    <>
      <SettingsHead
        eyebrow="Setting · VII"
        title="Backup & restore"
        sub="Everything Aria knows lives in one encrypted SQLite database on this machine. Backups are VACUUM-INTO copies of that database, still encrypted with your daily password and recoverable with your 12-word phrase."
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="smallcaps" style={{ marginBottom: 8 }}>Database</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: '1.75rem', letterSpacing: '-0.01em' }}>247 MB</div>
          <p style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 4 }}>SQLCipher · chacha20 · v005</p>
        </div>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div className="smallcaps" style={{ marginBottom: 8 }}>Last backup</div>
          <div style={{ fontFamily: 'var(--f-display)', fontSize: '1.25rem', letterSpacing: '-0.01em' }}>
            16 May 23:11
          </div>
          <p style={{ fontSize: 12.5, color: 'var(--gray)', marginTop: 4 }}>aria-backup-2026-05-16.db</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <button className="btn btn-outline" style={{
          justifyContent: 'flex-start', height: 'auto', padding: '20px 22px',
          textAlign: 'left', display: 'flex', flexDirection: 'column',
          alignItems: 'flex-start', gap: 4,
        }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: '1rem', fontWeight: 500 }}>
            Export encrypted backup
          </span>
          <span style={{ fontSize: 12, color: 'var(--gray)' }}>
            VACUUM INTO ‘aria-backup-2026-05-17.db’
          </span>
        </button>
        <button className="btn btn-outline" style={{
          justifyContent: 'flex-start', height: 'auto', padding: '20px 22px',
          textAlign: 'left', display: 'flex', flexDirection: 'column',
          alignItems: 'flex-start', gap: 4,
        }}>
          <span style={{ fontFamily: 'var(--f-display)', fontSize: '1rem', fontWeight: 500 }}>
            Restore from file
          </span>
          <span style={{ fontSize: 12, color: 'var(--gray)' }}>
            Verifies recovery phrase before swap
          </span>
        </button>
      </div>

      <div style={{ marginTop: 28, padding: '16px 20px', background: 'var(--ivory-deep)',
                    borderLeft: '2px solid var(--gold)', borderRadius: 4 }}>
        <div className="smallcaps" style={{ color: 'var(--gold)', marginBottom: 8 }}>Recovery phrase</div>
        <p style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.6, marginBottom: 10 }}>
          Your 12-word phrase was shown once during setup. It is the only way to recover your data if you lose your daily password.
        </p>
        <button className="btn btn-ghost" style={{ padding: '4px 0', fontSize: 13 }}>
          Verify I still have my phrase →
        </button>
      </div>
    </>
  );
}

// ── 8. Diagnostics (Ask Aria + routing_log) ─────────────────────────────────
function SettingsDiagnostics() {
  return (
    <>
      <SettingsHead
        eyebrow="Setting · VIII"
        title="Diagnostics"
        sub="A live look at the LLM router. Ask Aria anything — the answer comes back with the route taken (LOCAL or FRONTIER) and the reason. Use it to verify that sensitive content actually stays on device."
      />

      <AskAriaBox />

      <div className="smallcaps" style={{ marginTop: 36, marginBottom: 12 }}>Routing log · today</div>
      <div className="card" style={{ padding: '4px 24px' }}>
        {ROUTING_LOG.map((r, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '52px 1fr 110px 80px',
            gap: 14, padding: '12px 0', borderTop: i === 0 ? 'none' : '1px dotted var(--rule)',
            alignItems: 'baseline',
          }}>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)' }}>
              {r.t}
            </span>
            <div>
              <div style={{ fontSize: 13.5, color: 'var(--ink)' }}>{r.q}</div>
              <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.08em',
                            color: 'var(--gray-soft)', marginTop: 2 }}>
                {r.reason}
              </div>
            </div>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray)',
                           letterSpacing: '0.05em' }}>{r.model}</span>
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.15em',
              textTransform: 'uppercase', textAlign: 'right',
              color: r.route === 'LOCAL' ? 'var(--gold-deep)' : 'var(--moss)',
            }}>
              [{r.route}]
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

const ROUTING_LOG = [
  { t: '09:34', q: "Classify · 12 incoming mails",                reason: 'Sensitive — mail bodies likely contain PII', model: 'llama3.1:8b',  route: 'LOCAL' },
  { t: '09:14', q: "Ask Aria · summarise next two meetings",      reason: 'Non-sensitive query · routed frontier',      model: 'claude-sonnet', route: 'FRONTIER' },
  { t: '08:48', q: "Prep brief · Acme partnership review",        reason: 'Names redacted before send',                 model: 'claude-sonnet', route: 'FRONTIER' },
  { t: '07:00', q: "Generate morning briefing",                   reason: 'PII redacted before send',                   model: 'claude-sonnet', route: 'FRONTIER' },
  { t: '06:42', q: "Classify · 4 overnight mails",                reason: 'Sensitive routing rule',                     model: 'llama3.1:8b',  route: 'LOCAL' },
];

function AskAriaBox() {
  const [q, setQ] = React.useState('');
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);

  function ask() {
    if (!q.trim()) return;
    setBusy(true);
    setTimeout(() => {
      const sensitive = /salary|password|ssn|tax|medical|legal|financial/i.test(q);
      setResult({
        text: sensitive
          ? "I kept this on your machine. Here is what I can say — but I won't send the prompt to a frontier model because it looks sensitive."
          : "Routed to Anthropic claude-sonnet. Here is a draft answer. (This is a diagnostic — answers in Diagnostics are stubs; the full Ask Aria with RAG ships in Phase 7.)",
        route: sensitive ? 'LOCAL' : 'FRONTIER',
        reason: sensitive ? 'Sensitive keyword detected · routed local' : 'Non-sensitive · routed frontier',
        model: sensitive ? 'llama3.1:8b' : 'claude-sonnet',
      });
      setBusy(false);
    }, 700);
  }

  return (
    <div className="card" style={{ padding: '22px 24px' }}>
      <div className="smallcaps" style={{ marginBottom: 10 }}>Ask Aria · diagnostics</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input type="text" value={q} onChange={e => setQ(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && ask()}
               placeholder="e.g. 'what's on my calendar at 3pm'"
               style={{
                 all: 'unset', boxSizing: 'border-box', flex: 1,
                 padding: '12px 14px', background: 'var(--ivory-deep)',
                 border: '1px solid var(--rule)', borderRadius: 6,
                 fontSize: 14, color: 'var(--ink)',
                 fontFamily: 'var(--f-body)',
               }} />
        <button className="btn btn-primary" onClick={ask} disabled={busy}
                style={{ minHeight: 40 }}>
          {busy ? 'Routing…' : 'Ask'}
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--gray-soft)', marginTop: 8,
                  fontFamily: 'var(--f-display)', fontStyle: 'italic' }}>
        This is the hello-Aria diagnostic from Phase 1. The full RAG-backed Ask Aria ships in Phase 7.
      </p>

      {result && (
        <div style={{
          marginTop: 18, padding: '16px 18px',
          background: 'var(--ivory-deep)', borderRadius: 6,
          borderLeft: '2px solid ' + (result.route === 'LOCAL' ? 'var(--gold)' : 'var(--moss)'),
        }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10,
                        alignItems: 'center' }}>
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 10, letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: result.route === 'LOCAL' ? 'var(--gold-deep)' : 'var(--moss)',
              padding: '2px 6px', borderRadius: 3,
              background: 'var(--paper)', border: '1px solid var(--rule)',
            }}>
              [{result.route}]
            </span>
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray)' }}>
              {result.model}
            </span>
            <span style={{ flex: 1 }} />
            <span style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)',
                           fontStyle: 'italic' }}>
              {result.reason}
            </span>
          </div>
          <div style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.6 }}>
            {result.text}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 9. RAG index ──────────────────────────────────────────────────────────
function SettingsRagIndex() {
  const r = RAG_INDEX;
  const bytes = (n) => n < 1024 ? n + ' B'
    : n < 1024**2 ? (n/1024).toFixed(1) + ' KB'
    : n < 1024**3 ? (n/1024**2).toFixed(1) + ' MB'
    : (n/1024**3).toFixed(2) + ' GB';
  const pct = r.pendingChunkCount > 0
    ? Math.round(100 * r.aliveChunkCount / (r.aliveChunkCount + r.pendingChunkCount))
    : 100;
  return (
    <>
      <SettingsHead
        eyebrow="Settings · RAG"
        title="Personal index"
        sub="Embeddings over your mail and meetings. Local-only — nothing leaves the device." />

      <div className="card" style={{ marginBottom: 18, padding: '20px 22px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 18 }}>
          <KV label="Backend"   value={r.vectorBackend === 'sqlite-vec' ? 'sqlite-vec · native' : 'fallback · brute-force'} />
          <KV label="Model"     value={r.modelId} mono />
          <KV label="Dimensions" value={r.dim + 'd'} mono />
          <KV label="Estimated" value={bytes(r.estimatedBytes)} />
        </div>

        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--gray)', marginBottom: 6 }}>
            <span>Indexed chunks</span>
            <span className="mono">{r.aliveChunkCount.toLocaleString()} / {(r.aliveChunkCount + r.pendingChunkCount).toLocaleString()}</span>
          </div>
          <div style={{ height: 8, background: 'var(--ivory-deep)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: 'var(--gold)' }} />
          </div>
        </div>

        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 10.5, color: 'var(--gray-soft)',
                      letterSpacing: '0.08em', marginTop: 8 }}>
          Last indexed {r.lastIndexedAt} · {r.backfill.state === 'idle' ? 'no backfill running' : `backfill ${r.backfill.state}`}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18, padding: '20px 22px' }}>
        <h4 style={{ marginBottom: 10 }}>Backfill</h4>
        <p style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.55, marginBottom: 14 }}>
          On first run Aria walks your historical mail and meetings to build the embedding index. Average time on Apple Silicon is ~6 min per 10k items; expect to leave this overnight on first run.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" style={{ minHeight: 34, padding: '0 16px', fontSize: 13 }}>
            <I.refresh size={12} /> Build now
          </button>
          <button className="btn btn-ghost" style={{ minHeight: 34, padding: '0 14px', fontSize: 13 }}>
            Later
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: '20px 22px' }}>
        <h4 style={{ marginBottom: 10 }}>Per-account wipe</h4>
        <p style={{ fontSize: 13, color: 'var(--gray)', lineHeight: 1.55, marginBottom: 14 }}>
          Disconnecting an account doesn't automatically purge its indexed chunks. Use this if you've disconnected an account and want its data forgotten.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {PROVIDER_ACCOUNTS.map(a => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 6,
              background: 'var(--ivory)', border: '1px solid var(--rule)',
            }}>
              <span style={{ width: 8, height: 8, borderRadius: 50, background: a.color }} />
              <span style={{ flex: 1, fontSize: 13 }}>{a.displayEmail}</span>
              <span style={{ fontFamily: 'var(--f-mono)', fontSize: 11, color: 'var(--gray-soft)' }}>
                ~{Math.round(r.aliveChunkCount / PROVIDER_ACCOUNTS.length).toLocaleString()} chunks
              </span>
              <button className="btn btn-ghost" style={{ minHeight: 28, padding: '0 10px', fontSize: 12, color: 'var(--rose)' }}>
                <I.trash size={11} /> Wipe
              </button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function KV({ label, value, mono }) {
  return (
    <div>
      <div className="smallcaps" style={{ color: 'var(--gray-soft)', marginBottom: 4 }}>{label}</div>
      <div style={{
        fontFamily: mono ? 'var(--f-mono)' : 'var(--f-display)',
        fontWeight: mono ? 400 : 500,
        fontSize: mono ? 13.5 : 18, color: 'var(--ink)',
      }}>{value}</div>
    </div>
  );
}

// ── 10. Scheduling rules ─────────────────────────────────────────────────
function SettingsSchedulingRules() {
  const r = SCHEDULING_RULES;
  return (
    <>
      <SettingsHead
        eyebrow="Settings · Scheduling"
        title="Rules of engagement"
        sub="Your meeting boundaries. Aria enforces these when drafting calendar changes." />

      <div className="card" style={{ marginBottom: 18, padding: '20px 22px' }}>
        <h4 style={{ marginBottom: 10 }}>Time zone</h4>
        <div style={{ fontFamily: 'var(--f-mono)', fontSize: 14, color: 'var(--ink)' }}>{r.timeZone}</div>
        <p style={{ fontSize: 12.5, color: 'var(--gray-soft)', marginTop: 6, fontStyle: 'italic' }}>
          All scheduling math runs in UTC; display always uses this zone.
        </p>
      </div>

      <RuleBlock title="Prime time" subtitle="Aria prefers to schedule meetings inside these windows."
                 tone="gold" items={r.primeTime} />
      <RuleBlock title="No-meeting windows" subtitle="Hard boundary — Aria refuses to schedule here."
                 tone="rose" items={r.noMeeting} />
      <RuleBlock title="Focus blocks" subtitle="Protected. Anything that lands here gets declined with a polite alt."
                 tone="ink"  items={r.focusBlocks} />

      <div className="card" style={{ marginBottom: 18, padding: '20px 22px' }}>
        <h4 style={{ marginBottom: 12 }}>Spacing</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
          <KV label="Buffer between meetings" value={r.bufferMin + ' min'} mono />
          <KV label="Max back-to-back" value={r.maxBackToBack} mono />
          <KV label="Preferred 1:1 length" value={r.preferredLengths['1:1'] + ' min'} mono />
        </div>
      </div>

      <div className="card" style={{ padding: '14px 18px', background: 'var(--ivory-deep)' }}>
        <details>
          <summary style={{ cursor: 'default', fontFamily: 'var(--f-mono)', fontSize: 11,
                            letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--gray)' }}>
            Advanced · raw JSON
          </summary>
          <pre style={{
            marginTop: 10, fontFamily: 'var(--f-mono)', fontSize: 11.5,
            background: 'var(--paper)', border: '1px solid var(--rule)',
            borderRadius: 4, padding: 12, color: 'var(--ink-soft)',
            overflowX: 'auto', lineHeight: 1.5,
          }}>{JSON.stringify(r, null, 2)}</pre>
        </details>
      </div>
    </>
  );
}

function RuleBlock({ title, subtitle, tone, items }) {
  const dot = { gold: 'var(--gold)', rose: 'var(--rose)', ink: 'var(--ink)' }[tone] || 'var(--gold)';
  return (
    <div className="card" style={{ marginBottom: 14, padding: '18px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ width: 6, height: 6, borderRadius: 50, background: dot }} />
        <h4 style={{ margin: 0 }}>{title}</h4>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--gray)', fontStyle: 'italic', margin: '0 0 12px' }}>{subtitle}</p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((it, i) => (
          <li key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '6px 10px', borderRadius: 4,
            background: 'var(--ivory)', border: '1px solid var(--rule)',
            fontSize: 13,
          }}>
            <span style={{
              fontFamily: 'var(--f-mono)', fontSize: 10.5, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: 'var(--gray-soft)', width: 36,
            }}>{it.day}</span>
            <span className="mono" style={{ fontSize: 12.5 }}>{it.start} – {it.end}</span>
            <span style={{ flex: 1, color: 'var(--gray)', fontStyle: 'italic' }}>{it.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

window.ScreenSettings = ScreenSettings;

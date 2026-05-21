/**
 * FrontierKeySection — Settings → Frontier key.
 *
 * Phase 9 design-ref `app-screen-settings.jsx > FrontierKey` parity pass:
 *   - "SETTING · II" gold mono eyebrow + H1 "Frontier API key"
 *   - Playfair italic body explaining keychain storage
 *   - "PROVIDER" mono eyebrow + uppercase pill toggle (ANTHROPIC / OPENAI / GOOGLE)
 *     with gold border + bg on active provider
 *   - "API KEY" mono eyebrow + paper input (filled bullets when present) +
 *     Show / Rotate outline buttons inline right
 *   - Post-save status row with green dot + caps mono
 *     "VALIDATED · STORED IN <PLATFORM> KEYCHAIN · LAST USED <time>"
 *   - Bottom Linux disclosure card with mono `basic_text` / `libsecret`
 *     callouts when relevant
 *
 * The raw key value still lives only in component state and is dropped
 * the moment Save returns ok. Renderer never reads the stored key back —
 * only `secretsHasFrontierKey` (boolean) — preserved verbatim.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ProviderId } from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

const PROVIDERS: ReadonlyArray<{ id: ProviderId; pill: string; long: string }> = [
  { id: 'anthropic', pill: 'Anthropic', long: 'Anthropic (Claude)' },
  { id: 'openai', pill: 'OpenAI', long: 'OpenAI' },
  { id: 'google', pill: 'Google', long: 'Google (Gemini)' },
];

const BASIC_TEXT_WARNING =
  'Your OS keychain is unavailable — Aria refuses to store the key in plaintext. Set up libsecret/gnome-keyring on Linux, or use Aria from Windows/macOS.';

/** Cheap platform sniff for the keychain-name label. */
function detectKeychain(): { label: string; isLinux: boolean } {
  if (typeof navigator === 'undefined') return { label: 'OS keychain', isLinux: false };
  const p = (navigator.platform || '').toLowerCase();
  if (p.includes('mac')) return { label: 'macOS Keychain', isLinux: false };
  if (p.includes('win')) return { label: 'Windows DPAPI', isLinux: false };
  if (p.includes('linux')) return { label: 'Linux libsecret', isLinux: true };
  return { label: 'OS keychain', isLinux: false };
}

export function FrontierKeySection(): JSX.Element {
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [keyInput, setKeyInput] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [hasKey, setHasKey] = useState<Record<ProviderId, boolean>>({
    anthropic: false,
    openai: false,
    google: false,
  });
  const [activeProvider, setActiveProviderState] = useState<ProviderId | null>(null);
  const [status, setStatus] = useState<string>('');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const keychain = useMemo(() => detectKeychain(), []);

  async function refreshAll(): Promise<void> {
    const results = await Promise.all(
      PROVIDERS.map(async (p) => {
        const res = (await window.aria.secretsHasFrontierKey({ provider: p.id })) as {
          present?: boolean;
          has?: boolean;
        };
        return [p.id, Boolean(res?.present ?? res?.has)] as const;
      }),
    );
    setHasKey({
      anthropic: false,
      openai: false,
      google: false,
      ...Object.fromEntries(results),
    } as Record<ProviderId, boolean>);
    const active = (await window.aria.secretsGetActiveProvider()) as {
      provider?: ProviderId | null;
    };
    setActiveProviderState(active?.provider ?? null);
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  async function onSave(): Promise<void> {
    setStatus('');
    if (!keyInput.trim()) {
      setStatus('Enter an API key first.');
      return;
    }
    const res = (await window.aria.secretsSetFrontierKey({ provider, key: keyInput })) as {
      ok?: boolean;
      error?: string;
    };
    if (res?.error === 'basic_text') {
      setStatus(BASIC_TEXT_WARNING);
      return;
    }
    if (res?.error) {
      setStatus(`Could not save: ${res.error}`);
      return;
    }
    await window.aria.secretsSetActiveProvider({ provider });
    setKeyInput('');
    setStatus('Saved.');
    setLastSavedAt(new Date());
    await refreshAll();
  }

  async function onClear(p: ProviderId): Promise<void> {
    setStatus('');
    const res = (await window.aria.secretsClearFrontierKey({ provider: p })) as {
      ok?: boolean;
      error?: string;
    };
    if (res?.error) {
      setStatus(`Could not clear: ${res.error}`);
      return;
    }
    setStatus('Cleared.');
    await refreshAll();
  }

  const providerHasKey = hasKey[provider];
  const inputPlaceholder = providerHasKey ? '••••••••••••••••••••••••••••••••' : 'sk-...';
  const lastUsedLabel = lastSavedAt
    ? lastSavedAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <section
      data-testid="settings-frontier-key"
      style={{
        padding: '32px 40px 80px',
        maxWidth: '64rem',
        margin: '0 auto',
        background: 'var(--paper)',
        color: 'var(--ink)',
        minHeight: '100%',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 8,
        }}
      >
        Setting · II
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 30,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 14,
          lineHeight: 1.05,
        }}
      >
        Frontier API key
      </h2>
      <p
        style={{
          fontFamily: 'var(--f-display)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--ink-soft)',
          margin: '0 0 32px 0',
          maxWidth: '52em',
          lineHeight: 1.6,
        }}
      >
        The Anthropic / OpenAI / Google key Aria uses for the heavy reasoning. Stored only in the
        operating-system keychain via Electron safeStorage; never written to the database.
      </p>

      {/* Provider pill toggle */}
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 10,
        }}
      >
        Provider
      </div>
      <div
        role="radiogroup"
        aria-label="Frontier provider"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}
      >
        {PROVIDERS.map((p) => {
          const active = provider === p.id;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              data-testid={`frontier-provider-${p.id}`}
              onClick={() => setProvider(p.id)}
              style={{
                padding: '7px 16px',
                fontFamily: 'var(--f-mono)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: active ? 'var(--gold-deep)' : 'var(--gray)',
                background: active ? 'rgba(184,134,11,0.06)' : 'var(--paper)',
                border: `1px solid ${active ? 'var(--gold)' : 'var(--rule-strong)'}`,
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                transition: `background 180ms ease, color 180ms ease, border-color 180ms ease, transform 140ms ${EASE_OUT}`,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
              onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
              onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
            >
              {p.pill}
              {hasKey[p.id] && (
                <span
                  aria-hidden="true"
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: 50,
                    background: 'var(--moss)',
                    marginLeft: 4,
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* API key input + actions */}
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gray)',
          marginBottom: 10,
        }}
      >
        API key
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap', marginBottom: 18 }}>
        <input
          type={showInput ? 'text' : 'password'}
          data-testid="frontier-key-input"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder={inputPlaceholder}
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 280,
            padding: '10px 14px',
            fontFamily: 'var(--f-mono)',
            fontSize: 13,
            color: 'var(--ink)',
            background: 'var(--ivory-deep)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 'var(--radius)',
            outline: 'none',
            transition: 'border-color 180ms ease, background 180ms ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--gold)';
            e.currentTarget.style.background = 'var(--paper)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--rule-strong)';
            e.currentTarget.style.background = 'var(--ivory-deep)';
          }}
        />
        <button
          type="button"
          data-testid="frontier-key-show"
          onClick={() => setShowInput((v) => !v)}
          style={ghostBtn()}
        >
          {showInput ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          data-testid="frontier-key-rotate"
          onClick={() => {
            setKeyInput('');
            setShowInput(true);
          }}
          style={ghostBtn()}
          aria-label="Rotate: clear input and prepare to paste a new key"
        >
          Rotate
        </button>
      </div>

      {/* Save / Clear primary actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="frontier-key-save"
          onClick={() => void onSave()}
          disabled={!keyInput.trim()}
          style={{
            padding: '9px 18px',
            fontFamily: 'var(--f-body)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.01em',
            color: 'var(--paper)',
            background: keyInput.trim() ? 'var(--gold)' : 'var(--rule-strong)',
            border: 'none',
            borderRadius: 'var(--radius)',
            cursor: keyInput.trim() ? 'pointer' : 'not-allowed',
            transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
          }}
          onMouseEnter={(e) => {
            if (keyInput.trim()) e.currentTarget.style.background = 'var(--gold-deep)';
          }}
          onMouseLeave={(e) => {
            if (keyInput.trim()) e.currentTarget.style.background = 'var(--gold)';
          }}
          onMouseDown={(e) => {
            if (keyInput.trim()) e.currentTarget.style.transform = 'scale(0.97)';
          }}
          onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          Save {provider} key
        </button>
        {providerHasKey && (
          <button
            type="button"
            data-testid="frontier-key-clear"
            onClick={() => void onClear(provider)}
            style={{
              padding: '9px 18px',
              fontFamily: 'var(--f-body)',
              fontSize: 13,
              color: 'var(--ink-soft)',
              background: 'var(--paper)',
              border: '1px solid var(--rule-strong)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition: `border-color 180ms ease, color 180ms ease`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--rose)';
              e.currentTarget.style.color = 'var(--rose)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--rule-strong)';
              e.currentTarget.style.color = 'var(--ink-soft)';
            }}
          >
            Clear {provider} key
          </button>
        )}
      </div>

      {/* Status row */}
      {(providerHasKey || activeProvider === provider) && (
        <div
          data-testid="frontier-key-status"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--moss)',
            marginBottom: 18,
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 6, height: 6, borderRadius: 50, background: 'var(--moss)' }}
          />
          {activeProvider === provider ? 'Active · ' : ''}
          Stored in {keychain.label}
          {lastUsedLabel ? ` · Last saved ${lastUsedLabel}` : ''}
        </div>
      )}

      {status && (
        <p
          role="status"
          data-testid="frontier-key-message"
          style={{
            marginTop: 8,
            marginBottom: 18,
            padding: '8px 12px',
            fontSize: 13,
            color: status.startsWith('Could not') || status === BASIC_TEXT_WARNING ? 'var(--rose)' : 'var(--ink-soft)',
            background:
              status.startsWith('Could not') || status === BASIC_TEXT_WARNING
                ? 'rgba(184,73,58,0.06)'
                : 'rgba(91,110,58,0.06)',
            borderLeft: `2px solid ${
              status.startsWith('Could not') || status === BASIC_TEXT_WARNING ? 'var(--rose)' : 'var(--moss)'
            }`,
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          {status}
        </p>
      )}

      {/* Linux disclosure */}
      {keychain.isLinux && (
        <aside
          style={{
            marginTop: 30,
            padding: '14px 18px',
            background: 'var(--ivory-deep)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-lg)',
            fontSize: 14,
            color: 'var(--ink-soft)',
            lineHeight: 1.6,
            maxWidth: '54em',
          }}
        >
          <strong style={{ fontWeight: 600 }}>On Linux,</strong> if the safeStorage backend is{' '}
          <code style={{ fontFamily: 'var(--f-mono)', fontSize: 12.5, color: 'var(--ink)' }}>basic_text</code>{' '}
          (no libsecret), Aria refuses to write the key and asks you to install{' '}
          <code style={{ fontFamily: 'var(--f-mono)', fontSize: 12.5, color: 'var(--ink)' }}>libsecret</code>{' '}
          or keep using local-only routes.
        </aside>
      )}
    </section>
  );
}

function ghostBtn(): React.CSSProperties {
  return {
    padding: '8px 14px',
    fontFamily: 'var(--f-body)',
    fontSize: 12.5,
    color: 'var(--ink-soft)',
    background: 'var(--paper)',
    border: '1px solid var(--rule-strong)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    transition: 'border-color 180ms ease, color 180ms ease',
  };
}

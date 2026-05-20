/**
 * FrontierKeySection (Plan 03 Task 2).
 *
 * Provider radio (anthropic / openai / google) + password input + Save/Clear.
 * The raw key value lives only in component state and is cleared the moment
 * Save returns ok. The renderer never reads the stored key back — only
 * `secretsHasFrontierKey` (boolean).
 */
import { useEffect, useState } from 'react';
import { Button, Card, LabelRule } from '../../components/editorial';
import type { ProviderId } from '../../../shared/ipc-contract';

const PROVIDERS: ReadonlyArray<{ id: ProviderId; label: string }> = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google (Gemini)' },
];

const BASIC_TEXT_WARNING =
  'Your OS keychain is unavailable — Aria refuses to store the key in plaintext. Set up libsecret/gnome-keyring on Linux, or use Aria from Windows/macOS.';

export function FrontierKeySection(): JSX.Element {
  const [provider, setProvider] = useState<ProviderId>('anthropic');
  const [keyInput, setKeyInput] = useState('');
  const [hasKey, setHasKey] = useState<Record<ProviderId, boolean>>({
    anthropic: false,
    openai: false,
    google: false,
  });
  const [activeProvider, setActiveProviderState] = useState<ProviderId | null>(null);
  const [status, setStatus] = useState<string>('');

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
    // Make this provider the active one on successful save.
    await window.aria.secretsSetActiveProvider({ provider });
    setKeyInput(''); // raw key dropped from renderer state
    setStatus('Saved.');
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

  return (
    <section
      data-testid="settings-frontier-key"
      style={{ padding: 32, maxWidth: '64rem', margin: '0 auto', background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        Settings · Connections
      </div>
      <h2
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 28,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          margin: 0,
          marginBottom: 18,
          borderBottom: '1px solid var(--rule)',
          paddingBottom: 12,
        }}
      >
        Frontier API key
      </h2>
      <p style={{ marginTop: 0, color: 'var(--ink-soft)', fontFamily: 'var(--f-body)' }}>
        Keys are encrypted by your OS keychain (DPAPI on Windows, Keychain on macOS,
        libsecret on Linux) and never written to disk in plaintext.
      </p>

      <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--aria-space-md)' }}>
        <legend style={{ marginBottom: 'var(--aria-space-sm)' }}>Provider</legend>
        {PROVIDERS.map((p) => (
          <label key={p.id} style={{ display: 'inline-flex', gap: 4, marginRight: 12 }}>
            <input
              type="radio"
              name="frontier-provider"
              value={p.id}
              checked={provider === p.id}
              onChange={() => setProvider(p.id)}
            />
            <span>
              {p.label}
              {hasKey[p.id] ? ' ✓' : ''}
              {activeProvider === p.id ? ' (Active)' : ''}
            </span>
          </label>
        ))}
      </fieldset>

      <label style={{ display: 'block', marginBottom: 'var(--aria-space-md)' }}>
        <span style={{ display: 'block', marginBottom: 4 }}>API key</span>
        <input
          type="password"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="sk-..."
          style={{ width: '100%', maxWidth: 480, padding: 6 }}
          autoComplete="off"
        />
      </label>

      <Card style={{ padding: 0, marginBottom: 12 }}>
        <LabelRule label="Actions" align="left" />
      </Card>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" onClick={() => void onSave()}>
          Save {provider} key
        </Button>
        {hasKey[provider] && (
          <Button variant="outline" onClick={() => void onClear(provider)}>
            Clear {provider} key
          </Button>
        )}
      </div>

      {status && (
        <p role="status" style={{ marginTop: 'var(--aria-space-md)' }}>
          {status}
        </p>
      )}
    </section>
  );
}

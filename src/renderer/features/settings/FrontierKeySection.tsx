/**
 * FrontierKeySection (Plan 03 Task 2).
 *
 * Provider radio (anthropic / openai / google) + password input + Save/Clear.
 * The raw key value lives only in component state and is cleared the moment
 * Save returns ok. The renderer never reads the stored key back — only
 * `secretsHasFrontierKey` (boolean).
 */
import { useEffect, useState } from 'react';
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
    <section data-testid="settings-frontier-key" style={{ padding: 'var(--aria-space-lg)' }}>
      <h2 style={{ fontSize: 'var(--aria-type-xl)', marginTop: 0 }}>Frontier API key</h2>
      <p style={{ marginTop: 0, color: 'var(--aria-fg-muted)' }}>
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

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => void onSave()}>
          Save {provider} key
        </button>
        {hasKey[provider] && (
          <button type="button" onClick={() => void onClear(provider)}>
            Clear {provider} key
          </button>
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

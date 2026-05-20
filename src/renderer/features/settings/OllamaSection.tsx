/**
 * OllamaSection (Plan 03 Task 2; extended for user-configurable model picker).
 *
 * Polls window.aria.ollamaStatus() every 10s. Renders reachable badge +
 * version + a dropdown for the active model (when reachable). When unreachable,
 * shows the literal install instructions with the Windows install URL (D-10).
 *
 * The dropdown sources its options from `OllamaStatus.models` (the live `tags`
 * list returned by the probe). Saving calls OLLAMA_SET_ACTIVE_MODEL which
 * re-validates against tags server-side before persisting — surface its error
 * inline (e.g. `model-not-installed` if the user pulls/removes between probes).
 */
import { useEffect, useState } from 'react';
import type {
  OllamaActiveModel,
  OllamaSetActiveModelResult,
  OllamaStatus,
} from '../../../shared/ipc-contract';

const OLLAMA_INSTALL_URL = 'https://ollama.com/download/windows';
const POLL_MS = 10_000;

function hasErrorField(v: unknown): v is { error: string } {
  return (
    !!v && typeof v === 'object' && 'error' in (v as object) && !('ok' in (v as object))
  );
}

export function OllamaSection(): JSX.Element {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [active, setActive] = useState<OllamaActiveModel | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Poll Ollama status.
  useEffect(() => {
    let cancelled = false;
    async function tick(): Promise<void> {
      const next = (await window.aria.ollamaStatus()) as OllamaStatus;
      if (!cancelled) setStatus(next);
    }
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Load the active-model + provenance once on mount, and after every save.
  async function refreshActive(): Promise<void> {
    const next = (await window.aria.ollamaGetActiveModel()) as OllamaActiveModel | { error: string };
    if (!hasErrorField(next)) {
      setActive(next);
      if (next.modelId && !selected) setSelected(next.modelId);
    }
  }
  useEffect(() => {
    void refreshActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(): Promise<void> {
    if (!selected) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = (await window.aria.ollamaSetActiveModel({ modelId: selected })) as
        | OllamaSetActiveModelResult
        | { error: string };
      // Narrow via runtime shape — IpcError envelope vs result envelope have
      // distinct shapes (IpcError lacks `ok`, result always has `ok`).
      if (!('ok' in res)) {
        setSaveError((res as { error: string }).error);
      } else if (res.ok === false) {
        setSaveError(res.error);
      } else {
        await refreshActive();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section data-testid="settings-ollama" style={{ padding: 'var(--aria-space-lg)' }}>
      <h2 style={{ fontFamily: 'var(--f-display)', fontSize: 28, fontWeight: 500, color: 'var(--ink)', marginTop: 0, borderBottom: '1px solid var(--rule)', paddingBottom: 12 }}>Local model (Ollama)</h2>
      {status === null && <p>Checking Ollama…</p>}
      {status?.reachable && (
        <div>
          <p>
            <strong>Reachable</strong> at 127.0.0.1:11434
            {status.version ? ` (v${status.version})` : ''}
          </p>
          <p>
            Installed models: <strong>{status.models.length}</strong>
            {status.models.length > 0 ? ` — ${status.models.join(', ')}` : ''}
          </p>
          {status.models.length > 0 && (
            <div style={{ marginTop: 'var(--aria-space-md)' }}>
              <label
                htmlFor="ollama-model-select"
                style={{ display: 'block', marginBottom: 4 }}
              >
                Active model
              </label>
              <select
                id="ollama-model-select"
                data-testid="ollama-model-select"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setSaveError(null);
                }}
                disabled={saving}
              >
                {!selected && <option value="">(select a model)</option>}
                {status.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>{' '}
              <button
                type="button"
                data-testid="ollama-model-save"
                onClick={() => void handleSave()}
                disabled={saving || !selected || selected === active?.modelId}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              {active && (
                <p
                  data-testid="ollama-active-model"
                  style={{ marginTop: 4, color: 'var(--aria-fg-muted)' }}
                >
                  Active model: <strong>{active.modelId ?? '(unset)'}</strong>{' '}
                  <span
                    data-testid="ollama-active-provenance"
                    style={{
                      marginLeft: 6,
                      padding: '0 6px',
                      border: '1px solid var(--aria-fg-muted)',
                      borderRadius: 4,
                      fontSize: '0.85em',
                    }}
                  >
                    {active.source}
                  </span>
                </p>
              )}
              {saveError && (
                <p
                  role="alert"
                  data-testid="ollama-model-error"
                  style={{ color: '#b91c1c', marginTop: 4 }}
                >
                  {saveError}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {status && !status.reachable && (
        <div role="alert">
          <p>
            <strong>Install Ollama to enable LOCAL routing</strong>
          </p>
          <p>
            Aria uses Ollama for on-device classification and embeddings. Until you
            install it, Aria will run in FRONTIER-only mode (if a key is configured).
          </p>
          <p>
            <a href={OLLAMA_INSTALL_URL} target="_blank" rel="noreferrer noopener">
              Install Ollama (Windows)
            </a>
          </p>
          <p style={{ color: 'var(--aria-fg-muted)' }}>
            After install, ensure the Ollama service is running and pull a model:
            <code style={{ marginLeft: 6 }}>ollama pull llama3.1:8b</code>
          </p>
        </div>
      )}
    </section>
  );
}

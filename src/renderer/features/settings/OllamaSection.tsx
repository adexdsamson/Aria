/**
 * OllamaSection (Plan 03 Task 2).
 *
 * Polls window.aria.ollamaStatus() every 10s. Renders reachable badge +
 * version + model count. When unreachable, shows the literal install
 * instructions with the Windows install URL (D-10).
 */
import { useEffect, useState } from 'react';
import type { OllamaStatus } from '../../../shared/ipc-contract';

const OLLAMA_INSTALL_URL = 'https://ollama.com/download/windows';
const POLL_MS = 10_000;

export function OllamaSection(): JSX.Element {
  const [status, setStatus] = useState<OllamaStatus | null>(null);

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

  return (
    <section data-testid="settings-ollama" style={{ padding: 'var(--aria-space-lg)' }}>
      <h2 style={{ fontSize: 'var(--aria-type-xl)', marginTop: 0 }}>Local model (Ollama)</h2>
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

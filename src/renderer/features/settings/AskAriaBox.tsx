/**
 * AskAriaBox — Settings → Diagnostics interactive prompt box (Plan 04 Task 3).
 *
 * UX:
 *   1. textarea for the prompt
 *   2. source selector (default 'generic')
 *   3. Submit → window.aria.askAria({ prompt, source })
 *   4. Renders answer + route badge ([LOCAL] / [FRONTIER]) + reason + latency
 *
 * The reason string is rendered verbatim — it is part of the routing contract
 * (D-06) and the user-facing audit trail.
 */
import { useState } from 'react';
import type {
  AskResponse,
  IpcError,
  Route,
  SourceTag,
} from '../../../shared/ipc-contract';

const SOURCES: ReadonlyArray<SourceTag> = [
  'generic',
  'user-email',
  'user-calendar',
  'user-transcript',
];

interface AskResult {
  answer: string;
  route: Route;
  reason: string;
  latency_ms: number;
}

function isAskResponse(r: AskResponse | IpcError): r is AskResponse {
  return (r as AskResponse).answer !== undefined;
}

export interface AskAriaBoxProps {
  /** Fires after a successful Ask so the routing-log panel can refresh. */
  onAnswered?: () => void;
}

export function AskAriaBox({ onAnswered }: AskAriaBoxProps): JSX.Element {
  const [prompt, setPrompt] = useState<string>('');
  const [source, setSource] = useState<SourceTag>('generic');
  const [pending, setPending] = useState<boolean>(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!prompt.trim() || pending) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = (await window.aria.askAria({ prompt, source })) as
        | AskResponse
        | IpcError;
      if (isAskResponse(res)) {
        setResult({
          answer: res.answer,
          route: res.route,
          reason: res.reason,
          latency_ms: res.latency_ms,
        });
        onAnswered?.();
      } else {
        setError(res.error);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section data-testid="ask-aria-box" style={{ marginBottom: 'var(--aria-space-xl)' }}>
      <h3 style={{ fontSize: 'var(--aria-type-lg)', marginTop: 0 }}>Ask Aria</h3>
      <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="ask-prompt" style={{ fontSize: 'var(--aria-type-sm)' }}>
          Prompt
        </label>
        <textarea
          id="ask-prompt"
          data-testid="ask-prompt"
          placeholder="Ask Aria anything…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          disabled={pending}
          style={{ resize: 'vertical', fontFamily: 'inherit', padding: 8 }}
        />
        <label htmlFor="ask-source" style={{ fontSize: 'var(--aria-type-sm)' }}>
          Source
        </label>
        <select
          id="ask-source"
          data-testid="ask-source"
          value={source}
          onChange={(e) => setSource(e.target.value as SourceTag)}
          disabled={pending}
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button type="submit" data-testid="ask-submit" disabled={pending || !prompt.trim()}>
          {pending ? 'Asking…' : 'Submit'}
        </button>
      </form>

      {pending && (
        <p data-testid="ask-pending" style={{ marginTop: 12, color: 'var(--aria-fg-muted)' }}>
          <span aria-busy="true">Routing decision pending…</span>
        </p>
      )}
      {error && (
        <p data-testid="ask-error" role="alert" style={{ marginTop: 12, color: 'var(--aria-danger)' }}>
          Error: {error}
        </p>
      )}
      {result && (
        <div data-testid="ask-result" style={{ marginTop: 12 }}>
          <p>
            <RouteBadge route={result.route} />{' '}
            <code data-testid="ask-reason">{result.reason}</code>{' '}
            <span style={{ color: 'var(--aria-fg-muted)' }}>
              ({result.latency_ms} ms)
            </span>
          </p>
          <pre
            data-testid="ask-answer"
            style={{
              whiteSpace: 'pre-wrap',
              backgroundColor: 'var(--aria-surface-alt)',
              padding: 12,
              borderRadius: 6,
            }}
          >
            {result.answer}
          </pre>
        </div>
      )}
    </section>
  );
}

function RouteBadge({ route }: { route: Route }): JSX.Element {
  const isLocal = route === 'LOCAL';
  return (
    <span
      data-testid={`route-badge-${route}`}
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 'var(--aria-type-sm)',
        fontWeight: 600,
        backgroundColor: isLocal ? 'var(--aria-accent)' : 'var(--aria-surface-alt)',
        color: isLocal ? 'var(--aria-accent-fg)' : 'var(--aria-fg)',
      }}
    >
      [{route}]
    </span>
  );
}

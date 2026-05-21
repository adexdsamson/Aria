/**
 * AskAriaBox — Settings → Diagnostics interactive prompt box (Plan 04 Task 3).
 *
 * Phase 9 design-ref pass:
 *   - Editorial in-card form: single Playfair-italic textarea + Source select
 *     + gold "Ask" button. Heading is owned by the parent card eyebrow
 *     ("ASK ARIA · DIAGNOSTICS"), so this component no longer renders its
 *     own h3.
 *   - Result block: route pill + verbatim reason + latency + answer in
 *     ivory-deep mono block.
 *
 * IPC + data-testids preserved verbatim. The reason string is rendered
 * verbatim — it is part of the routing contract (D-06).
 */
import { useState } from 'react';
import type {
  AskResponse,
  IpcError,
  Route,
  SourceTag,
} from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <section data-testid="ask-aria-box">
      <form onSubmit={onSubmit}>
        <textarea
          id="ask-prompt"
          data-testid="ask-prompt"
          placeholder='e.g. "what&apos;s on my calendar at 3pm"'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          disabled={pending}
          style={{
            width: '100%',
            padding: '10px 14px',
            background: 'var(--paper)',
            color: 'var(--ink)',
            border: '1px solid var(--rule-strong)',
            borderRadius: 'var(--radius)',
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            fontSize: 16,
            lineHeight: 1.5,
            outline: 'none',
            resize: 'vertical',
            boxSizing: 'border-box',
            transition: 'border-color 180ms ease',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--gold)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--rule-strong)')}
        />

        <div
          style={{
            marginTop: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <label
            htmlFor="ask-source"
            style={{
              fontFamily: 'var(--f-mono)',
              fontSize: 10,
              fontWeight: 500,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--gray)',
            }}
          >
            Source
          </label>
          <select
            id="ask-source"
            data-testid="ask-source"
            value={source}
            onChange={(e) => setSource(e.target.value as SourceTag)}
            disabled={pending}
            style={{
              padding: '6px 10px',
              fontFamily: 'var(--f-mono)',
              fontSize: 12,
              color: 'var(--ink-soft)',
              background: 'var(--paper)',
              border: '1px solid var(--rule-strong)',
              borderRadius: 'var(--radius-sm)',
              cursor: pending ? 'not-allowed' : 'pointer',
            }}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <span style={{ flex: 1 }} />

          <button
            type="submit"
            data-testid="ask-submit"
            disabled={pending || !prompt.trim()}
            style={{
              padding: '8px 22px',
              fontFamily: 'var(--f-body)',
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.01em',
              color: 'var(--paper)',
              background: pending || !prompt.trim() ? 'var(--rule-strong)' : 'var(--gold)',
              border: 'none',
              borderRadius: 'var(--radius)',
              cursor: pending || !prompt.trim() ? 'not-allowed' : 'pointer',
              transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
            }}
            onMouseEnter={(e) => {
              if (!pending && prompt.trim()) e.currentTarget.style.background = 'var(--gold-deep)';
            }}
            onMouseLeave={(e) => {
              if (!pending && prompt.trim()) e.currentTarget.style.background = 'var(--gold)';
            }}
            onMouseDown={(e) => {
              if (!pending && prompt.trim()) e.currentTarget.style.transform = 'scale(0.97)';
            }}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            {pending ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </form>

      {pending && (
        <p
          data-testid="ask-pending"
          aria-busy="true"
          style={{
            marginTop: 14,
            fontFamily: 'var(--f-mono)',
            fontSize: 11,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
          }}
        >
          Routing decision pending…
        </p>
      )}

      {error && (
        <p
          data-testid="ask-error"
          role="alert"
          style={{
            marginTop: 14,
            padding: '8px 12px',
            fontFamily: 'var(--f-mono)',
            fontSize: 12,
            color: 'var(--rose)',
            background: 'rgba(184,73,58,0.06)',
            borderLeft: '2px solid var(--rose)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          {error}
        </p>
      )}

      {result && (
        <div data-testid="ask-result" style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 10,
              flexWrap: 'wrap',
            }}
          >
            <ResultRouteBadge route={result.route} />
            <code
              data-testid="ask-reason"
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12,
                color: 'var(--ink-soft)',
                fontStyle: 'italic',
              }}
            >
              {result.reason}
            </code>
            <span
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                color: 'var(--gray-soft)',
                letterSpacing: '0.1em',
              }}
            >
              {result.latency_ms} ms
            </span>
          </div>
          <pre
            data-testid="ask-answer"
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--f-body)',
              fontSize: 14,
              lineHeight: 1.6,
              color: 'var(--ink)',
              background: 'var(--ivory-deep)',
              padding: '14px 16px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--rule)',
              margin: 0,
            }}
          >
            {result.answer}
          </pre>
        </div>
      )}
    </section>
  );
}

function ResultRouteBadge({ route }: { route: Route }): JSX.Element {
  const isLocal = route === 'LOCAL';
  return (
    <span
      data-testid={`route-badge-${route}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--f-mono)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: isLocal ? 'var(--moss)' : 'var(--gold-deep)',
        background: isLocal ? 'rgba(91,110,58,0.08)' : 'rgba(184,134,11,0.08)',
        border: `1px solid ${isLocal ? 'rgba(91,110,58,0.30)' : 'rgba(184,134,11,0.30)'}`,
      }}
    >
      [{route}]
    </span>
  );
}

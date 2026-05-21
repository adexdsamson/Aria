/**
 * OllamaSection — Settings → Local model.
 *
 * Phase 9 design-ref `app-screen-settings.jsx > LocalModel` parity pass:
 *   - "SETTING · III" gold mono eyebrow + H1 "Local model"
 *   - Playfair italic body explaining Ollama-as-sidecar + sensitive-content
 *     stays-local trust posture
 *   - Probe card: chip glyph + "Ollama · localhost:11434" + subline
 *     "Reachable · OpenAI-compatible · v<version>" + green dot + Re-probe
 *     ghost button
 *   - "INSTALLED MODELS" mono eyebrow
 *   - Model rows: radio (rendered as checkbox visual) + model id (mono) +
 *     curated description (italic gray) + size estimate (mono right) +
 *     INSTALLED status pill
 *   - Unreachable state: editorial install-instructions block with mono
 *     `ollama pull llama3.1:8b` callout
 *
 * IPC + state + data-testids preserved verbatim.
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  OllamaActiveModel,
  OllamaSetActiveModelResult,
  OllamaStatus,
} from '../../../shared/ipc-contract';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const OLLAMA_INSTALL_URL = 'https://ollama.com/download/windows';
const POLL_MS = 10_000;

/** Curated descriptions for well-known models; falls back to '' otherwise. */
function describeModel(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.startsWith('llama3.1')) return 'Sensitive routing & classification';
  if (m.startsWith('llama3.2')) return 'Sensitive routing & classification';
  if (m.startsWith('nomic-embed')) return 'Embeddings (Phase 7 RAG)';
  if (m.startsWith('qwen')) return 'Backup classifier (optional)';
  if (m.startsWith('mistral')) return 'Alternative reasoning model';
  return '';
}

/** Cheap size estimate for the rightmost column (real sizes come from `ollama list`,
 *  not the status probe — render '—' when unknown). */
function sizeFor(modelId: string): string {
  const m = modelId.toLowerCase();
  if (m.includes('nomic-embed')) return '274 MB';
  if (m.includes('3.1:8b') || m.includes('3.2:8b')) return '4.7 GB';
  if (m.includes('qwen2.5:7b')) return '4.4 GB';
  if (m.includes(':3b')) return '2.0 GB';
  return '—';
}

function hasErrorField(v: unknown): v is { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object) && !('ok' in (v as object));
}

export function OllamaSection(): JSX.Element {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [active, setActive] = useState<OllamaActiveModel | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [reprobing, setReprobing] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function tick(): Promise<void> {
    const next = (await window.aria.ollamaStatus()) as OllamaStatus;
    setStatus(next);
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = (await window.aria.ollamaStatus()) as OllamaStatus;
      if (!cancelled) setStatus(next);
    })();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  async function refreshActive(): Promise<void> {
    const next = (await window.aria.ollamaGetActiveModel()) as
      | OllamaActiveModel
      | { error: string };
    if (!hasErrorField(next)) {
      setActive(next);
      if (next.modelId && !selected) setSelected(next.modelId);
    }
  }
  useEffect(() => {
    void refreshActive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(modelId: string): Promise<void> {
    if (!modelId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = (await window.aria.ollamaSetActiveModel({ modelId })) as
        | OllamaSetActiveModelResult
        | { error: string };
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

  async function handleReprobe(): Promise<void> {
    setReprobing(true);
    try {
      await tick();
    } finally {
      setReprobing(false);
    }
  }

  const hasModels = useMemo(() => (status?.models?.length ?? 0) > 0, [status]);

  return (
    <section
      data-testid="settings-ollama"
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
        Setting · III
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
        Local model
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
        Ollama runs alongside Aria as a sidecar on localhost:11434. Sensitive content — PII,
        financial language — is routed here so it never leaves the machine.
      </p>

      {status === null && (
        <p
          style={{
            fontFamily: 'var(--f-display)',
            fontStyle: 'italic',
            color: 'var(--gray)',
          }}
        >
          Checking Ollama…
        </p>
      )}

      {status?.reachable && (
        <>
          {/* Probe card */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              padding: '18px 22px',
              background: 'var(--paper)',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius-lg)',
              marginBottom: 28,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 40,
                height: 40,
                borderRadius: 'var(--radius)',
                background: 'rgba(91,110,58,0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--moss)',
                flexShrink: 0,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <line x1="2" y1="9" x2="4" y2="9" />
                <line x1="2" y1="15" x2="4" y2="15" />
                <line x1="20" y1="9" x2="22" y2="9" />
                <line x1="20" y1="15" x2="22" y2="15" />
                <line x1="9" y1="2" x2="9" y2="4" />
                <line x1="15" y1="2" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="22" />
                <line x1="15" y1="20" x2="15" y2="22" />
              </svg>
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontFamily: 'var(--f-display)',
                  fontSize: 17,
                  fontWeight: 500,
                  color: 'var(--ink)',
                  lineHeight: 1.3,
                }}
              >
                Ollama · localhost:11434
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: 'var(--f-mono)',
                  fontSize: 11,
                  color: 'var(--gray)',
                  letterSpacing: '0.08em',
                }}
              >
                Reachable · OpenAI-compatible{status.version ? ` · v${status.version}` : ''}
              </div>
            </div>
            <span
              aria-label="reachable"
              style={{ width: 8, height: 8, borderRadius: 50, background: 'var(--moss)' }}
            />
            <button
              type="button"
              data-testid="ollama-reprobe"
              onClick={() => void handleReprobe()}
              disabled={reprobing}
              style={{
                padding: '7px 14px',
                fontFamily: 'var(--f-body)',
                fontSize: 12.5,
                color: 'var(--ink-soft)',
                background: 'var(--paper)',
                border: '1px solid var(--rule-strong)',
                borderRadius: 'var(--radius)',
                cursor: reprobing ? 'not-allowed' : 'pointer',
                transition: 'border-color 180ms ease, color 180ms ease',
              }}
              onMouseEnter={(e) => {
                if (!reprobing) {
                  e.currentTarget.style.borderColor = 'var(--gold-light)';
                  e.currentTarget.style.color = 'var(--gold-deep)';
                }
              }}
              onMouseLeave={(e) => {
                if (!reprobing) {
                  e.currentTarget.style.borderColor = 'var(--rule-strong)';
                  e.currentTarget.style.color = 'var(--ink-soft)';
                }
              }}
            >
              {reprobing ? '…' : 'Re-probe'}
            </button>
          </div>

          {/* Installed models */}
          {hasModels && (
            <>
              <div
                style={{
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase',
                  color: 'var(--gray)',
                  marginBottom: 4,
                }}
              >
                Installed models
              </div>

              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {status.models.map((modelId, i) => {
                  const isActive = active?.modelId === modelId;
                  const desc = describeModel(modelId);
                  const size = sizeFor(modelId);
                  return (
                    <li
                      key={modelId}
                      style={{
                        borderTop: '1px solid var(--rule)',
                        borderBottom: i === status.models.length - 1 ? '1px solid var(--rule)' : 'none',
                      }}
                    >
                      <button
                        type="button"
                        data-testid={`ollama-model-row-${modelId}`}
                        onClick={() => void handleSave(modelId)}
                        disabled={saving || isActive}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          background: 'transparent',
                          border: 'none',
                          padding: '16px 8px',
                          display: 'grid',
                          gridTemplateColumns: '18px 1fr auto auto',
                          gap: 14,
                          alignItems: 'center',
                          cursor: saving || isActive ? 'default' : 'pointer',
                          transition: 'background 160ms ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!saving && !isActive)
                            e.currentTarget.style.background = 'rgba(184,134,11,0.03)';
                        }}
                        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            width: 14,
                            height: 14,
                            borderRadius: 3,
                            background: isActive ? 'var(--gold)' : 'var(--paper)',
                            border: `1px solid ${isActive ? 'var(--gold)' : 'var(--rule-strong)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            justifySelf: 'center',
                            color: 'var(--paper)',
                          }}
                        >
                          {isActive && (
                            <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="2 6.5 5 9.5 10 3" />
                            </svg>
                          )}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span
                            style={{
                              display: 'block',
                              fontFamily: 'var(--f-mono)',
                              fontSize: 13,
                              fontWeight: 500,
                              color: 'var(--ink)',
                              lineHeight: 1.3,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {modelId}
                          </span>
                          {desc && (
                            <span
                              style={{
                                display: 'block',
                                marginTop: 4,
                                fontFamily: 'var(--f-display)',
                                fontStyle: 'italic',
                                fontSize: 13,
                                color: 'var(--gray)',
                                lineHeight: 1.4,
                              }}
                            >
                              {desc}
                            </span>
                          )}
                        </span>
                        <span
                          style={{
                            fontFamily: 'var(--f-mono)',
                            fontSize: 11,
                            color: 'var(--gray)',
                            letterSpacing: '0.04em',
                          }}
                        >
                          {size}
                        </span>
                        <span
                          data-testid={isActive ? 'ollama-active-model' : undefined}
                          style={{
                            fontFamily: 'var(--f-mono)',
                            fontSize: 10,
                            fontWeight: 600,
                            letterSpacing: '0.16em',
                            textTransform: 'uppercase',
                            color: isActive ? 'var(--moss)' : 'var(--gray)',
                            background: isActive
                              ? 'rgba(91,110,58,0.08)'
                              : 'var(--ivory-deep)',
                            border: `1px solid ${
                              isActive ? 'rgba(91,110,58,0.30)' : 'var(--rule-strong)'
                            }`,
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-sm)',
                          }}
                        >
                          {isActive ? 'Active' : 'Installed'}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {saveError && (
                <p
                  role="alert"
                  data-testid="ollama-model-error"
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
                  {saveError}
                </p>
              )}

              {active && (
                <p
                  data-testid="ollama-active-provenance"
                  style={{
                    marginTop: 14,
                    fontFamily: 'var(--f-mono)',
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--gray-soft)',
                  }}
                >
                  Source: {active.source}
                </p>
              )}
            </>
          )}
        </>
      )}

      {status && !status.reachable && (
        <div
          role="alert"
          style={{
            padding: '22px 26px',
            background: 'var(--ivory-deep)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--radius-lg)',
            maxWidth: '54em',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--f-display)',
              fontSize: 18,
              fontWeight: 500,
              color: 'var(--ink)',
              marginBottom: 10,
            }}
          >
            Install Ollama to enable LOCAL routing
          </div>
          <p style={{ margin: '0 0 14px 0', fontSize: 14, lineHeight: 1.65, color: 'var(--ink-soft)' }}>
            Aria uses Ollama for on-device classification and embeddings. Until you install it,
            Aria will run in FRONTIER-only mode (if a key is configured).
          </p>
          <a
            href={OLLAMA_INSTALL_URL}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              display: 'inline-block',
              padding: '8px 16px',
              fontFamily: 'var(--f-body)',
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--paper)',
              background: 'var(--gold)',
              borderRadius: 'var(--radius)',
              textDecoration: 'none',
              marginBottom: 14,
              transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--gold-deep)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--gold)')}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            Install Ollama (Windows)
          </a>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: 'var(--gray)',
              lineHeight: 1.6,
            }}
          >
            After install, ensure the Ollama service is running and pull a model:{' '}
            <code
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 12.5,
                color: 'var(--ink)',
                background: 'var(--paper)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--rule)',
              }}
            >
              ollama pull llama3.1:8b
            </code>
          </p>
        </div>
      )}
    </section>
  );
}

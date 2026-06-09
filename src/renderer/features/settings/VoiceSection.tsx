/**
 * Phase 17 / Plan 17-06 Task 1 — Settings → Voice panel (D-16/VOICE-08).
 *
 * Voice preferences backed by VOICE_GET_PREFS / VOICE_SET_PREFS IPC pair
 * (Plan 04 real handlers). Follows BehaviourSection.tsx pattern exactly:
 * editorial card chrome, Playfair heading, Checkbox primitives, hairline
 * divider rows, optimistic-update + revert pattern.
 *
 * D-14 threat mitigated: first useCloud=true toggle opens a consent modal
 * with the data-handling disclosure before writing the pref. If the user
 * dismisses the modal the Checkbox stays unchecked.
 *
 * D-15 user-facing guarantee: after consent, an info line reads
 * "Sensitivity-flagged turns always processed locally." This is always shown
 * when useCloud=true regardless of consent timing.
 */
import type * as React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoicePrefsDto, VoicePrefsPatchDto } from '../../../shared/ipc-contract';
import { Checkbox } from '../../components/editorial/Checkbox';
import { Button } from '../../components/editorial/Button';
import { Modal } from '../../components/editorial/Modal';

// ─── Local view ───────────────────────────────────────────────────────────────

interface VoicePrefsView {
  speed: number;
  voiceId: string;
  useCloud: boolean;
  cloudConsented: boolean; // tracks whether cloud consent disclosure was accepted
}

const DEFAULT_VIEW: VoicePrefsView = {
  speed: 1.0,
  voiceId: '',
  useCloud: false,
  cloudConsented: false,
};

// ─── Type guard ───────────────────────────────────────────────────────────────

function isPrefsDto(x: unknown): x is VoicePrefsDto {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { speed?: unknown }).speed === 'number' &&
    typeof (x as { voiceId?: unknown }).voiceId === 'string' &&
    typeof (x as { useCloud?: unknown }).useCloud === 'boolean'
  );
}

// ─── IPC invoke helpers ───────────────────────────────────────────────────────

function invokeVoiceGet(): Promise<VoicePrefsDto | { error: string }> {
  const aria = window.aria as unknown as Record<string, () => Promise<VoicePrefsDto | { error: string }>>;
  return aria.voiceGetPrefs();
}

function invokeVoiceSet(patch: Partial<VoicePrefsPatchDto>): Promise<VoicePrefsDto | { error: string }> {
  const aria = window.aria as unknown as Record<string, (p: unknown) => Promise<VoicePrefsDto | { error: string }>>;
  return aria.voiceSetPrefs(patch);
}

// ─── Component ───────────────────────────────────────────────────────────────

export function VoiceSection(): JSX.Element {
  const [view, setView] = useState<VoicePrefsView>(DEFAULT_VIEW);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cloud consent modal state (D-14)
  const [consentModalOpen, setConsentModalOpen] = useState(false);
  // Ref to track "pending useCloud enable awaiting consent" so the modal
  // confirm can proceed with the actual write.
  const pendingCloudEnableRef = useRef(false);

  // Load prefs on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await invokeVoiceGet();
        if (cancelled) return;
        if (isPrefsDto(res)) {
          // cloudConsented is stored in settings KV (voice.cloudAudio.consented).
          // The DTO doesn't expose it directly, so we track it in local state:
          // if useCloud=true was previously saved, the user must have consented.
          setView((prev) => ({
            ...prev,
            speed: res.speed,
            voiceId: res.voiceId,
            useCloud: res.useCloud,
            // If cloud was already enabled (saved in prefs), treat it as consented.
            cloudConsented: res.useCloud ? true : prev.cloudConsented,
          }));
        }
      } catch {
        // Non-fatal — use defaults
      }
      if (!cancelled) setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-clear error after 4s
  useEffect(() => {
    if (!error) return undefined;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  // Generic update helper — optimistic update + IPC write + revert on error
  const update = useCallback(
    async (patch: Partial<VoicePrefsPatchDto>): Promise<void> => {
      // Optimistic
      setView((v) => ({
        ...v,
        ...(patch.speed !== undefined ? { speed: patch.speed } : {}),
        ...(patch.voiceId !== undefined ? { voiceId: patch.voiceId } : {}),
        ...(patch.useCloud !== undefined ? { useCloud: patch.useCloud } : {}),
      }));

      try {
        const res = await invokeVoiceSet(patch);
        if (isPrefsDto(res)) {
          setView((v) => ({
            ...v,
            speed: res.speed,
            voiceId: res.voiceId,
            useCloud: res.useCloud,
          }));
        } else {
          // Revert
          setView((v) => ({
            ...v,
            ...(patch.speed !== undefined ? { speed: view.speed } : {}),
            ...(patch.voiceId !== undefined ? { voiceId: view.voiceId } : {}),
            ...(patch.useCloud !== undefined ? { useCloud: view.useCloud } : {}),
          }));
          setError('Update failed');
        }
      } catch {
        // Revert
        setView((v) => ({
          ...v,
          ...(patch.speed !== undefined ? { speed: view.speed } : {}),
          ...(patch.voiceId !== undefined ? { voiceId: view.voiceId } : {}),
          ...(patch.useCloud !== undefined ? { useCloud: view.useCloud } : {}),
        }));
        setError('Update failed');
      }
    },
    [view],
  );

  // Handle useCloud toggle — requires consent modal on first enable (D-14)
  const handleCloudToggle = useCallback(
    (next: boolean): void => {
      if (next && !view.cloudConsented) {
        // First-time enable: open consent disclosure modal, defer write
        pendingCloudEnableRef.current = true;
        setConsentModalOpen(true);
        return;
      }
      if (!next) {
        // Disable: write immediately
        void update({ useCloud: false });
      } else {
        // Re-enable after prior consent: write immediately
        void update({ useCloud: true });
      }
    },
    [view.cloudConsented, update],
  );

  // Consent modal: user clicked "I Understand, Enable"
  const handleConsentConfirm = useCallback((): void => {
    setConsentModalOpen(false);
    if (pendingCloudEnableRef.current) {
      pendingCloudEnableRef.current = false;
      setView((v) => ({ ...v, cloudConsented: true }));
      void update({ useCloud: true });
    }
  }, [update]);

  // Consent modal: user cancelled
  const handleConsentCancel = useCallback((): void => {
    pendingCloudEnableRef.current = false;
    setConsentModalOpen(false);
    // Leave Checkbox unchecked — do NOT write useCloud=true
  }, []);

  return (
    <div data-testid="settings-voice" style={containerStyle}>
      <div style={cardStyle}>
        <div style={headerStyle}>SETTINGS · VOICE</div>
        <h2 style={titleStyle}>Voice</h2>
        <p style={descStyle}>
          Control how Aria speaks and listens. Local processing is the default.
          Cloud audio processing (OpenAI Whisper) is opt-in with a disclosure.
        </p>

        {error && (
          <div role="alert" data-testid="voice-section-error" style={alertStyle}>
            UPDATE FAILED
          </div>
        )}

        <div style={rowsStyle}>
          {/* Speed select row */}
          <div style={rowStyle}>
            <label style={labelRowStyle}>
              <span style={labelStyle}>Playback speed</span>
              <select
                data-testid="voice-speed-select"
                value={view.speed}
                disabled={!loaded}
                onChange={(e) => void update({ speed: parseFloat(e.target.value) })}
                style={selectStyle}
              >
                <option value={0.75}>0.75×</option>
                <option value={1.0}>1.0×</option>
                <option value={1.25}>1.25×</option>
                <option value={1.5}>1.5×</option>
              </select>
            </label>
            <p style={helperStyle}>Adjust how fast Aria speaks responses. 1.0× is natural pace.</p>
          </div>

          {/* Voice ID row (advanced / optional) */}
          <div style={rowStyle}>
            <label style={labelRowStyle}>
              <span style={labelStyle}>Voice <span style={experimentalBadgeStyle}>experimental</span></span>
              <input
                type="text"
                data-testid="voice-id-input"
                value={view.voiceId}
                placeholder="Default Kokoro voice"
                disabled={!loaded}
                onChange={(e) => void update({ voiceId: e.target.value })}
                style={inputStyle}
              />
            </label>
            <p style={helperStyle}>
              Kokoro voice name override (e.g. <code style={{ fontFamily: 'var(--f-mono)', fontSize: 11 }}>af_sarah</code>).
              Leave blank to use the default voice.
            </p>
          </div>

          {/* Cloud audio toggle row */}
          <div style={rowStyle}>
            <Checkbox
              label={<span style={labelStyle}>Enable cloud audio processing</span>}
              checked={view.useCloud}
              disabled={!loaded}
              data-testid="voice-cloud-toggle"
              onChange={(e) => handleCloudToggle(e.currentTarget.checked)}
            />
            <p style={helperStyle}>
              Sends audio to OpenAI Whisper for transcription. Subject to
              OpenAI&rsquo;s standard data retention (30 days; or zero with
              Enterprise plan).
            </p>
            {view.useCloud && (
              <div data-testid="voice-cloud-local-guarantee" style={guaranteeStyle}>
                Sensitivity-flagged turns always processed locally.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cloud consent disclosure modal (D-14, T-17-16) */}
      <Modal
        open={consentModalOpen}
        onClose={handleConsentCancel}
        title="Cloud Audio Processing"
        eyebrow="Data disclosure"
        size="sm"
        footer={
          <>
            <Button
              variant="ghost"
              data-testid="voice-consent-cancel"
              onClick={handleConsentCancel}
              style={{ minHeight: 32, padding: '0 14px', fontSize: 13 }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              data-testid="voice-consent-confirm"
              onClick={handleConsentConfirm}
              style={{ minHeight: 32, padding: '0 16px', fontSize: 13 }}
            >
              I Understand, Enable
            </Button>
          </>
        }
      >
        <div style={disclosureBodyStyle}>
          <p style={disclosureParaStyle}>
            When enabled, raw audio from your microphone is uploaded to{' '}
            <strong>OpenAI</strong> for transcription via the Whisper API.
          </p>
          <ul style={disclosureListStyle}>
            <li>
              <strong>What leaves your device:</strong> Raw audio for speech-to-text
              transcription; transcribed text for TTS answer generation.
            </li>
            <li>
              <strong>Recipient:</strong> OpenAI (api.openai.com).
            </li>
            <li>
              <strong>Retention:</strong> 30-day standard data retention. Zero data
              retention (ZDR) is available on OpenAI Enterprise plans.
            </li>
            <li>
              <strong>Sensitivity override:</strong> Turns classified as sensitive
              (financial, legal, HR, PII) always stay on-device regardless of this
              setting.
            </li>
          </ul>
          <p style={{ ...disclosureParaStyle, marginBottom: 0 }}>
            You can disable cloud audio at any time from Settings → Voice.
          </p>
        </div>
      </Modal>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  padding: 32,
  maxWidth: 720,
};

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  padding: 28,
};

const headerStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.22em',
  textTransform: 'uppercase',
  color: 'var(--gray)',
  marginBottom: 6,
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--f-display)',
  fontStyle: 'italic',
  fontWeight: 400,
  fontSize: 28,
  margin: '0 0 10px',
  color: 'var(--ink)',
};

const descStyle: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 14,
  lineHeight: 1.55,
  color: 'var(--ink-soft)',
  margin: '0 0 18px',
};

const alertStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
  padding: '8px 12px',
  marginBottom: 14,
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.18em',
  color: 'var(--gold)',
};

const rowsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const rowStyle: React.CSSProperties = {
  borderTop: '1px solid var(--rule)',
  paddingTop: 10,
  paddingBottom: 4,
};

const labelRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  cursor: 'default',
};

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 15,
  color: 'var(--ink)',
};

const helperStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  lineHeight: 1.55,
  color: 'var(--ink-soft)',
  opacity: 0.7,
  margin: '4px 0 8px 0',
};

const selectStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 13,
  padding: '4px 8px',
  border: '1px solid var(--rule-strong)',
  borderRadius: 3,
  background: 'var(--paper)',
  color: 'var(--ink)',
  cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 13,
  padding: '4px 8px',
  border: '1px solid var(--rule-strong)',
  borderRadius: 3,
  background: 'var(--paper)',
  color: 'var(--ink)',
  width: 200,
  boxSizing: 'border-box',
};

const experimentalBadgeStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  color: 'var(--gray)',
  border: '1px solid var(--rule)',
  borderRadius: 3,
  padding: '1px 5px',
  marginLeft: 6,
  verticalAlign: 'middle',
};

const guaranteeStyle: React.CSSProperties = {
  fontFamily: 'var(--f-mono)',
  fontSize: 11,
  letterSpacing: '0.04em',
  color: 'var(--gold-deep, var(--gold))',
  border: '1px solid rgba(184,134,11,0.25)',
  background: 'rgba(184,134,11,0.08)',
  borderRadius: 3,
  padding: '6px 10px',
  marginTop: 8,
  marginBottom: 4,
};

const disclosureBodyStyle: React.CSSProperties = {
  fontFamily: 'var(--f-body)',
  fontSize: 14,
  color: 'var(--ink)',
  lineHeight: 1.55,
};

const disclosureParaStyle: React.CSSProperties = {
  margin: '0 0 12px',
};

const disclosureListStyle: React.CSSProperties = {
  paddingLeft: 20,
  margin: '0 0 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

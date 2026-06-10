/**
 * BriefingScreen — daily editorial briefing.
 *
 * Phase 9 design-ref port (`app-screen-briefing.jsx`):
 *   - Date masthead row: "The Morning · Vol. N" · date · route badge · regenerate
 *   - Headline with italic date subtitle
 *   - Dropcap Playfair preamble paragraph
 *   - Section cascade (Open Actions / This week / Calendar / Email / News)
 *   - Editorial footer routing log line
 *
 * Animation (Emil principles):
 *   - Initial section cascade via staggered animation-delay (50ms per section,
 *     starts from translateY(8px) + opacity 0, lands in ~320ms ease-out)
 *   - Regenerate confirm dialog: translateY(6px) → 0 + opacity, NOT scale-from-zero
 *   - Regenerate button: scale(0.97) on :active, color shift on :hover
 *   - prefers-reduced-motion guard removes all transforms; keeps opacity
 *
 * Phase 16 / Plan 16-04b — Briefing read-aloud (D-07/D-10):
 *   - "Read Aloud" button reads BriefingPayload sections (calendar/email/news)
 *     via useReadAloudQueue — NO LLM streaming (Pitfall 4 explicitly avoided)
 *   - Section walker: currentSectionIndex over ['calendar','email','news']
 *   - Skip wired to VoiceHUDBand onSkipSection: queue.cancel() + next section
 *   - Pause/resume via VoiceHUDBand transport controls
 *   - Stop: voiceState leaving 'speaking' resets currentSectionIndex to -1
 *
 * IPC + state + data-testids preserved verbatim from prior implementation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BriefingItem, BriefingNewsItem, BriefingPayload, IpcError } from '../../../shared/ipc-contract';
import { RouteBadge } from '../../components/editorial';
import { GenerateNowAffordance } from './GenerateNowAffordance';
import { SectionCalendar } from './SectionCalendar';
import { SectionEmail } from './SectionEmail';
import { SectionNews } from './SectionNews';
import { InlineApprovalsPreview } from '../approvals/InlineApprovalsPreview';
import { BriefingFeedbackChips } from './BriefingFeedbackChips';
import { SkeletonRoot, SkeletonBlock, SkeletonLine } from '../../components/Skeleton';
import { useKokoroPlayer } from '../voice/tts/useKokoroPlayer';
import { useReadAloudQueue } from '../voice/useReadAloudQueue';
import { useVoiceSession } from '../voice/useVoiceSession';
import { VoiceHUDBand } from '../voice/VoiceHUDBand';

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

// ─── Section keys for D-10 walker ─────────────────────────────────────────────

const BRIEFING_SECTION_KEYS = ['calendar', 'email', 'news'] as const;

// ─── Phase 21: WhatsApp digest section helpers ─────────────────────────────────

/**
 * Parse the four fixed-header sections from a WhatsApp group digest summary_text.
 * Partial-parse tolerant — missing sections return empty string.
 * Headers: ### KEY POINTS, ### DECISIONS, ### OPEN QUESTIONS, ### MENTIONS
 */
function parseDigestSections(text: string): {
  keyPoints: string;
  decisions: string;
  openQuestions: string;
  mentions: string;
} {
  const result = { keyPoints: '', decisions: '', openQuestions: '', mentions: '' };
  if (!text) return result;

  let current: keyof typeof result | null = null;
  const lines = text.split('\n');
  const buckets: Record<keyof typeof result, string[]> = {
    keyPoints: [],
    decisions: [],
    openQuestions: [],
    mentions: [],
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '### KEY POINTS') { current = 'keyPoints'; continue; }
    if (trimmed === '### DECISIONS') { current = 'decisions'; continue; }
    if (trimmed === '### OPEN QUESTIONS') { current = 'openQuestions'; continue; }
    if (trimmed === '### MENTIONS') { current = 'mentions'; continue; }
    if (current !== null) buckets[current].push(line);
  }

  result.keyPoints = buckets.keyPoints.join('\n').trim();
  result.decisions = buckets.decisions.join('\n').trim();
  result.openQuestions = buckets.openQuestions.join('\n').trim();
  result.mentions = buckets.mentions.join('\n').trim();
  return result;
}

/**
 * Phase 21 — digest retry affordance.
 * Mirrors GenerateNowAffordance shape but calls whatsappGenerateDigestNow (NOT briefingGenerateNow).
 * Shows a quiet connection note when the WhatsApp connection is degraded / needs-auth.
 */
function DigestGenerateNowAffordance({
  connection,
}: {
  connection?: 'degraded' | 'needs-auth';
}): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = (await window.aria.whatsappGenerateDigestNow()) as {
        ok?: boolean;
        error?: string;
      };
      if (!result?.ok) {
        setError(result?.error ?? 'unknown');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      {connection === 'degraded' && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--gray)',
            fontStyle: 'italic',
            margin: '0 0 8px 0',
          }}
        >
          WhatsApp connection is degraded — check Settings to reconnect.
        </p>
      )}
      {connection === 'needs-auth' && (
        <p
          style={{
            fontSize: 12,
            color: 'var(--gray)',
            fontStyle: 'italic',
            margin: '0 0 8px 0',
          }}
        >
          WhatsApp connection needs relink — check Settings to reconnect.
        </p>
      )}
      <button
        type="button"
        data-testid="briefing-whatsapp-retry"
        onClick={() => void onClick()}
        disabled={busy}
        style={{
          padding: '7px 16px',
          fontSize: 13,
          fontFamily: 'var(--f-body)',
          fontWeight: 500,
          color: 'var(--paper)',
          background: busy ? 'var(--rule-strong)' : 'var(--gold)',
          border: 'none',
          borderRadius: 'var(--radius)',
          cursor: busy ? 'not-allowed' : 'pointer',
          transition: 'background 200ms ease',
        }}
      >
        {busy ? 'Generating…' : 'Retry digest now'}
      </button>
      {error && (
        <p
          role="alert"
          style={{
            color: 'var(--rose)',
            fontSize: 12,
            fontFamily: 'var(--f-mono)',
            marginTop: 8,
            marginBottom: 0,
          }}
        >
          Failed: {error}
        </p>
      )}
    </div>
  );
}

/**
 * Build a plain-text TTS string from a briefing section.
 * Pitfall 4: reads from already-loaded BriefingPayload — no LLM streaming.
 */
function buildSectionText(
  sectionKey: 'calendar' | 'email' | 'news',
  items: BriefingItem[] | BriefingNewsItem[],
): string {
  if (!items || items.length === 0) {
    const sectionNames: Record<string, string> = {
      calendar: 'calendar',
      email: 'email',
      news: 'news',
    };
    return `No ${sectionNames[sectionKey] ?? sectionKey} items today.`;
  }

  const sectionIntros: Record<string, string> = {
    calendar: 'Calendar.',
    email: 'Email highlights.',
    news: 'News.',
  };
  const intro = sectionIntros[sectionKey] ?? '';

  const lines = items
    .slice(0, 3) // cap at 3 items for concise TTS (CONTEXT top-3 budget)
    .map((item, i) => {
      const parts: string[] = [`${i + 1}. ${item.title}`];
      if (item.why) parts.push(item.why);
      return parts.join('. ');
    });

  return `${intro} ${lines.join('. ')}.`;
}

// ─── Utility guards ────────────────────────────────────────────────────────────

async function dismissBriefingInsight(briefingDate: string, kind: string): Promise<void> {
  try {
    await window.aria.briefingInsightDismiss({ briefingDate, kind });
  } catch {
    /* non-fatal */
  }
}

function isPayload(v: unknown): v is BriefingPayload {
  return (
    !!v &&
    typeof v === 'object' &&
    'date' in (v as object) &&
    'sections' in (v as object) === false &&
    'calendar' in (v as object)
  );
}

function isErr(v: unknown): v is IpcError | { error: string } {
  return !!v && typeof v === 'object' && 'error' in (v as object);
}

/** Compute "Vol. I, No. <day-of-year>" so the masthead changes each day. */
function volumeForDate(d: Date): string {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  const day = Math.floor(diff / 86_400_000);
  return `Vol. I, No. ${day}`;
}

function formatHeader(date: string, tz: string): string {
  try {
    const d = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return date;
  }
}

function formatMastheadDate(date: string, tz: string): string {
  try {
    const d = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat(undefined, {
      timeZone: tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return date;
  }
}

export function BriefingScreen(): JSX.Element {
  const [payload, setPayload] = useState<BriefingPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Phase 16 / D-10: section walker state (-1 = not reading)
  const [currentSectionIndex, setCurrentSectionIndex] = useState(-1);

  const today = useMemo(() => new Date(), []);
  const todayVolume = useMemo(() => volumeForDate(today), [today]);

  // Phase 16 / D-07: Kokoro player + shared read-aloud queue
  const [speed] = useState(1.0);
  const { voiceState } = useVoiceSession();
  const player = useKokoroPlayer();
  const queue = useReadAloudQueue(player, speed);

  // Build the section text array from the loaded payload.
  // Memoised so it only recalculates when payload changes.
  const sectionTexts = useMemo((): string[] => {
    if (!payload) return [];
    return BRIEFING_SECTION_KEYS.map((key) => {
      const items = payload[key] as BriefingItem[];
      return buildSectionText(key, items);
    });
  }, [payload]);

  // Track previous voiceState for stop detection.
  const prevVoiceStateRef = useRef(voiceState);

  // Phase 16: Stop read-aloud when voiceState leaves 'speaking'.
  useEffect(() => {
    const prev = prevVoiceStateRef.current;
    prevVoiceStateRef.current = voiceState;

    if (prev === 'speaking' && voiceState !== 'speaking') {
      // Playback ended or was interrupted — reset walker.
      queue.cancel();
      setCurrentSectionIndex(-1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState]);

  // Phase 16 / D-10: advance section walker — enqueue the next section when
  // currentSectionIndex changes to a valid index.
  useEffect(() => {
    if (currentSectionIndex < 0 || currentSectionIndex >= sectionTexts.length) return;
    const text = sectionTexts[currentSectionIndex];
    if (text) {
      queue.enqueue(text);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSectionIndex]);

  // Phase 16 / D-10: Skip section handler — cancel current + advance.
  const handleSkipSection = useCallback(() => {
    queue.cancel();
    setCurrentSectionIndex((idx) => {
      const next = idx + 1;
      if (next >= sectionTexts.length) {
        return -1; // done
      }
      return next;
    });
  }, [queue, sectionTexts.length]);

  const load = useCallback(async (): Promise<void> => {
    const res = await window.aria.briefingToday();
    if (isPayload(res)) {
      setPayload(res);
    } else if (isErr(res)) {
      setPayload(null);
    }
    setLoaded(true);
  }, []);

  const regenerate = useCallback(async (): Promise<void> => {
    setConfirmOpen(false);
    setRegenerating(true);
    setRegenerateError(null);
    try {
      const res = await window.aria.briefingRegenerateToday();
      if (isPayload(res)) {
        setPayload(res);
      } else if (isErr(res)) {
        setRegenerateError((res as { error: string }).error);
      }
    } finally {
      setRegenerating(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Section cascade animation — shared style block injected once.
  // Sections opt in via `data-aria-cascade={N}` where N is the 0-based index.
  const animationStyles = (
    <style>{`
      [data-aria-cascade] {
        opacity: 0;
        transform: translateY(8px);
        animation: aria-cascade 360ms ${EASE_OUT} forwards;
      }
      [data-aria-cascade="0"] { animation-delay: 0ms; }
      [data-aria-cascade="1"] { animation-delay: 60ms; }
      [data-aria-cascade="2"] { animation-delay: 120ms; }
      [data-aria-cascade="3"] { animation-delay: 180ms; }
      [data-aria-cascade="4"] { animation-delay: 240ms; }
      [data-aria-cascade="5"] { animation-delay: 300ms; }
      [data-aria-cascade="6"] { animation-delay: 360ms; }
      @keyframes aria-cascade {
        to { opacity: 1; transform: translateY(0); }
      }
      [data-aria-confirm] {
        opacity: 0;
        transform: translateY(6px);
        animation: aria-confirm-in 220ms ${EASE_OUT} forwards;
      }
      @keyframes aria-confirm-in {
        to { opacity: 1; transform: translateY(0); }
      }
      [data-aria-press]:active:not(:disabled) {
        transform: scale(0.97);
      }
      [data-aria-regen]:hover:not(:disabled) {
        color: var(--gold-deep) !important;
        background: rgba(184,134,11,0.06) !important;
      }
      /* Editorial dropcap — first letter floats, Playfair italic, hangs into the column gutter. */
      .aria-dropcap::first-letter {
        float: left;
        font-family: var(--f-display);
        font-style: italic;
        font-weight: 500;
        font-size: 5.5em;
        line-height: 0.85;
        padding: 0.12em 0.12em 0 0;
        margin-right: 0.04em;
        color: var(--ink);
      }
      @media (prefers-reduced-motion: reduce) {
        [data-aria-cascade], [data-aria-confirm] {
          transform: none !important;
          animation: aria-fade-only 200ms ease forwards !important;
        }
        @keyframes aria-fade-only { to { opacity: 1; } }
        [data-aria-press]:active:not(:disabled) { transform: none !important; }
      }
    `}</style>
  );

  if (!loaded) {
    return (
      <section data-testid="briefing-loading" style={{ padding: '32px 40px', maxWidth: '52rem' }}>
        <SkeletonRoot>
          {/* Masthead row */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 24 }}>
            <SkeletonLine width={110} height={10} />
            <SkeletonLine width={160} height={10} />
          </div>
          {/* Headline */}
          <SkeletonBlock width="72%" height={38} radius={5} style={{ marginBottom: 10 }} />
          <SkeletonLine width="42%" height={14} style={{ marginBottom: 36 }} />
          {/* Dropcap paragraph */}
          <SkeletonLine width="100%" height={13} style={{ marginBottom: 8 }} />
          <SkeletonLine width="96%" height={13} style={{ marginBottom: 8 }} />
          <SkeletonLine width="88%" height={13} style={{ marginBottom: 32 }} />
          {/* Section 1 */}
          <SkeletonLine width={80} height={10} style={{ marginBottom: 12 }} />
          <SkeletonBlock width="100%" height={72} radius={6} style={{ marginBottom: 28 }} />
          {/* Section 2 */}
          <SkeletonLine width={80} height={10} style={{ marginBottom: 12 }} />
          <SkeletonBlock width="100%" height={90} radius={6} style={{ marginBottom: 28 }} />
          {/* Section 3 */}
          <SkeletonLine width={80} height={10} style={{ marginBottom: 12 }} />
          <SkeletonBlock width="100%" height={72} radius={6} />
        </SkeletonRoot>
      </section>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!payload) {
    const todayMasthead = formatMastheadDate(
      today.toISOString().slice(0, 10),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    const todayHeader = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    }).format(today);

    return (
      <section
        style={{ maxWidth: 920, margin: '0 auto', padding: '32px 40px 80px', color: 'var(--ink)' }}
        data-testid="briefing-screen"
      >
        {animationStyles}
        <MastheadRow
          volume={todayVolume}
          dateLabel={todayMasthead}
          tz={Intl.DateTimeFormat().resolvedOptions().timeZone}
          rightContent={null}
          cascadeIndex={0}
        />
        <div data-aria-cascade="1" style={{ marginBottom: 32 }}>
          <h1
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 500,
              fontSize: 'clamp(2rem, 4vw, 2.75rem)',
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              margin: '0 0 14px 0',
            }}
          >
            Today's Briefing —{' '}
            <span style={{ fontStyle: 'italic', color: 'var(--gray)' }}>{todayHeader}</span>
          </h1>
        </div>
        <div data-aria-cascade="2">
          <GenerateNowAffordance onDone={() => void load()} />
        </div>
      </section>
    );
  }

  // ── Populated state ─────────────────────────────────────────────────────
  const dateLabel = formatHeader(payload.date, payload.tz);
  const mastheadDate = formatMastheadDate(payload.date, payload.tz);
  const isReading = currentSectionIndex >= 0;

  return (
    <section
      style={{ maxWidth: 920, margin: '0 auto', padding: '32px 40px 80px', color: 'var(--ink)' }}
      data-testid="briefing-screen"
    >
      {animationStyles}

      {/* Phase 16: VoiceHUDBand in briefing mode — transport controls + skip */}
      <VoiceHUDBand
        state={voiceState}
        transcript=""
        player={player}
        mode="briefing"
        onSkipSection={handleSkipSection}
      />

      {/* Masthead row — volume / date / route badge / regenerate / read-aloud */}
      <MastheadRow
        volume={todayVolume}
        dateLabel={mastheadDate}
        tz={payload.tz}
        cascadeIndex={0}
        rightContent={
          <>
            {/* Phase 16 / D-10: Read Aloud button */}
            {!isReading && (
              <button
                type="button"
                data-testid="briefing-read-aloud-btn"
                data-aria-press
                onClick={() => {
                  // Start the section walker from the beginning.
                  // The useEffect watching currentSectionIndex will enqueue section 0.
                  setCurrentSectionIndex(0);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '4px 8px',
                  marginLeft: 4,
                  cursor: 'pointer',
                  color: 'var(--gold)',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  borderRadius: 'var(--radius-sm)',
                  transition: `color 180ms ease, background 180ms ease, transform 140ms ${EASE_OUT}`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--gold-deep)';
                  e.currentTarget.style.background = 'rgba(184,134,11,0.06)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--gold)';
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                ▶ Read Aloud
              </button>
            )}
            {isReading && (
              <button
                type="button"
                data-testid="briefing-stop-aloud-btn"
                data-aria-press
                onClick={() => {
                  queue.cancel();
                  setCurrentSectionIndex(-1);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '4px 8px',
                  marginLeft: 4,
                  cursor: 'pointer',
                  color: 'var(--rose)',
                  fontFamily: 'var(--f-mono)',
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  borderRadius: 'var(--radius-sm)',
                  transition: `color 180ms ease, background 180ms ease, transform 140ms ${EASE_OUT}`,
                }}
              >
                ■ Stop
              </button>
            )}
            <span data-testid={`route-badge-${payload.route}`}>
              <RouteBadge route={payload.route} />
            </span>
            <button
              type="button"
              data-testid="briefing-regenerate-btn"
              data-aria-press
              data-aria-regen
              onClick={() => setConfirmOpen(true)}
              disabled={regenerating}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 8px',
                marginLeft: 4,
                cursor: regenerating ? 'not-allowed' : 'pointer',
                color: 'var(--gold)',
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                borderRadius: 'var(--radius-sm)',
                transition: `color 180ms ease, background 180ms ease, transform 140ms ${EASE_OUT}`,
              }}
            >
              {regenerating ? '… Regenerating' : '↺ Regenerate'}
            </button>
          </>
        }
      />

      {/* Headline + italic date subtitle */}
      <div data-aria-cascade="1" style={{ marginBottom: 48 }}>
        <h1
          style={{
            fontFamily: 'var(--f-display)',
            fontWeight: 500,
            fontSize: 'clamp(2.5rem, 5vw, 3.5rem)',
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            margin: '0 0 22px 0',
          }}
        >
          Today's Briefing —{' '}
          <span style={{ fontStyle: 'italic', color: 'var(--gray)' }}>{dateLabel}</span>
        </h1>

        {/* Editorial preamble — true CSS dropcap (Playfair italic, hangs left,
            floats 3 lines deep). Per design-ref `app-screen-briefing.jsx` ".dropcap"
            class. Fleuron closes the paragraph. */}
        <p
          className="aria-dropcap"
          style={{
            fontSize: '1.0625rem',
            lineHeight: 1.75,
            color: 'var(--ink-soft)',
            maxWidth: '38em',
            margin: 0,
            letterSpacing: '0.005em',
            textWrap: 'pretty' as const,
          }}
        >
          good morning. A quiet brief of what matters today — your calendar, the
          mail flagged important, and a short pull from the wire.{' '}
          <span style={{ fontStyle: 'italic', color: 'var(--gold)' }}>❦</span>
        </p>
      </div>

      {regenerateError && (
        <p
          role="alert"
          data-testid="briefing-regenerate-error"
          style={{
            color: 'var(--rose)',
            fontSize: 12,
            fontFamily: 'var(--f-mono)',
            letterSpacing: '0.06em',
            margin: '0 0 16px 0',
            padding: '8px 12px',
            background: 'rgba(184,73,58,0.06)',
            borderLeft: '2px solid var(--rose)',
            borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
          }}
        >
          Could not regenerate: {regenerateError}
        </p>
      )}

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="briefing-regenerate-confirm"
          data-aria-confirm
          style={{
            border: '1px solid var(--rule-strong)',
            background: 'var(--ivory-deep)',
            padding: '14px 18px',
            borderRadius: 'var(--radius)',
            marginBottom: 24,
            fontSize: 13.5,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <p style={{ margin: 0, flex: 1, color: 'var(--ink-soft)' }}>
            Regenerate today's briefing? This replaces the current one and writes a
            new <span style={{ fontFamily: 'var(--f-mono)', fontSize: 12 }}>routing_log</span> row.
          </p>
          <button
            type="button"
            data-testid="briefing-regenerate-confirm-btn"
            data-aria-press
            onClick={() => void regenerate()}
            disabled={regenerating}
            style={{
              padding: '6px 14px',
              fontSize: 12.5,
              fontFamily: 'var(--f-body)',
              fontWeight: 600,
              color: 'var(--paper)',
              background: regenerating ? 'var(--rule-strong)' : 'var(--gold)',
              border: 'none',
              borderRadius: 'var(--radius)',
              cursor: regenerating ? 'not-allowed' : 'pointer',
              transition: `background 200ms ease, transform 140ms ${EASE_OUT}`,
            }}
            onMouseEnter={(e) => {
              if (!regenerating) e.currentTarget.style.background = 'var(--gold-deep)';
            }}
            onMouseLeave={(e) => {
              if (!regenerating) e.currentTarget.style.background = 'var(--gold)';
            }}
          >
            Regenerate
          </button>
          <button
            type="button"
            data-testid="briefing-regenerate-cancel-btn"
            data-aria-press
            onClick={() => setConfirmOpen(false)}
            disabled={regenerating}
            style={{
              padding: '6px 12px',
              fontSize: 12.5,
              fontFamily: 'var(--f-body)',
              color: 'var(--ink-soft)',
              background: 'transparent',
              border: '1px solid var(--rule-strong)',
              borderRadius: 'var(--radius)',
              cursor: regenerating ? 'not-allowed' : 'pointer',
              transition: `background 180ms ease, transform 140ms ${EASE_OUT}`,
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div data-aria-cascade="2">
        <InlineApprovalsPreview />
      </div>

      {payload.openActions && payload.openActions.length > 0 && (
        <section data-testid="briefing-open-actions" data-aria-cascade="3" style={{ marginBottom: 48 }}>
          <SectionHead>Open Actions</SectionHead>
          <ItalicLede>
            Unresolved commitments from meetings and email, ranked by deadline.
          </ItalicLede>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {payload.openActions.map((item, i) => (
              <li
                key={item.id}
                style={{
                  padding: '14px 0',
                  borderTop: '1px solid var(--rule)',
                  borderBottom:
                    i === payload.openActions!.length - 1 ? '1px solid var(--rule)' : 'none',
                }}
              >
                <div style={{ fontSize: 14.5, color: 'var(--ink)', marginBottom: 4 }}>
                  {item.title}
                </div>
                <Why text={item.why ?? ''} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {payload.thisWeekInsights?.state === 'locked' && (
        <section data-testid="briefing-insights-locked" data-aria-cascade="4" style={{ marginBottom: 28 }}>
          <SectionHead>This week</SectionHead>
          <p style={{ fontSize: 13.5, color: 'var(--gray)', fontStyle: 'italic', margin: 0 }}>
            Insights unlock in <strong>{payload.thisWeekInsights.daysRemaining}</strong>{' '}
            day{payload.thisWeekInsights.daysRemaining === 1 ? '' : 's'}.
          </p>
        </section>
      )}

      {payload.thisWeekInsights?.state === 'unlocked' &&
        payload.thisWeekInsights.rows.length > 0 && (
          <section data-testid="briefing-insights" data-aria-cascade="4" style={{ marginBottom: 36 }}>
            <SectionHead>This week</SectionHead>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {payload.thisWeekInsights.rows.slice(0, 3).map((r) => (
                <li
                  key={r.id}
                  data-testid={`briefing-insight-${r.kind}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 12,
                    fontSize: 14,
                    color: 'var(--ink-soft)',
                    padding: '8px 0',
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {r.sentences[0] ?? '(insight ready — open Settings → Insights)'}
                  </span>
                  <button
                    type="button"
                    data-testid={`briefing-insight-dismiss-${r.kind}`}
                    data-aria-press
                    onClick={() => void dismissBriefingInsight(payload.date, r.kind)}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--rule)',
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      color: 'var(--gray-soft)',
                      fontFamily: 'var(--f-mono)',
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      transition: `color 180ms ease, border-color 180ms ease, transform 140ms ${EASE_OUT}`,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = 'var(--ink)';
                      e.currentTarget.style.borderColor = 'var(--rule-strong)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = 'var(--gray-soft)';
                      e.currentTarget.style.borderColor = 'var(--rule)';
                    }}
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

      {/* Phase 21 — WhatsApp digest section (D-08/D-10) */}
      {payload.whatsApp?.state === 'unavailable' && (
        <section data-testid="briefing-whatsapp-unavailable" style={{ marginBottom: 28 }}>
          <SectionHead>WhatsApp</SectionHead>
          <p style={{ fontSize: 13.5, color: 'var(--gray)', fontStyle: 'italic', margin: 0 }}>
            Digest unavailable — the local model was offline this morning. Aria will retry tonight.
          </p>
          <DigestGenerateNowAffordance connection={payload.whatsApp.connection} />
        </section>
      )}

      {payload.whatsApp?.state === 'ready' && payload.whatsApp.groups.length > 0 && (
        <section data-testid="briefing-whatsapp" style={{ marginBottom: 36 }}>
          <SectionHead>WhatsApp</SectionHead>
          {payload.whatsApp.groups.map((g) => {
            if (g.state === 'no-activity') return null;
            if (g.state === 'failed') {
              return (
                <div key={g.jid} style={{ marginBottom: 12 }}>
                  <strong
                    style={{
                      fontSize: 13,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {g.displayName}
                  </strong>
                  <p
                    style={{
                      fontSize: 13,
                      color: 'var(--gray)',
                      fontStyle: 'italic',
                      margin: '4px 0 0',
                    }}
                  >
                    Digest unavailable for this group.
                  </p>
                </div>
              );
            }
            // state === 'summarized'
            const sections = parseDigestSections(g.summaryText ?? '');
            return (
              <div key={g.jid} style={{ marginBottom: 16 }}>
                <strong
                  style={{
                    fontSize: 13,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                  }}
                >
                  {g.displayName}
                </strong>
                {sections.keyPoints && (
                  <p style={{ fontSize: 13, margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>
                    {sections.keyPoints}
                  </p>
                )}
                {sections.decisions && (
                  <p
                    style={{
                      fontSize: 13,
                      margin: '4px 0 0',
                      color: 'var(--text-muted)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <em>Decisions:</em> {sections.decisions}
                  </p>
                )}
                {sections.openQuestions && (
                  <p
                    style={{
                      fontSize: 13,
                      margin: '4px 0 0',
                      color: 'var(--text-muted)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <em>Open:</em> {sections.openQuestions}
                  </p>
                )}
                {sections.mentions && (
                  <p
                    style={{
                      fontSize: 13,
                      margin: '4px 0 0',
                      color: 'var(--text-muted)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <em>Mentions:</em> {sections.mentions}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      <SectionWithChips cascade={5} sectionKey="calendar" date={payload.date}>
        <SectionCalendar items={payload.calendar} error={payload.errors?.calendar} />
      </SectionWithChips>
      <SectionWithChips cascade={6} sectionKey="email" date={payload.date}>
        <SectionEmail
          items={payload.email}
          error={payload.errors?.email}
          emailEmptyStateReason={payload.emailEmptyStateReason}
        />
      </SectionWithChips>
      <SectionWithChips cascade={6} sectionKey="news" date={payload.date}>
        <SectionNews items={payload.news} date={payload.date} error={payload.errors?.news} />
      </SectionWithChips>

      {/* Editorial footer routing line */}
      <footer
        data-aria-cascade="6"
        style={{
          borderTop: '1px solid var(--rule)',
          paddingTop: 16,
          marginTop: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          color: 'var(--gray-soft)',
          fontSize: 11,
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--gold)' }}>❦</span>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}
        >
          Briefing generated 07:00 ·{' '}
          {payload.route === 'FRONTIER'
            ? 'PII redacted · Anthropic claude'
            : 'Local model · llama'}
        </span>
      </footer>
    </section>
  );
}

// ── Masthead row — volume indicator + date + optional right-side controls ─
function MastheadRow({
  volume,
  dateLabel,
  tz,
  rightContent,
  cascadeIndex,
}: {
  volume: string;
  dateLabel: string;
  tz: string;
  rightContent: React.ReactNode;
  cascadeIndex: number;
}): JSX.Element {
  return (
    <div
      data-aria-cascade={cascadeIndex}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        paddingBottom: 12,
        marginBottom: 32,
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.25em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
            whiteSpace: 'nowrap',
          }}
        >
          The Morning · {volume}
        </span>
        <span
          aria-hidden="true"
          style={{
            width: 4,
            height: 4,
            borderRadius: 50,
            background: 'var(--gray-faint)',
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--gray)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {dateLabel} · {tz}
        </span>
      </div>
      {rightContent}
    </div>
  );
}

function SectionHead({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2
      style={{
        fontFamily: 'var(--f-display)',
        fontSize: 'clamp(1.5rem, 2.5vw, 1.75rem)',
        fontWeight: 500,
        letterSpacing: '-0.01em',
        margin: '0 0 6px 0',
      }}
    >
      {children}
    </h2>
  );
}

function ItalicLede({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontFamily: 'var(--f-display)',
        fontStyle: 'italic',
        color: 'var(--gray)',
        fontSize: 14,
        marginBottom: 18,
      }}
    >
      {children}
    </div>
  );
}

/**
 * SectionWithChips — wraps a briefing section so the per-section vote chips
 * (BriefingFeedbackChips) float at the top-right, aligned with the section h2.
 * Achieves the design-ref layout without refactoring each Section component's
 * internal header.
 */
function SectionWithChips({
  cascade,
  sectionKey,
  date,
  children,
}: {
  cascade: number;
  sectionKey: string;
  date: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div
      data-aria-cascade={cascade}
      style={{ position: 'relative', marginBottom: 48 }}
    >
      {children}
      <div
        style={{
          position: 'absolute',
          top: 6,
          right: 0,
        }}
      >
        <BriefingFeedbackChips briefingDate={date} sectionKey={sectionKey} />
      </div>
    </div>
  );
}

function Why({ text }: { text: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
        color: 'var(--gray)',
        fontSize: 13.5,
        lineHeight: 1.55,
        marginTop: 2,
      }}
    >
      <span
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 9,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          flexShrink: 0,
        }}
      >
        Why
      </span>
      <span style={{ fontStyle: 'italic' }}>{text}</span>
    </div>
  );
}

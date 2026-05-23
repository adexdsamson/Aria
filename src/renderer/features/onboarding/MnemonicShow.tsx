/**
 * Onboarding step 1 — display the 12-word mnemonic in a 4×3 grid, gated by an
 * "I've written these down" checkbox. Once the user clicks Continue, the
 * renderer drops its local copy of the words (the main process keeps
 * `pendingMnemonic` until seal). Phase 9 Plan 05: editorial re-skin.
 */
import { useState } from 'react';
import { AppLogo, Button, Card, Checkbox } from '../../components/editorial';

export interface MnemonicShowProps {
  words: string[];
  onContinue: () => void;
}

export function MnemonicShow({ words, onContinue }: MnemonicShowProps): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <section
      data-testid="onboarding-show"
      style={{
        padding: 32,
        maxWidth: 720,
        margin: '0 auto',
        color: 'var(--ink)',
        fontFamily: 'var(--f-body)',
        background: 'var(--paper)',
      }}
    >
      <div style={{ marginBottom: 18 }}>
        <AppLogo variant="header" />
      </div>
      <div
        style={{
          fontFamily: 'var(--f-mono)',
          fontSize: 10,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          marginBottom: 6,
        }}
      >
        Step 1 of 4 · recovery phrase
      </div>
      <h1
        style={{
          fontFamily: 'var(--f-display)',
          fontSize: 32,
          fontWeight: 500,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
          marginTop: 0,
          marginBottom: 14,
        }}
      >
        Your recovery phrase
      </h1>
      <p style={{ color: 'var(--ink-soft)', fontSize: 15, lineHeight: 1.55, marginTop: 0 }}>
        Write these 12 words down on paper and keep them somewhere safe. This is
        the ONLY way to recover your Aria data if you lose your daily password
        or move to a new machine.
      </p>
      <ol
        data-testid="mnemonic-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          padding: 0,
          margin: '12px 0',
          listStyle: 'none',
        }}
      >
        {words.map((w, i) => (
          <li
            key={i}
            data-testid={`mnemonic-word-${i}`}
            style={{
              padding: '10px 12px',
              background: 'var(--ivory-deep)',
              border: '1px solid var(--rule)',
              borderRadius: 'var(--radius)',
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--f-mono)',
                fontSize: 10,
                color: 'var(--gray)',
                letterSpacing: '0.1em',
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </span>
            <span
              style={{
                fontFamily: 'var(--f-display)',
                fontSize: 16,
                color: 'var(--ink)',
              }}
            >
              {w}
            </span>
          </li>
        ))}
      </ol>
      <Card style={{ marginTop: 12, padding: 14, borderTop: '2px solid var(--rose)' }}>
        <div
          style={{
            fontFamily: 'var(--f-mono)',
            fontSize: 10,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--rose)',
            marginBottom: 4,
          }}
        >
          Important
        </div>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ink)' }}>
          Aria cannot recover this phrase for you. Write it down — don&apos;t screenshot.
        </p>
      </Card>
      <div style={{ marginTop: 8 }}>
        <Checkbox
          data-testid="mnemonic-ack"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          label="I've written these words down somewhere safe."
        />
      </div>
      <div style={{ marginTop: 16 }}>
        <Button
          variant="primary"
          data-testid="mnemonic-continue"
          disabled={!acknowledged}
          onClick={onContinue}
        >
          Continue
        </Button>
      </div>
    </section>
  );
}

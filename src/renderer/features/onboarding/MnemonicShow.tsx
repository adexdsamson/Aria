/**
 * Onboarding step 1 — display the 12-word mnemonic in a 4×3 grid, gated by an
 * "I've written these down" checkbox. Once the user clicks Continue, the
 * renderer drops its local copy of the words (the main process keeps
 * `pendingMnemonic` until seal).
 */
import { useState } from 'react';

export interface MnemonicShowProps {
  words: string[];
  onContinue: () => void;
}

export function MnemonicShow({ words, onContinue }: MnemonicShowProps): JSX.Element {
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <section data-testid="onboarding-show" style={{ padding: 24, maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Your recovery phrase</h1>
      <p>
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
          listStylePosition: 'inside',
          fontFamily: 'monospace',
          fontSize: 16,
        }}
      >
        {words.map((w, i) => (
          <li key={i} data-testid={`mnemonic-word-${i}`} style={{ padding: 6 }}>
            <strong>{i + 1}.</strong> {w}
          </li>
        ))}
      </ol>
      <label style={{ display: 'block', marginTop: 16 }}>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          data-testid="mnemonic-ack"
        />{' '}
        I've written these words down somewhere safe.
      </label>
      <button
        data-testid="mnemonic-continue"
        disabled={!acknowledged}
        onClick={onContinue}
        style={{ marginTop: 16, padding: '8px 16px' }}
      >
        Continue
      </button>
    </section>
  );
}

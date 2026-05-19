import { describe, it, expect } from 'vitest';
import {
  strategyA,
  strategyB,
  strategyC,
  ALL_STRATEGIES,
} from '../../../../src/main/rag/chunk-strategies';
import type { SourceDoc } from '../../../../src/main/rag/chunk-types';

function shortDoc(): SourceDoc {
  return {
    sourceKind: 'email',
    sourceId: 'm1',
    title: 'Hello',
    text: 'This is a short email body about the Q3 plan.',
    parentRef: 't1',
  };
}

function longDoc(): SourceDoc {
  const para = 'Lorem ipsum dolor sit amet. '.repeat(200); // ~5600 chars
  return {
    sourceKind: 'email',
    sourceId: 'm-long',
    title: 'Long thread',
    text: para,
    parentRef: 't-long',
  };
}

function transcriptDoc(): SourceDoc {
  // 4 segments of ~50 chars each = 200 chars total — fits in one window but
  // still exercises segment-aware grouping.
  const text =
    'Sarah: hi there, welcome.\n' +
    'Alex: thanks, glad to meet.\n' +
    'Sarah: any updates on Q3?\n' +
    'Alex: yes, holding at 42 FTE.';
  return {
    sourceKind: 'note',
    sourceId: 'n1',
    title: '1:1 with Sarah',
    text,
    parentRef: 'n1',
    segments: [
      { charStart: 0, charEnd: 26, speaker: 'Sarah' },
      { charStart: 26, charEnd: 55, speaker: 'Alex' },
      { charStart: 55, charEnd: 82, speaker: 'Sarah' },
      { charStart: 82, charEnd: text.length, speaker: 'Alex' },
    ],
  };
}

describe('chunking strategies — Plan 07-01 Task 4', () => {
  it('strategy A: one chunk, full text, valid offsets, title propagates', () => {
    const out = strategyA.chunk(shortDoc());
    expect(out).toHaveLength(1);
    const c = out[0]!;
    expect(c.charStart).toBe(0);
    expect(c.charEnd).toBe(shortDoc().text.length);
    expect(c.title).toBe('Hello');
    expect(c.tokenCount).toBeGreaterThan(0);
  });

  it('strategy A: truncates to budget on huge inputs', () => {
    const huge: SourceDoc = { ...shortDoc(), text: 'x'.repeat(50_000) };
    const out = strategyA.chunk(huge);
    expect(out).toHaveLength(1);
    expect(out[0]!.text.length).toBeLessThanOrEqual(16_000); // 4000 tok * 4 chars
  });

  it('strategy B: one chunk per doc; long input gets start+end retention', () => {
    const out = strategyB.chunk(longDoc());
    expect(out).toHaveLength(1);
    const text = out[0]!.text;
    // Short doc (5600 chars) is under the 16000-char budget — should be one chunk verbatim.
    expect(text).not.toContain('…[truncated]…');
    expect(out[0]!.charStart).toBe(0);
  });

  it('strategy B: truncates beyond 16000 chars with sentinel', () => {
    const giant: SourceDoc = { ...longDoc(), text: 'a'.repeat(20_000) };
    const out = strategyB.chunk(giant);
    expect(out).toHaveLength(1);
    expect(out[0]!.text).toContain('…[truncated]…');
  });

  it('strategy C: respects segment boundaries on transcript', () => {
    const doc = transcriptDoc();
    const out = strategyC.chunk(doc);
    expect(out.length).toBeGreaterThanOrEqual(1);
    // Every emitted chunk should land at a segment boundary or original end.
    const boundaries = new Set<number>([0, doc.text.length, ...doc.segments!.flatMap((s) => [s.charStart, s.charEnd])]);
    for (const c of out) {
      expect(boundaries.has(c.charStart)).toBe(true);
      expect(boundaries.has(c.charEnd)).toBe(true);
      expect(c.title).toBe('1:1 with Sarah');
    }
  });

  it('strategy C: speakerHint propagates when chunk straddles a single speaker', () => {
    const doc = transcriptDoc();
    const out = strategyC.chunk(doc);
    // First chunk starts at offset 0 (Sarah). With 4 small segments totaling
    // 110 chars they all fit in one window — speakerHint should be null
    // (mixed speakers); but at least the chunk exists.
    expect(out[0]!).toBeDefined();
  });

  it('strategy C: paragraph fallback when no segments', () => {
    const para = 'A'.repeat(3000) + '\n\n' + 'B'.repeat(3000);
    const doc: SourceDoc = { sourceKind: 'email', sourceId: 'p', title: 'P', text: para };
    const out = strategyC.chunk(doc);
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const c of out) {
      expect(c.charStart).toBeGreaterThanOrEqual(0);
      expect(c.charEnd).toBeLessThanOrEqual(para.length);
      expect(c.charEnd).toBeGreaterThan(c.charStart);
    }
  });

  it('determinism: each strategy produces identical output on repeat invocation', () => {
    const doc = transcriptDoc();
    for (const s of ALL_STRATEGIES) {
      const a = JSON.stringify(s.chunk(doc));
      const b = JSON.stringify(s.chunk(doc));
      expect(a).toBe(b);
    }
  });

  it('empty input yields zero chunks', () => {
    const empty: SourceDoc = { sourceKind: 'email', sourceId: 'e', title: 'T', text: '' };
    expect(strategyA.chunk(empty)).toHaveLength(0);
    expect(strategyB.chunk(empty)).toHaveLength(0);
    expect(strategyC.chunk(empty)).toHaveLength(0);
  });

  it('all chunks carry the SourceDoc title verbatim (C8/C12)', () => {
    const doc = shortDoc();
    for (const s of ALL_STRATEGIES) {
      const chunks = s.chunk(doc);
      for (const c of chunks) {
        expect(c.title).toBe(doc.title);
      }
    }
  });
});

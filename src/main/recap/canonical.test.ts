/**
 * Plan 08-02 Task 2 — canonical mapper tests.
 */
import { describe, it, expect } from 'vitest';
import {
  tiptapJsonToSectionBlocks,
  sectionBlocksToTiptapJson,
  validateRecapCanonical,
} from './canonical';
import { RecapCanonicalSchema } from './schema';

const sampleSectionTipTap = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Meetings held' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Five meetings this week.' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Q3 sync' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hiring panel' }] }] },
      ],
    },
  ],
};

const validRecap = {
  isoWeek: '2026-W20',
  weekStartYmd: '2026-05-11',
  meetings: { heading: 'Meetings held', blocks: [{ kind: 'paragraph' as const, text: 'five' }] },
  actions: { heading: 'Actions', blocks: [] },
  wins: { heading: 'Wins', blocks: [] },
  upcoming: { heading: "What's coming", blocks: [] },
  whatAriaDid: {
    heading: 'What Aria did',
    narrative: 'Sent 3 drafts, scheduled 2 meetings.',
    auditRowRefs: ['email_send:1', 'calendar_change:2'],
    blocks: [],
  },
};

describe('RecapCanonicalSchema', () => {
  it('Test 1: validates a 5-section recap', () => {
    expect(() => validateRecapCanonical(validRecap)).not.toThrow();
  });

  it('Test 4: rejects extra top-level sections (closed shape)', () => {
    const bad = { ...validRecap, extraSection: { heading: 'x', blocks: [] } };
    expect(() => validateRecapCanonical(bad)).toThrow();
  });

  it('Test 5: whatAriaDid requires auditRowRefs + narrative', () => {
    const parse = RecapCanonicalSchema.safeParse({ ...validRecap, whatAriaDid: { heading: 'h', blocks: [] } });
    expect(parse.success).toBe(false);
  });
});

describe('TipTap ↔ canonical mappers', () => {
  it('Test 2: tiptapJsonToSectionBlocks extracts heading/paragraph/bullet list', () => {
    const r = tiptapJsonToSectionBlocks(sampleSectionTipTap);
    expect(r.heading).toBe('Meetings held');
    expect(r.blocks).toHaveLength(2);
    expect(r.blocks[0]).toEqual({ kind: 'paragraph', text: 'Five meetings this week.' });
    expect(r.blocks[1]).toEqual({ kind: 'bullet_list', items: ['Q3 sync', 'Hiring panel'] });
  });

  it('Test 3: round-trip canonical → tiptap → canonical preserves shape', () => {
    const section = tiptapJsonToSectionBlocks(sampleSectionTipTap);
    const tt = sectionBlocksToTiptapJson(section);
    const back = tiptapJsonToSectionBlocks(tt);
    expect(back).toEqual(section);
  });

  it('numbered_list round-trip', () => {
    const section = {
      heading: 'Steps',
      blocks: [{ kind: 'numbered_list' as const, items: ['one', 'two'] }],
    };
    const tt = sectionBlocksToTiptapJson(section);
    const back = tiptapJsonToSectionBlocks(tt);
    expect(back.blocks).toEqual([{ kind: 'numbered_list', items: ['one', 'two'] }]);
  });
});

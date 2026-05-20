/**
 * Plan 08-02 Task 2 — RecapCanonical ↔ TipTap JSON mappers.
 *
 * TipTap (ProseMirror) JSON shape (StarterKit only):
 *   { type: 'doc', content: [ { type: 'heading', attrs: { level }, content: [{ type: 'text', text }]},
 *                              { type: 'paragraph', content: [{ type: 'text', text }] },
 *                              { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }]}]}]},
 *                              { type: 'orderedList', content: [...] } ] }
 *
 * Per-section editor instances → the mappers operate on a single section at a
 * time (`tiptapJsonToSectionBlocks` / `sectionBlocksToTiptapJson`). The full
 * canonical doc is assembled by the orchestrator.
 */
import {
  RecapCanonicalSchema,
  type RecapCanonical,
  type Block,
} from './schema';

interface TipTapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
}

/** Convert a single ProseMirror doc into a `{ heading, blocks }` payload. */
export function tiptapJsonToSectionBlocks(json: unknown): { heading: string; blocks: Block[] } {
  let heading = '';
  const blocks: Block[] = [];
  if (!isNode(json)) return { heading, blocks };
  const top = (json.content ?? []) as TipTapNode[];
  for (const node of top) {
    if (node.type === 'heading') {
      heading = textOf(node);
    } else if (node.type === 'paragraph') {
      const text = textOf(node);
      if (text.length > 0) blocks.push({ kind: 'paragraph', text });
    } else if (node.type === 'bulletList') {
      const items = listItemsOf(node);
      blocks.push({ kind: 'bullet_list', items });
    } else if (node.type === 'orderedList') {
      const items = listItemsOf(node);
      blocks.push({ kind: 'numbered_list', items });
    }
  }
  return { heading, blocks };
}

/** Convert `{ heading, blocks }` back into a ProseMirror doc. */
export function sectionBlocksToTiptapJson(section: { heading: string; blocks: Block[] }): TipTapNode {
  const content: TipTapNode[] = [];
  if (section.heading) {
    content.push({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: section.heading }],
    });
  }
  for (const b of section.blocks) {
    if (b.kind === 'paragraph') {
      content.push({
        type: 'paragraph',
        content: b.text ? [{ type: 'text', text: b.text }] : [],
      });
    } else if (b.kind === 'bullet_list') {
      content.push({
        type: 'bulletList',
        content: b.items.map((item) => ({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: item }] },
          ],
        })),
      });
    } else if (b.kind === 'numbered_list') {
      content.push({
        type: 'orderedList',
        content: b.items.map((item) => ({
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: item }] },
          ],
        })),
      });
    }
  }
  return { type: 'doc', content };
}

/** Validate canonical recap shape. Throws on invalid. */
export function validateRecapCanonical(raw: unknown): RecapCanonical {
  return RecapCanonicalSchema.parse(raw);
}

// ── helpers ────────────────────────────────────────────────────────────────

function isNode(x: unknown): x is TipTapNode {
  return !!x && typeof x === 'object' && typeof (x as TipTapNode).type === 'string';
}

function textOf(node: TipTapNode): string {
  if (!node.content) return node.text ?? '';
  return node.content.map(textOf).join('');
}

function listItemsOf(listNode: TipTapNode): string[] {
  const items: string[] = [];
  for (const li of listNode.content ?? []) {
    if (li.type !== 'listItem') continue;
    items.push(textOf(li).trim());
  }
  return items;
}

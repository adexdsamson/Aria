/**
 * Plan 08-03 Task 3 — recap signal source (SAME-TRANSACTION).
 *
 * 08-02 Task 3 finalizeRecap writes `weekly_recap_section_edit` rows. This
 * source emits one learning_signal per non-trivial section edit, categorized
 * by a tiny heuristic into one of tone/length/factual/structure.
 *
 * Since recap finalize does not touch any external API, the legitimate
 * same-transaction pattern applies: wrap the section_edit INSERT (already
 * done by 08-02's `finalizeRecap`) AND the signal INSERT in one db.transaction.
 * In practice, callers invoke `writeRecapSignals` AFTER finalizeRecap returns
 * but inside a single outer transaction to honor the contract.
 *
 * Open issue: 08-02 currently writes section_edit rows with category=null.
 * This source's `categorizeSectionEdit` heuristic IS the categorization
 * pipeline 08-02 deferred (its Schema deviation #5). For the briefing-payload
 * `topEditCategories` consumer (08-01's deferred column), we expose
 * `topEditCategoriesFromSignals` reading the last 30d of signals.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { writeSignal } from '../signal-log';

type Db = Database.Database;

export type SectionEditCategory = 'tone' | 'length' | 'factual' | 'structure';

export interface RecapSectionEditInput {
  sectionKey: string;
  beforeText: string;
  afterText: string;
}

/**
 * Categorize a section edit. Pure / no LLM — operates only on length deltas
 * and structural shape (newline counts, list markers). The aggregator is the
 * single consumer of these categories; precision is more valuable than
 * recall.
 */
export function categorizeSectionEdit(input: RecapSectionEditInput): SectionEditCategory {
  const { beforeText, afterText } = input;
  if (beforeText === afterText) return 'tone';

  const beforeLines = beforeText.split(/\n/).length;
  const afterLines = afterText.split(/\n/).length;
  const beforeBullets = (beforeText.match(/^[\-\*•]\s/gm) ?? []).length;
  const afterBullets = (afterText.match(/^[\-\*•]\s/gm) ?? []).length;

  // Structure: line / bullet topology changed meaningfully.
  if (Math.abs(beforeLines - afterLines) >= 2) return 'structure';
  if (Math.abs(beforeBullets - afterBullets) >= 2) return 'structure';

  // Length: ≥30% delta in characters.
  const db = beforeText.length;
  const da = afterText.length;
  if (db > 0 && Math.abs(da - db) / db >= 0.3) return 'length';

  // Factual: digits / dates / @-mentions / URL hosts differ.
  if (extractFactualTokens(beforeText) !== extractFactualTokens(afterText)) {
    return 'factual';
  }

  return 'tone';
}

function extractFactualTokens(s: string): string {
  // Crude: numbers + capitalized multi-letter runs (proper nouns) joined.
  const nums = s.match(/\d+/g) ?? [];
  const caps = s.match(/\b[A-Z][a-z]+\b/g) ?? [];
  return [...nums, ...caps].sort().join('|');
}

export interface WriteRecapSignalsArgs {
  isoWeek: string;
  recapId: number;
  edits: RecapSectionEditInput[];
  now?: Date;
}

/**
 * Emit one signal per non-trivial edit. Returns the number of signals written.
 * Should be invoked inside the same outer transaction as finalizeRecap; this
 * function does NOT open its own transaction so callers control the boundary.
 *
 * Returned category is also annotated on the signal payload for the aggregator.
 */
export function writeRecapSignals(db: Db, args: WriteRecapSignalsArgs): number {
  let count = 0;
  for (const e of args.edits) {
    if (e.beforeText === e.afterText) continue;
    const category = categorizeSectionEdit(e);
    writeSignal(db, {
      source: 'recap',
      kind: 'recap.section_edit',
      payload: {
        isoWeek: args.isoWeek,
        recapId: args.recapId,
        sectionKey: e.sectionKey,
        category,
        lenBefore: e.beforeText.length,
        lenAfter: e.afterText.length,
      },
      now: args.now,
    });
    count++;
  }
  return count;
}

/**
 * Helper for 08-01 BriefingPayload.topEditCategories. Reads approval-edit +
 * recap-edit signal rows in the last `windowDays` and returns the top-N
 * category labels.
 */
export function topEditCategoriesFromSignals(
  db: Db,
  opts: { windowDays?: number; topN?: number; now?: Date } = {},
): string[] {
  const windowDays = opts.windowDays ?? 30;
  const topN = opts.topN ?? 3;
  const cutoff = new Date(
    (opts.now ?? new Date()).getTime() - windowDays * 86_400_000,
  ).toISOString();
  const rows = db
    .prepare(
      `SELECT payload_json FROM learning_signals
        WHERE source IN ('approval','recap')
          AND kind IN ('approval.edit','recap.section_edit')
          AND occurred_at >= ?`,
    )
    .all(cutoff) as Array<{ payload_json: string }>;
  const counts = new Map<string, number>();
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload_json) as { category?: string; editCategory?: string };
      const cat = p.category ?? p.editCategory;
      if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
    } catch {
      /* skip malformed */
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([cat]) => cat);
}

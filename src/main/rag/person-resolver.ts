/**
 * Plan 07-03 Task 2 — Person mention resolver with local-LLM fallback (RAG-04).
 *
 * Detects candidate mention spans in a question, resolves each against the
 * `person_alias` table (built by plan 07-02), and:
 *   - single confident match → rewrite mention to canonical Person ID
 *   - multiple matches → call LOCAL LLM (never frontier) with candidates +
 *     thread context to pick one; else return `ambiguous`
 *   - no match → pass-through
 *
 * REVIEWS C10 freshness: reads `app_meta.last_people_directory_rebuild_at`
 * and sets `directoryStale=true` when >24h old. Caller threads this into the
 * answer-service routing payload so the UI can render a hint.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Person } from './people-directory';

type Db = Database.Database;

export interface ThreadTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface LocalLlmDisambiguator {
  /**
   * Picks the best candidate for an ambiguous mention. Returns:
   *   - { personId } when the model is confident
   *   - { ambiguous: true } when the model can't decide
   * NEVER throws; on error → ambiguous.
   */
  pick(args: {
    mention: string;
    candidates: Person[];
    threadHistory: ThreadTurn[];
    recentContextByCandidate: Record<string, string>;
  }): Promise<{ personId: string } | { ambiguous: true }>;
}

export interface ResolverDeps {
  db: Db;
  localLlm?: LocalLlmDisambiguator;
}

export interface ResolveOpts {
  threadHistory?: ThreadTurn[];
}

export type ResolveOutcome =
  | {
      kind: 'resolved';
      rewritten: string;
      resolved: Person[];
      directoryStale: boolean;
    }
  | {
      kind: 'ambiguous';
      mention: string;
      candidates: Person[];
      directoryStale: boolean;
    };

// Capitalized word OR @handle OR quoted span.
const MENTION_REGEX = /@([A-Za-z][A-Za-z0-9._-]+)|"([^"]+)"|\b([A-Z][a-zA-Z]{1,30})\b/g;

const STOPWORDS = new Set([
  'I',
  'The',
  'A',
  'An',
  'It',
  'This',
  'That',
  'These',
  'Those',
  'When',
  'Where',
  'What',
  'Who',
  'Why',
  'How',
  'Did',
  'Do',
  'Does',
  'Is',
  'Are',
  'Was',
  'Were',
  'Will',
  'Would',
  'Should',
  'Could',
  'Can',
  'May',
  'Might',
  'Aria',
  'Gmail',
  'Calendar',
  'Outlook',
  'Microsoft',
  'Google',
  'Q1',
  'Q2',
  'Q3',
  'Q4',
]);

interface MentionSpan {
  raw: string;
  start: number;
  end: number;
}

export function extractMentionSpans(question: string): MentionSpan[] {
  const out: MentionSpan[] = [];
  MENTION_REGEX.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MENTION_REGEX.exec(question)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    if (!raw) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push({ raw, start: m.index, end: m.index + m[0].length });
  }
  MENTION_REGEX.lastIndex = 0;
  return out;
}

function lookupAliases(db: Db, alias: string): Person[] {
  return (db
    .prepare(
      `SELECT p.id, p.canonical_email, p.display_name, p.observed_count, p.last_seen_at
         FROM person_alias a
         JOIN person p ON p.id = a.person_id
        WHERE a.alias = ? COLLATE NOCASE
        ORDER BY p.last_seen_at DESC, p.observed_count DESC
        LIMIT 5`,
    )
    .all(alias) as Array<{
    id: string;
    canonical_email: string | null;
    display_name: string;
    observed_count: number;
    last_seen_at: string;
  }>).map((r) => ({
    id: r.id,
    canonicalEmail: r.canonical_email,
    displayName: r.display_name,
    observedCount: r.observed_count,
    lastSeenAt: r.last_seen_at,
  }));
}

function isDirectoryStale(db: Db): boolean {
  try {
    const row = db
      .prepare(`SELECT v FROM app_meta WHERE k = 'last_people_directory_rebuild_at'`)
      .get() as { v: string } | undefined;
    if (!row) return true;
    const last = new Date(row.v).getTime();
    return Date.now() - last > 24 * 3600 * 1000;
  } catch {
    return true;
  }
}

function recentContextFor(db: Db, person: Person, limit = 3): string {
  // Pull a handful of recent rag_chunk titles that reference this person's
  // canonical email or name to give the LLM something to disambiguate on.
  const email = person.canonicalEmail;
  const name = person.displayName;
  const rows = (() => {
    try {
      return db
        .prepare(
          `SELECT title FROM rag_chunk
            WHERE deleted_at IS NULL
              AND (title LIKE ? OR text LIKE ?)
            ORDER BY updated_at DESC
            LIMIT ?`,
        )
        .all(`%${name}%`, email ? `%${email}%` : `%${name}%`, limit) as Array<{ title: string }>;
    } catch {
      return [];
    }
  })();
  return rows.map((r) => r.title).join(' • ');
}

export async function resolvePersonMentions(
  deps: ResolverDeps,
  question: string,
  opts: ResolveOpts = {},
): Promise<ResolveOutcome> {
  const { db, localLlm } = deps;
  const directoryStale = isDirectoryStale(db);
  const spans = extractMentionSpans(question);
  if (spans.length === 0) {
    return { kind: 'resolved', rewritten: question, resolved: [], directoryStale };
  }

  let rewritten = question;
  const resolved: Person[] = [];

  // Process in reverse so character offsets stay valid as we rewrite.
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  for (const span of ordered) {
    const matches = lookupAliases(db, span.raw);
    if (matches.length === 0) continue;
    if (matches.length === 1) {
      resolved.push(matches[0]!);
      rewritten =
        rewritten.slice(0, span.start) + matches[0]!.id + rewritten.slice(span.end);
      continue;
    }
    // Ambiguous: try local LLM.
    if (localLlm) {
      const recentContextByCandidate: Record<string, string> = {};
      for (const cand of matches) {
        recentContextByCandidate[cand.id] = recentContextFor(db, cand);
      }
      try {
        const pick = await localLlm.pick({
          mention: span.raw,
          candidates: matches,
          threadHistory: opts.threadHistory ?? [],
          recentContextByCandidate,
        });
        if ('personId' in pick) {
          const found = matches.find((m) => m.id === pick.personId);
          if (found) {
            resolved.push(found);
            rewritten =
              rewritten.slice(0, span.start) + found.id + rewritten.slice(span.end);
            continue;
          }
        }
      } catch {
        /* fall through to ambiguous */
      }
    }
    return {
      kind: 'ambiguous',
      mention: span.raw,
      candidates: matches,
      directoryStale,
    };
  }

  return { kind: 'resolved', rewritten, resolved, directoryStale };
}

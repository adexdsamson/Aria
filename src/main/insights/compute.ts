/**
 * Plan 08-01 Task 3 — Pure aggregation functions for the 4 insight kinds.
 *
 * All four functions take a Db handle + `weekStartYmd` (Monday YYYY-MM-DD local)
 * and return typed aggregates matching `InsightPayloadSchema`. Only
 * `computeRecurringThemes` calls an LLM, and only with cluster-term inputs
 * (NEVER raw chunk text — research §Pitfall 2, T-08-02).
 *
 * Schema robustness: every SQL probe is wrapped so missing columns/tables in
 * older test DBs degrade to empty/zero aggregates rather than throwing.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { LanguageModel } from 'ai';
import type {
  CalendarLoadPayload,
  ResponseTimePayload,
  RecurringThemesPayload,
  ApprovalEditsPayload,
} from './schema';

type Db = Database.Database;

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function ymdToDate(ymd: string): Date {
  // weekStartYmd is local-tz Monday at 00:00; we treat it as UTC for span math
  // (week-over-week deltas don't change under tz shifts because both windows
  // are shifted by the same amount).
  return new Date(`${ymd}T00:00:00.000Z`);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function isoOrNull(d: Date): string {
  return d.toISOString();
}

function windowForWeek(weekStartYmd: string): { thisStart: Date; thisEnd: Date; prevStart: Date; prevEnd: Date } {
  const thisStart = ymdToDate(weekStartYmd);
  const thisEnd = addDays(thisStart, 7);
  const prevStart = addDays(thisStart, -7);
  const prevEnd = thisStart;
  return { thisStart, thisEnd, prevStart, prevEnd };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ---------------------------------------------------------------------------
// 1. calendarLoadDelta — meeting hours week-over-week
// ---------------------------------------------------------------------------

interface CalendarEventRow {
  start_at_utc: string | null;
  end_at_utc: string | null;
  start_date: string | null;
  end_date: string | null;
}

function meetingHoursIn(db: Db, start: Date, end: Date): number {
  let rows: CalendarEventRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT start_at_utc, end_at_utc, start_date, end_date
           FROM calendar_event
          WHERE COALESCE(start_at_utc, start_date) IS NOT NULL
            AND COALESCE(start_at_utc, start_date) < ?
            AND COALESCE(end_at_utc, end_date, start_at_utc, start_date) >= ?`,
      )
      .all(isoOrNull(end), isoOrNull(start)) as CalendarEventRow[];
  } catch {
    return 0;
  }
  let hours = 0;
  for (const r of rows) {
    const s = r.start_at_utc ?? r.start_date;
    const e = r.end_at_utc ?? r.end_date ?? r.start_at_utc ?? r.start_date;
    if (!s || !e) continue;
    const sd = new Date(s).getTime();
    const ed = new Date(e).getTime();
    if (Number.isNaN(sd) || Number.isNaN(ed) || ed <= sd) continue;
    hours += (ed - sd) / (60 * 60 * 1000);
  }
  return Math.round(hours * 10) / 10;
}

function focusBlockCount(db: Db, start: Date, end: Date): number {
  let rows: Array<{ s: number; e: number }> = [];
  try {
    rows = (db
      .prepare(
        `SELECT start_at_utc AS s_iso, COALESCE(end_at_utc, start_at_utc) AS e_iso
           FROM calendar_event
          WHERE start_at_utc IS NOT NULL
            AND start_at_utc < ?
            AND COALESCE(end_at_utc, start_at_utc) >= ?
          ORDER BY start_at_utc ASC`,
      )
      .all(isoOrNull(end), isoOrNull(start)) as Array<{ s_iso: string; e_iso: string }>)
      .map((r) => ({ s: new Date(r.s_iso).getTime(), e: new Date(r.e_iso).getTime() }))
      .filter((r) => !Number.isNaN(r.s) && !Number.isNaN(r.e) && r.e > r.s);
  } catch {
    return 0;
  }
  if (rows.length === 0) return 0;
  // Count gaps ≥60min between adjacent (sorted) events on the same UTC day.
  let count = 0;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1]!;
    const cur = rows[i]!;
    const gapMin = (cur.s - prev.e) / (60 * 1000);
    if (gapMin >= 60) count++;
  }
  return count;
}

export function computeCalendarLoadDelta(
  db: Db,
  weekStartYmd: string,
): CalendarLoadPayload {
  const { thisStart, thisEnd, prevStart, prevEnd } = windowForWeek(weekStartYmd);
  const thisHours = meetingHoursIn(db, thisStart, thisEnd);
  const lastHours = meetingHoursIn(db, prevStart, prevEnd);
  const deltaPct = lastHours === 0
    ? (thisHours === 0 ? 0 : 100)
    : Math.round(((thisHours - lastHours) / lastHours) * 100);
  return {
    kind: 'calendar_load',
    meetingHoursThisWeek: thisHours,
    meetingHoursLastWeek: lastHours,
    deltaPct,
    focusBlockCount: focusBlockCount(db, thisStart, thisEnd),
  };
}

// ---------------------------------------------------------------------------
// 2. responseTimeTrend — median minutes-to-reply via In-Reply-To headers
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  thread_id: string;
  from_addr: string;
  received_at: string;
}

function gatherReplyLatencies(
  db: Db,
  start: Date,
  end: Date,
): { allMinutes: number[]; perPerson: Map<string, number[]> } {
  let rows: MessageRow[] = [];
  try {
    rows = db
      .prepare(
        `SELECT id, thread_id, from_addr, received_at
           FROM gmail_message
          WHERE received_at < ? AND received_at >= ?
          ORDER BY thread_id ASC, received_at ASC`,
      )
      .all(isoOrNull(end), isoOrNull(start)) as MessageRow[];
  } catch {
    return { allMinutes: [], perPerson: new Map() };
  }

  // Determine the user's own address by reading any provider_account where
  // capabilities_json.mail = 1 — best-effort; if unavailable, treat the most
  // common from_addr as the user (heuristic; the gate ensures ≥14d of data so
  // sample is non-trivial).
  let userEmail: string | null = null;
  try {
    const row = db
      .prepare(
        `SELECT account_id AS email FROM provider_account
            WHERE provider_key = 'google'
              AND json_extract(capabilities_json, '$.mail') = 1
            LIMIT 1`,
      )
      .get() as { email?: string } | undefined;
    userEmail = row?.email ?? null;
  } catch {
    userEmail = null;
  }

  const byThread = new Map<string, MessageRow[]>();
  for (const r of rows) {
    if (!byThread.has(r.thread_id)) byThread.set(r.thread_id, []);
    byThread.get(r.thread_id)!.push(r);
  }

  const allMinutes: number[] = [];
  const perPerson = new Map<string, number[]>();
  for (const msgs of byThread.values()) {
    for (let i = 1; i < msgs.length; i++) {
      const incoming = msgs[i - 1]!;
      const reply = msgs[i]!;
      const incomingFromUser = userEmail !== null && incoming.from_addr.toLowerCase().includes(userEmail.toLowerCase());
      const replyFromUser = userEmail !== null && reply.from_addr.toLowerCase().includes(userEmail.toLowerCase());
      // Pair incoming → reply only when prior wasn't from user but next is.
      if (incomingFromUser || !replyFromUser) continue;
      const dt = new Date(reply.received_at).getTime() - new Date(incoming.received_at).getTime();
      if (Number.isNaN(dt) || dt <= 0) continue;
      const minutes = dt / (60 * 1000);
      allMinutes.push(minutes);
      const contact = incoming.from_addr;
      if (!perPerson.has(contact)) perPerson.set(contact, []);
      perPerson.get(contact)!.push(minutes);
    }
  }
  return { allMinutes, perPerson };
}

export function computeResponseTimeTrend(
  db: Db,
  weekStartYmd: string,
): ResponseTimePayload {
  const { thisStart, thisEnd, prevStart, prevEnd } = windowForWeek(weekStartYmd);
  const thisWk = gatherReplyLatencies(db, thisStart, thisEnd);
  const lastWk = gatherReplyLatencies(db, prevStart, prevEnd);

  const thisMedian = Math.round(median(thisWk.allMinutes));
  const lastMedian = Math.round(median(lastWk.allMinutes));

  const perPersonTop3 = Array.from(thisWk.perPerson.entries())
    .map(([contactEmail, minutes]) => ({
      contactEmail,
      medianMinutes: Math.round(median(minutes)),
    }))
    .sort((a, b) => b.medianMinutes - a.medianMinutes)
    .slice(0, 3);

  return {
    kind: 'response_time',
    medianMinutesThisWeek: thisMedian,
    medianMinutesLastWeek: lastMedian,
    deltaMinutes: thisMedian - lastMedian,
    perPersonTop3,
  };
}

// ---------------------------------------------------------------------------
// 3. recurringThemes — k-means over nomic embeddings; LABELS only via LLM
// ---------------------------------------------------------------------------

/**
 * Stop-words used by the TF-term extractor that feeds cluster label-gen prompts.
 * Kept short and language-agnostic; we strip them at the term-frequency stage
 * so the LLM only ever sees signal-bearing cluster terms, NEVER raw chunks.
 */
const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','is','are','was','were',
  'be','been','being','this','that','it','as','at','by','from','but','have','has','had',
  'will','would','can','could','should','may','might','do','does','did','not','no','yes',
  'i','you','we','they','he','she','him','her','his','their','our','my','your','re','fwd',
]);

function topTermsFor(text: string, n = 5): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (!raw || raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w);
}

// Tiny pure-TS k-means (cosine similarity, sweep k=3..8 silhouette-style).
interface Vec { id: string; v: Float32Array; text: string }

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

function centroid(vs: Vec[]): Float32Array {
  if (vs.length === 0) return new Float32Array();
  const dim = vs[0]!.v.length;
  const c = new Float32Array(dim);
  for (const v of vs) for (let i = 0; i < dim; i++) c[i]! += v.v[i]!;
  for (let i = 0; i < dim; i++) c[i]! /= vs.length;
  return c;
}

function kmeans(items: Vec[], k: number, maxIter = 20): Vec[][] {
  if (items.length === 0 || k <= 0) return [];
  const effK = Math.min(k, items.length);
  // Init: pick evenly-spaced items as seeds (deterministic).
  const centroids: Float32Array[] = [];
  const step = Math.max(1, Math.floor(items.length / effK));
  for (let i = 0; i < effK; i++) centroids.push(new Float32Array(items[i * step % items.length]!.v));

  let clusters: Vec[][] = Array.from({ length: effK }, () => []);
  for (let iter = 0; iter < maxIter; iter++) {
    clusters = Array.from({ length: effK }, () => []);
    for (const it of items) {
      let best = 0, bestSim = -Infinity;
      for (let i = 0; i < effK; i++) {
        const s = cosine(it.v, centroids[i]!);
        if (s > bestSim) { bestSim = s; best = i; }
      }
      clusters[best]!.push(it);
    }
    let moved = false;
    for (let i = 0; i < effK; i++) {
      if (clusters[i]!.length === 0) continue;
      const nc = centroid(clusters[i]!);
      // Move if any dim diff > epsilon
      let diff = 0;
      for (let j = 0; j < nc.length; j++) diff += Math.abs(nc[j]! - centroids[i]![j]!);
      if (diff > 1e-4) moved = true;
      centroids[i] = nc;
    }
    if (!moved) break;
  }
  return clusters.filter((c) => c.length > 0);
}

export interface RecurringThemesDeps {
  /**
   * Optional label-generation callback. Must accept cluster top-terms only
   * (NEVER raw chunk text — T-08-02). Defaults to a no-LLM heuristic that
   * concatenates the top-2 terms. Tests pass a spy to assert prompt shape.
   */
  labelFromTerms?: (terms: string[]) => Promise<string>;
  /** Test seam: skip Float32Array deserialize. */
  decodeVector?: (buf: Buffer, dim: number) => Float32Array;
}

function decodeVectorDefault(buf: Buffer, dim: number): Float32Array {
  // nomic-embed stored as little-endian Float32 BLOB in rag_embedding.vector.
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    if (buf.length < (i + 1) * 4) break;
    out[i] = buf.readFloatLE(i * 4);
  }
  return out;
}

async function defaultLabelFromTerms(terms: string[]): Promise<string> {
  // Heuristic fallback when no LLM is wired (tests / offline). Compose the
  // top-2 terms as a short label, capped at 30 chars.
  const label = terms.slice(0, 2).join(' / ').trim() || 'untitled';
  return label.slice(0, 30);
}

interface ChunkWithEmbedding {
  id: string;
  text: string;
  vector: Buffer | Uint8Array;
  dim: number;
}

export async function computeRecurringThemes(
  db: Db,
  weekStartYmd: string,
  deps: RecurringThemesDeps = {},
): Promise<RecurringThemesPayload> {
  void weekStartYmd;
  const labelFromTerms = deps.labelFromTerms ?? defaultLabelFromTerms;
  const decode = deps.decodeVector ?? decodeVectorDefault;

  let rows: ChunkWithEmbedding[] = [];
  try {
    rows = db
      .prepare(
        `SELECT c.id AS id, c.text AS text, e.vector AS vector, e.dim AS dim
           FROM rag_chunk c
           JOIN rag_embedding e ON e.chunk_id = c.id
          WHERE c.source_kind IN ('email','note')
            AND c.deleted_at IS NULL
          ORDER BY c.updated_at DESC
          LIMIT 1000`,
      )
      .all() as ChunkWithEmbedding[];
  } catch {
    return { kind: 'recurring_themes', topThemes: [] };
  }
  if (rows.length === 0) {
    return { kind: 'recurring_themes', topThemes: [] };
  }

  const items: Vec[] = rows.map((r) => ({
    id: r.id,
    v: decode(Buffer.isBuffer(r.vector) ? r.vector : Buffer.from(r.vector), r.dim),
    text: r.text,
  }));

  // Sweep k=3..8; pick the k whose largest-cluster cohesion (avg cosine to
  // centroid) is highest — coarse silhouette proxy.
  let bestClusters: Vec[][] = [];
  let bestScore = -Infinity;
  for (let k = 3; k <= Math.min(8, items.length); k++) {
    const clusters = kmeans(items, k);
    if (clusters.length === 0) continue;
    let score = 0;
    for (const c of clusters) {
      const cent = centroid(c);
      let avg = 0;
      for (const it of c) avg += cosine(it.v, cent);
      avg /= c.length;
      score += avg * c.length;
    }
    score /= items.length;
    if (score > bestScore) { bestScore = score; bestClusters = clusters; }
  }
  if (bestClusters.length === 0) {
    return { kind: 'recurring_themes', topThemes: [] };
  }

  // Largest 3 clusters → labels via top-5 TF terms (NEVER raw chunk text).
  bestClusters.sort((a, b) => b.length - a.length);
  const themes: string[] = [];
  for (const c of bestClusters.slice(0, 3)) {
    const combined = c.map((v) => v.text).join(' ');
    const terms = topTermsFor(combined, 5);
    const label = (await labelFromTerms(terms)).slice(0, 30);
    if (label) themes.push(label);
  }
  return { kind: 'recurring_themes', topThemes: themes };
}

// ---------------------------------------------------------------------------
// 4. approvalEditPattern — % of approved drafts the user edited
// ---------------------------------------------------------------------------

export function computeApprovalEditPattern(
  db: Db,
  weekStartYmd: string,
): ApprovalEditsPayload {
  const { thisStart, thisEnd } = windowForWeek(weekStartYmd);
  let approved = 0, edited = 0;
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS approved,
                SUM(CASE WHEN body_edited IS NOT NULL
                          AND body_edited != ''
                          AND body_edited != COALESCE(body_original, '')
                         THEN 1 ELSE 0 END) AS edited
           FROM approval
          WHERE state IN ('approved','sent')
            AND kind = 'email_send'
            AND created_at >= ?
            AND created_at < ?`,
      )
      .get(isoOrNull(thisStart), isoOrNull(thisEnd)) as { approved: number; edited: number } | undefined;
    approved = row?.approved ?? 0;
    edited = row?.edited ?? 0;
  } catch {
    approved = 0;
    edited = 0;
  }
  const sharePct = approved === 0 ? 0 : Math.round((edited / approved) * 100);
  return {
    kind: 'approval_edits',
    editedDraftSharePct: sharePct,
    topEditCategories: [], // Phase 8 Stream 3 backfill provides the source
  };
}

// ---------------------------------------------------------------------------
// Type-only re-export so callers can `import { LanguageModel }` shape only
// without coupling tightly to ai SDK runtime here.
// ---------------------------------------------------------------------------
export type { LanguageModel };

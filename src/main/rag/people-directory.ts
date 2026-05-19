/**
 * Plan 07-02 Task 8 — People directory build + alias map (REVIEWS C10).
 *
 * Two update paths:
 *   1. `rebuildPeopleDirectory({since?})`: bulk pass over gmail_message +
 *      calendar_event.attendees + meeting_note_segment.speaker. Cron-piggybacked
 *      (every Nth mail tick).
 *   2. `upsertPersonFromHeaders(db, msgRow)`: cheap inline path called by the
 *      mail ingest on every new row insert. C10 freshness — aliases are
 *      resolvable within seconds, not within ~1h.
 *
 * `resolvePersonMention(db, mention)` is the query-time helper. Returns
 *   { confident: Person } | { ambiguous: Person[] } | { none } | with a
 *   `directoryStale: true` flag when the bulk rebuild is older than 24h.
 *
 * Logging hygiene: never log full email body / segment text — messageId +
 * count only.
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export interface Person {
  id: string;
  canonicalEmail: string | null;
  displayName: string;
  observedCount: number;
  lastSeenAt: string;
}

export type ResolveResult =
  | { kind: 'confident'; person: Person; directoryStale: boolean }
  | { kind: 'ambiguous'; candidates: Person[]; directoryStale: boolean }
  | { kind: 'none'; directoryStale: boolean };

interface ParsedHeader {
  email: string;
  display: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Parse a single RFC-5322-ish address into `{email, display}`. Tolerant of
 * common gmail formats: `"Sarah Doe" <sarah@example.com>` or `sarah@example.com`.
 */
export function parseAddress(input: string): ParsedHeader | null {
  if (!input) return null;
  const trimmed = input.trim();
  // `"Display" <email>` form
  const m = trimmed.match(/^"?([^"<]*)"?\s*<([^>]+)>$/);
  if (m) {
    const display = m[1]?.trim() ?? null;
    const email = m[2]?.trim().toLowerCase();
    if (!email) return null;
    return { email, display: display || null };
  }
  // Bare email
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { email: trimmed.toLowerCase(), display: null };
  }
  return null;
}

function ensurePerson(db: Db, parsed: ParsedHeader, now: string): string {
  const existing = db
    .prepare(`SELECT id FROM person WHERE canonical_email = ?`)
    .get(parsed.email) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE person SET last_seen_at = ?, observed_count = observed_count + 1, display_name = COALESCE(NULLIF(?, ''), display_name) WHERE id = ?`,
    ).run(now, parsed.display ?? '', existing.id);
    return existing.id;
  }
  const id = `p:${parsed.email}`;
  db.prepare(
    `INSERT INTO person (id, canonical_email, display_name, first_seen_at, last_seen_at, observed_count)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(id, parsed.email, parsed.display ?? parsed.email, now, now);
  return id;
}

function upsertAlias(
  db: Db,
  personId: string,
  alias: string,
  kind: 'email' | 'displayname' | 'shortname',
): void {
  if (!alias) return;
  db.prepare(
    `INSERT INTO person_alias (person_id, alias, alias_kind, seen_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(person_id, alias, alias_kind) DO UPDATE SET seen_count = seen_count + 1`,
  ).run(personId, alias, kind);
}

function shortName(display: string | null): string | null {
  if (!display) return null;
  const trimmed = display.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  return parts[0] ?? null;
}

/**
 * Inline path — called by the mail ingest on every new row insert. Reads ONLY
 * the row's own headers, no joins. Cheap enough to run synchronously inside
 * the ingest transaction.
 */
export function upsertPersonFromHeaders(
  db: Db,
  row: { from_addr?: string | null; to_addr?: string | null },
): void {
  const now = nowIso();
  const headers = [row.from_addr ?? '', row.to_addr ?? '']
    .filter(Boolean)
    .flatMap((s) => s!.split(',').map((p) => p.trim()).filter(Boolean));
  const txn = db.transaction(() => {
    for (const h of headers) {
      const parsed = parseAddress(h);
      if (!parsed) continue;
      const id = ensurePerson(db, parsed, now);
      upsertAlias(db, id, parsed.email, 'email');
      if (parsed.display) upsertAlias(db, id, parsed.display, 'displayname');
      const sn = shortName(parsed.display);
      if (sn && sn !== parsed.display) upsertAlias(db, id, sn, 'shortname');
    }
  });
  txn();
}

export interface RebuildOptions {
  /** ISO timestamp lower bound — only ingest rows newer than this. */
  since?: string;
}

export interface RebuildResult {
  emailsScanned: number;
  eventsScanned: number;
  segmentsScanned: number;
  peopleSeen: number;
}

export function rebuildPeopleDirectory(db: Db, opts: RebuildOptions = {}): RebuildResult {
  const since = opts.since ?? null;
  const now = nowIso();
  let emailsScanned = 0;
  let eventsScanned = 0;
  let segmentsScanned = 0;
  const personIds = new Set<string>();

  // Gmail headers
  const gmailRows = db
    .prepare(
      `SELECT from_addr, received_at FROM gmail_message WHERE (? IS NULL OR received_at >= ?)`,
    )
    .all(since, since) as Array<{ from_addr: string | null; received_at: string }>;
  const txn = db.transaction(() => {
    for (const r of gmailRows) {
      emailsScanned++;
      if (!r.from_addr) continue;
      const parsed = parseAddress(r.from_addr);
      if (!parsed) continue;
      const id = ensurePerson(db, parsed, now);
      personIds.add(id);
      upsertAlias(db, id, parsed.email, 'email');
      if (parsed.display) upsertAlias(db, id, parsed.display, 'displayname');
      const sn = shortName(parsed.display);
      if (sn && sn !== parsed.display) upsertAlias(db, id, sn, 'shortname');
    }
  });
  txn();

  // Calendar attendees (attendees stored as JSON string per Phase 2/5).
  try {
    const eventRows = db
      .prepare(`SELECT attendees FROM calendar_event WHERE attendees IS NOT NULL`)
      .all() as Array<{ attendees: string | null }>;
    const txn2 = db.transaction(() => {
      for (const e of eventRows) {
        eventsScanned++;
        if (!e.attendees) continue;
        try {
          const arr = JSON.parse(e.attendees) as Array<{ email?: string; displayName?: string }>;
          for (const a of arr) {
            if (!a.email) continue;
            const parsed = parseAddress(
              a.displayName ? `${a.displayName} <${a.email}>` : a.email,
            );
            if (!parsed) continue;
            const id = ensurePerson(db, parsed, now);
            personIds.add(id);
            upsertAlias(db, id, parsed.email, 'email');
            if (parsed.display) upsertAlias(db, id, parsed.display, 'displayname');
          }
        } catch {
          /* malformed attendees JSON — skip */
        }
      }
    });
    txn2();
  } catch {
    // calendar_event might not exist in some test setups; ignore.
  }

  // Meeting note speakers
  try {
    const segs = db
      .prepare(`SELECT DISTINCT speaker FROM meeting_note_segment WHERE speaker IS NOT NULL`)
      .all() as Array<{ speaker: string }>;
    const txn3 = db.transaction(() => {
      for (const s of segs) {
        segmentsScanned++;
        const speaker = s.speaker.trim();
        if (!speaker) continue;
        // Speakers are display strings without an email; record as a displayname
        // alias against a synthetic id `p:speaker:<lower>`.
        const synthId = `p:speaker:${speaker.toLowerCase()}`;
        const existing = db
          .prepare(`SELECT id FROM person WHERE id = ?`)
          .get(synthId) as { id: string } | undefined;
        if (!existing) {
          db.prepare(
            `INSERT INTO person (id, canonical_email, display_name, first_seen_at, last_seen_at, observed_count)
             VALUES (?, NULL, ?, ?, ?, 1)`,
          ).run(synthId, speaker, now, now);
        } else {
          db.prepare(
            `UPDATE person SET last_seen_at = ?, observed_count = observed_count + 1 WHERE id = ?`,
          ).run(now, synthId);
        }
        personIds.add(synthId);
        upsertAlias(db, synthId, speaker, 'displayname');
        const sn = shortName(speaker);
        if (sn && sn !== speaker) upsertAlias(db, synthId, sn, 'shortname');
      }
    });
    txn3();
  } catch {
    // schema may not have meeting_note_segment in some test setups; ignore.
  }

  // Record bulk-rebuild timestamp in app_meta (schema owned by migration 001).
  db.prepare(
    `INSERT INTO app_meta (k, v) VALUES ('last_people_directory_rebuild_at', ?)
     ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
  ).run(now);

  return {
    emailsScanned,
    eventsScanned,
    segmentsScanned,
    peopleSeen: personIds.size,
  };
}

function isStale(db: Db): boolean {
  const row = db
    .prepare(`SELECT v FROM app_meta WHERE k = 'last_people_directory_rebuild_at'`)
    .get() as { v: string } | undefined;
  if (!row) return true;
  const last = new Date(row.v).getTime();
  return Date.now() - last > 24 * 3600 * 1000;
}

function rowToPerson(r: {
  id: string;
  canonical_email: string | null;
  display_name: string;
  observed_count: number;
  last_seen_at: string;
}): Person {
  return {
    id: r.id,
    canonicalEmail: r.canonical_email,
    displayName: r.display_name,
    observedCount: r.observed_count,
    lastSeenAt: r.last_seen_at,
  };
}

export function resolvePersonMention(db: Db, mention: string): ResolveResult {
  const stale = isStale(db);
  const trimmed = mention.trim();
  if (!trimmed) return { kind: 'none', directoryStale: stale };

  // Try as email first.
  const asEmail = parseAddress(trimmed);
  if (asEmail) {
    const row = db
      .prepare(
        `SELECT id, canonical_email, display_name, observed_count, last_seen_at
           FROM person WHERE canonical_email = ?`,
      )
      .get(asEmail.email) as
      | { id: string; canonical_email: string | null; display_name: string; observed_count: number; last_seen_at: string }
      | undefined;
    if (row) return { kind: 'confident', person: rowToPerson(row), directoryStale: stale };
  }

  // Otherwise resolve against alias table.
  const matches = db
    .prepare(
      `SELECT p.id, p.canonical_email, p.display_name, p.observed_count, p.last_seen_at
         FROM person_alias a
         JOIN person p ON p.id = a.person_id
        WHERE a.alias = ? COLLATE NOCASE
        ORDER BY p.last_seen_at DESC, p.observed_count DESC
        LIMIT 5`,
    )
    .all(trimmed) as Array<{
    id: string;
    canonical_email: string | null;
    display_name: string;
    observed_count: number;
    last_seen_at: string;
  }>;
  if (matches.length === 0) return { kind: 'none', directoryStale: stale };
  if (matches.length === 1) {
    return { kind: 'confident', person: rowToPerson(matches[0]!), directoryStale: stale };
  }
  return {
    kind: 'ambiguous',
    candidates: matches.map(rowToPerson),
    directoryStale: stale,
  };
}

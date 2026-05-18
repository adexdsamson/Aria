/**
 * Plan 03-04 Task 3 — Voice exemplar fetcher for the few-shot drafter.
 *
 * Pulls the user's recent sent emails to use as voice exemplars in the
 * drafting prompt. ALWAYS excludes any IDs recorded in `voice_match_holdout`
 * (Plan 03-04 Task 1) so the voice-match eval stays honest on re-runs — the
 * 50 held-out emails must never leak into the few-shot pool.
 *
 * Heuristic match: prefer exemplars in the same length-bucket (short/long)
 * and tone-bucket (formal/casual) as the source message subject + snippet.
 * Falls back to most-recent-by-received_at when there aren't enough matches.
 *
 * "Sent" detection: Phase 2 does NOT yet record a `direction` column on
 * `gmail_message` (Phase 6 contacts directory will). v1 uses Gmail label
 * heuristic: any row whose `label_ids` JSON contains the literal "SENT".
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export interface VoiceExemplar {
  id: string;
  subject: string;
  snippet: string;
  received_at: string;
}

export interface SourceMessageHint {
  subject: string;
  snippet: string;
}

const SHORT_CHARS = 200;

function lengthBucket(s: string): 'short' | 'long' {
  return (s ?? '').length < SHORT_CHARS ? 'short' : 'long';
}

function toneBucket(subject: string, body: string): 'formal' | 'casual' {
  const subj = (subject ?? '').trim();
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;
  const subjectCapitalized =
    subj.length > 0 &&
    subj[0] === subj[0]!.toUpperCase() &&
    /[A-Z]/.test(subj[0] ?? '');
  return subjectCapitalized && wordCount >= 5 ? 'formal' : 'casual';
}

/**
 * Fetch up to `k` voice exemplars from the user's sent corpus, excluding any
 * IDs in `voice_match_holdout`. Caller passes the source message so we can
 * stratum-match.
 */
export function fetchExemplars(
  db: Db,
  source: SourceMessageHint,
  k = 5,
): VoiceExemplar[] {
  const wantLen = lengthBucket(source.snippet ?? '');
  const wantTone = toneBucket(source.subject ?? '', source.snippet ?? '');

  // Pull a wider candidate pool then in-process filter by tone/length bucket.
  // Excludes voice_match_holdout via LEFT JOIN. Phase 2 stores label_ids as
  // a JSON-encoded array text; we LIKE-match the literal "SENT" token.
  const rows = db
    .prepare(
      `SELECT m.id, m.subject, m.snippet, m.received_at, m.label_ids
       FROM gmail_message m
       LEFT JOIN voice_match_holdout h ON h.id = m.id
       WHERE h.id IS NULL
         AND m.label_ids LIKE '%"SENT"%'
       ORDER BY m.received_at DESC
       LIMIT ?`,
      // pull 4×k candidates so we have enough to bucket-match.
    )
    .all(Math.max(k * 4, 20)) as Array<{
      id: string;
      subject: string;
      snippet: string;
      received_at: string;
      label_ids: string;
    }>;

  const matched: VoiceExemplar[] = [];
  const fallback: VoiceExemplar[] = [];
  for (const r of rows) {
    const ex: VoiceExemplar = {
      id: r.id,
      subject: r.subject ?? '',
      snippet: r.snippet ?? '',
      received_at: r.received_at,
    };
    const len = lengthBucket(ex.snippet);
    const tone = toneBucket(ex.subject, ex.snippet);
    if (len === wantLen && tone === wantTone) matched.push(ex);
    else fallback.push(ex);
    if (matched.length >= k) break;
  }
  // Top up with fallback (most-recent) if matched is short.
  while (matched.length < k && fallback.length > 0) {
    matched.push(fallback.shift()!);
  }
  return matched.slice(0, k);
}

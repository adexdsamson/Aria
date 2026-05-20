/**
 * Plan 08-03 Task 4 — Nightly preference aggregator.
 *
 * aggregatePreferences(db, { windowDays }) reads the last `windowDays` of
 * learning_signals and derives a single learned_preferences row via pure
 * derivation functions. Default window: 30 days (research Pitfall 8).
 *
 * Derivation is intentionally simple and deterministic:
 *   - voice.terseness: shifts toward 1.0 when >60% of approval.edit signals
 *     have editCategory='length-shorter'; toward 0.0 when length-longer.
 *   - other fields keep their existing value (defaults if no row yet) — Stream
 *     3 ships the scaffold; future plans (or Phase 9 UI work) wire additional
 *     derivations as the signal corpus grows.
 *
 * The aggregator is idempotent — re-running on the same signal window
 * produces the same learned_preferences row.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import { readPreferences, writePreferences, DEFAULT_PREFERENCES, type Preferences } from './prefs';
import { listSignals } from './signal-log';

type Db = Database.Database;

export interface AggregateArgs {
  windowDays?: number;
  now?: Date;
}

export interface AggregateResult {
  preferences: Preferences;
  signalsCounted: number;
}

export function aggregatePreferences(db: Db, args: AggregateArgs = {}): AggregateResult {
  const windowDays = args.windowDays ?? 30;
  const now = args.now ?? new Date();
  const fromIso = new Date(now.getTime() - windowDays * 86_400_000).toISOString();
  const toIso = now.toISOString();

  const signals = listSignals(db, { fromIso, toIso, limit: 500 });
  const current = readPreferences(db).preferences;

  const next: Preferences = {
    voice: deriveVoice(signals, current.voice),
    briefing: current.briefing, // unchanged in v1
    scheduling: current.scheduling, // unchanged in v1
    triage: current.triage, // unchanged in v1
  };

  writePreferences(db, { preferences: next, now });

  return { preferences: next, signalsCounted: signals.length };
}

interface SignalLike {
  source: string;
  kind: string;
  payload: unknown;
}

export function deriveVoice(signals: SignalLike[], current: Preferences['voice']): Preferences['voice'] {
  const approvalEdits = signals.filter((s) => s.source === 'approval' && s.kind === 'approval.edit');
  if (approvalEdits.length === 0) return current;

  let shorter = 0;
  let longer = 0;
  for (const s of approvalEdits) {
    const cat = (s.payload as { editCategory?: string }).editCategory;
    if (cat === 'length-shorter') shorter++;
    else if (cat === 'length-longer') longer++;
  }
  const total = approvalEdits.length;
  let terseness = current.terseness;
  if (shorter / total >= 0.6) terseness = clamp01(current.terseness + 0.25);
  else if (longer / total >= 0.6) terseness = clamp01(current.terseness - 0.25);

  return { terseness, formality: current.formality };
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// Exposed for tests — re-export DEFAULT_PREFERENCES so callers don't have to
// import from two modules.
export { DEFAULT_PREFERENCES };

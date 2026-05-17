/**
 * Plan 03-01 — Tier configuration (APPR-06).
 *
 * v1 ships `always-confirm` for every content class; the schema exists so
 * Phase 4 / v1.x can introduce per-recipient or per-content-class overrides
 * without a migration. Tier mutation is intentionally NOT exposed over IPC
 * in v1 (CONTEXT decision: per-recipient allowlist UI deferred).
 */
import type Database from 'better-sqlite3-multiple-ciphers';

type Db = Database.Database;

export type Tier = 'silent' | 'explicit' | 'always-confirm';
export const TIER_DEFAULT: Tier = 'always-confirm';

export function getTier(db: Db, contentClass: string): Tier {
  const row = db
    .prepare(`SELECT tier FROM approval_tier WHERE content_class = ?`)
    .get(contentClass) as { tier: Tier } | undefined;
  return row ? row.tier : TIER_DEFAULT;
}

/**
 * user_version-driven migration runner.
 *
 * Reads `*.sql` files from `src/main/db/migrations/`, sorted lexically. Files
 * are named `<NNN>[a-z]?_<slug>.sql`; the numeric/alpha prefix is the target
 * user_version.
 * Each migration whose prefix > current user_version is applied inside a
 * single transaction that also advances user_version. Re-running is a no-op.
 *
 * Logging: each applied migration emits `db.migrate.applied`. Failures emit
 * `db.migrate.failed` (without SQL payload — pino redact policy).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type Database from 'better-sqlite3-multiple-ciphers';
import { getLogger } from '../../log/pino';
import { EMBEDDED_MIGRATIONS } from './embedded';

type Db = Database.Database;

/** Default location of bundled migration files (used by source-tree tests). */
export const MIGRATIONS_DIR = __dirname;

export interface RunMigrationsOptions {
  /** Override migrations directory (used by tests). */
  dir?: string;
  /** Optional pino logger (defaults to the singleton). */
  logger?: { info: (o: object, m?: string) => void; warn?: (o: object, m?: string) => void };
}

interface Migration {
  version: number;
  file: string;
  sql: string;
}

function parseMigrationVersion(file: string): number | null {
  if (file === '014_legacy_singleton_views.sql') return 122;
  const m = /^(\d+)([a-z]?)_/.exec(file);
  if (!m) return null;
  const base = Number.parseInt(m[1]!, 10);
  const suffix = m[2] ?? '';
  if (!suffix) return base;
  return base * 10 + (suffix.charCodeAt(0) - 96);
}

/**
 * Parse `<NNN>[a-z]?_<slug>.sql` filenames into ordered migrations. Files
 * whose names do not match the pattern are ignored with a warning.
 */
function loadMigrations(dir: string | undefined): Migration[] {
  // When an explicit dir is supplied (unit tests), read .sql files from disk.
  // Otherwise use the EMBEDDED_MIGRATIONS string constants, which survive the
  // electron-vite bundle into out/main/index.js.
  if (dir && fs.existsSync(dir)) {
    const entries = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.sql'));
    entries.sort();
    const out: Migration[] = [];
    for (const file of entries) {
      const version = parseMigrationVersion(file);
      if (version === null) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      out.push({ version, file, sql });
    }
    return out;
  }
  return EMBEDDED_MIGRATIONS.map((m) => ({ version: m.version, file: m.file, sql: m.sql }));
}

/**
 * Apply all migrations whose version > db.user_version.
 *
 * Returns the list of versions actually applied (empty when already current).
 */
export function runMigrations(db: Db, opts: RunMigrationsOptions = {}): number[] {
  const dir = opts.dir;
  const logger = opts.logger ?? safeLogger();
  const migrations = loadMigrations(dir);
  const current = db.pragma('user_version', { simple: true }) as number;
  const applied: number[] = [];
  for (const m of migrations) {
    if (m.version <= current) continue;
    try {
      const explicitTxn = /\bBEGIN;/.test(m.sql);
      if (explicitTxn) {
        db.exec(m.sql);
        db.pragma(`user_version=${m.version}`);
      } else {
        const tx = db.transaction(() => {
          db.exec(m.sql);
          db.pragma(`user_version=${m.version}`);
        });
        tx();
      }
      applied.push(m.version);
      logger.info({ event: 'db.migrate.applied', version: m.version, file: m.file });
    } catch (err) {
      if (/\bBEGIN;/.test(m.sql)) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore rollback failures; the original error is what matters.
        }
      }
      logger.warn?.({
        event: 'db.migrate.failed',
        version: m.version,
        file: m.file,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
  return applied;
}

/**
 * Best-effort logger: in unit tests pino may fail to construct (no electron
 * userData dir); fall back to a no-op so migrations don't blow up tests.
 */
function safeLogger(): {
  info: (o: object, m?: string) => void;
  warn: (o: object, m?: string) => void;
} {
  try {
    return getLogger();
  } catch {
    return { info: () => undefined, warn: () => undefined };
  }
}

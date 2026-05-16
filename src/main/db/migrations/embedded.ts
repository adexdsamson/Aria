/**
 * Embedded migration SQL. The source-of-truth lives in `*.sql` files next to
 * this module; this file mirrors their contents as string constants so the
 * runner has access to them after electron-vite bundles `src/main/` into
 * `out/main/index.js` (Vite does not copy non-imported assets).
 *
 * Keep in sync with the .sql files. The migrations test reads from the .sql
 * files directly — drift between the two will fail in CI.
 */
export interface EmbeddedMigration {
  version: number;
  file: string;
  sql: string;
}

export const EMBEDDED_MIGRATIONS: EmbeddedMigration[] = [
  {
    version: 1,
    file: '001_init.sql',
    sql: `
CREATE TABLE app_meta(
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE settings(
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE routing_log(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT    NOT NULL,
  route       TEXT    NOT NULL CHECK (route IN ('LOCAL','FRONTIER')),
  reason      TEXT    NOT NULL,
  source      TEXT    NOT NULL,
  prompt_hash TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  latency_ms  INTEGER NOT NULL,
  ok          INTEGER NOT NULL CHECK (ok IN (0,1))
);

CREATE INDEX idx_routing_log_ts ON routing_log(ts DESC);
`,
  },
];

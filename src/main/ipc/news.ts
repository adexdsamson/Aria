/**
 * Plan 02-03 Task 2 — News IPC handlers.
 *
 * Four channels:
 *   - NEWS_LIST_SOURCES   — SELECT * FROM news_source ORDER BY id.
 *   - NEWS_ADD_RSS        — validate URL; fetch one entry to confirm it parses;
 *                           INSERT row on success; `{ ok:false, error }` on parse failure.
 *   - NEWS_REMOVE_SOURCE  — DELETE FROM news_source WHERE id = ?
 *   - NEWS_SET_BUNDLE     — DELETE existing bundle rows; load bundle JSON;
 *                           filter by sectors; INSERT one row per feed; also
 *                           ensure a single `kind='hn'` row exists (idempotent).
 *
 * Wired into `registerHandlers` (src/main/ipc/index.ts) as the 9th
 * registration block (Phase 1 baseline 6 + Gmail + Calendar + News).
 *
 * Note on validation: Renderer-side checks URL format; main-side `NEWS_ADD_RSS`
 * additionally calls `fetchRssFeed({url, limit:1})` to verify the feed actually
 * parses before persisting. A bad URL OR a non-parseable feed both yield
 * `{ ok:false, error }` and never INSERT.
 */
import type { IpcMain } from 'electron';
import type { Logger } from 'pino';
import { CHANNELS, type NewsSourceRow } from '../../shared/ipc-contract';
import type { DbHolder } from './onboarding';
import { fetchRssFeed } from '../news/rss';
import { loadBundle } from '../news/country-bundle';

export interface NewsHandlerDeps {
  logger: Logger;
  dbHolder: DbHolder;
  /** Test seam: replace the per-URL feed verifier. Default = fetchRssFeed. */
  verifyFeed?: (url: string) => Promise<void>;
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function registerNewsHandlers(ipcMain: IpcMain, deps: NewsHandlerDeps): void {
  const { logger, dbHolder } = deps;

  const verifyFeed =
    deps.verifyFeed ??
    (async (url: string): Promise<void> => {
      // Throws NewsSourceError if parse fails or times out.
      await fetchRssFeed({ url, limit: 1 });
    });

  // ── NEWS_LIST_SOURCES ───────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.NEWS_LIST_SOURCES, async (): Promise<{ sources: NewsSourceRow[] }> => {
    const db = dbHolder.db;
    if (!db) return { sources: [] };
    try {
      const rows = db
        .prepare(
          `SELECT id, kind, country, sector, url, title, enabled, added_at
           FROM news_source
           ORDER BY id`,
        )
        .all() as NewsSourceRow[];
      return { sources: rows };
    } catch (err) {
      logger.warn({ scope: 'news-list', err: (err as Error).message }, 'list failed');
      return { sources: [] };
    }
  });

  // ── NEWS_ADD_RSS ────────────────────────────────────────────────────────────
  ipcMain.handle(
    CHANNELS.NEWS_ADD_RSS,
    async (_event, payload: { url: string; title?: string }) => {
      const db = dbHolder.db;
      if (!db) return { ok: false, error: 'db-locked' } as const;
      const url = (payload?.url ?? '').trim();
      if (!isValidHttpUrl(url)) {
        return { ok: false, error: 'invalid-url' } as const;
      }
      try {
        await verifyFeed(url);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.info({ scope: 'news-add-rss', url, err: message }, 'feed verification failed');
        return { ok: false, error: 'unparseable-feed' } as const;
      }
      try {
        const nowIso = new Date().toISOString();
        const info = db
          .prepare(
            `INSERT INTO news_source (kind, country, sector, url, title, enabled, added_at)
             VALUES ('rss', NULL, NULL, @url, @title, 1, @added_at)`,
          )
          .run({ url, title: payload?.title ?? null, added_at: nowIso });
        return { ok: true, id: Number(info.lastInsertRowid) } as const;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ scope: 'news-add-rss', err: message }, 'insert failed');
        return { ok: false, error: message } as const;
      }
    },
  );

  // ── NEWS_REMOVE_SOURCE ──────────────────────────────────────────────────────
  ipcMain.handle(CHANNELS.NEWS_REMOVE_SOURCE, async (_event, payload: { id: number }) => {
    const db = dbHolder.db;
    if (!db) return { ok: false } as const;
    try {
      db.prepare('DELETE FROM news_source WHERE id = ?').run(payload?.id);
      return { ok: true } as const;
    } catch (err) {
      logger.warn({ scope: 'news-remove', err: (err as Error).message }, 'remove failed');
      return { ok: false } as const;
    }
  });

  // ── NEWS_SET_BUNDLE ─────────────────────────────────────────────────────────
  ipcMain.handle(
    CHANNELS.NEWS_SET_BUNDLE,
    async (_event, payload: { country: string; sectors: string[] }) => {
      const db = dbHolder.db;
      if (!db) return { ok: false } as const;
      const country = payload?.country ?? '';
      const sectors = Array.isArray(payload?.sectors) ? payload.sectors : [];
      const sectorSet = new Set(sectors);
      try {
        const bundle = loadBundle(country);
        const selected = bundle.feeds.filter((f) => sectorSet.has(f.sector));
        const nowIso = new Date().toISOString();
        const tx = db.transaction(() => {
          // Drop existing bundle rows; user is re-picking.
          db.prepare("DELETE FROM news_source WHERE kind = 'bundle'").run();
          const insertBundle = db.prepare(
            `INSERT INTO news_source (kind, country, sector, url, title, enabled, added_at)
             VALUES ('bundle', @country, @sector, @url, @title, 1, @added_at)`,
          );
          for (const f of selected) {
            insertBundle.run({
              country: bundle.country,
              sector: f.sector,
              url: f.url,
              title: f.title,
              added_at: nowIso,
            });
          }
          // Idempotent HN row — ensure exactly one exists.
          const hnExisting = db
            .prepare("SELECT id FROM news_source WHERE kind = 'hn' LIMIT 1")
            .get() as { id: number } | undefined;
          if (!hnExisting) {
            db.prepare(
              `INSERT INTO news_source (kind, country, sector, url, title, enabled, added_at)
               VALUES ('hn', NULL, NULL, NULL, 'Hacker News', 1, @added_at)`,
            ).run({ added_at: nowIso });
          }
        });
        tx();
        return { ok: true } as const;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ scope: 'news-set-bundle', err: message }, 'set-bundle failed');
        return { ok: false } as const;
      }
    },
  );
}

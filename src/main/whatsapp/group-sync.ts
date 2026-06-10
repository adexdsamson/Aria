/**
 * Plan 20-05 — Group discovery: groups.upsert → whatsapp_group untracked-default.
 *
 * D-03 privacy boundary: newly-discovered groups are ALWAYS inserted with
 * tracked=0 (the schema default). The `tracked` column is NEVER set here.
 * Only an explicit user action (WHATSAPP_SET_TRACKED IPC, Plan 20-06) can
 * flip a group to tracked=1.
 *
 * D-04: newly-joined groups surface with tracked=0 and are shown via a badge
 * (Plan 20-07 UI); they are never auto-tracked.
 */
import type Database from 'better-sqlite3-multiple-ciphers';
import type { Logger } from 'pino';

type Db = Database.Database;

// ─── Minimal Baileys group metadata shapes ────────────────────────────────────

interface BaileysGroupMetadata {
  id: string;
  subject?: string | null;
  desc?: string | null;
  size?: number | null;
}

interface BaileysGroupParticipantsUpdate {
  id: string;
  participants: string[];
  action: string;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface GroupSyncDeps {
  db: Db;
  logger: Pick<Logger, 'info' | 'warn' | 'debug'>;
}

// ─── Socket type for registration ────────────────────────────────────────────

interface BaileysSocket {
  ev: { on: (event: string, handler: (arg: unknown) => void) => void };
}

interface BaileysGroupMetadataFull extends BaileysGroupMetadata {
  participants?: unknown[];
}

interface BaileysSocketWithFetch extends BaileysSocket {
  groupFetchAllParticipating?: () => Promise<Record<string, BaileysGroupMetadataFull>>;
}

// ─── syncAllGroups ─────────────────────────────────────────────────────────────

/**
 * Actively fetch EVERY group the linked account participates in and upsert them
 * (tracked=0 default). Baileys' `groups.upsert` event only fires for NEW or
 * changed groups — it does NOT push the existing group list on link — so without
 * this the group picker is empty right after a fresh link. Called by the session
 * manager on connection:open.
 *
 * Passive-posture safe (WA-11): groupFetchAllParticipating is a metadata read
 * (IQ get); it sends no chat message and no online presence. Returns the number
 * of groups upserted. Never throws — failures degrade to an empty picker.
 */
export async function syncAllGroups(
  sock: BaileysSocketWithFetch,
  deps: GroupSyncDeps,
): Promise<number> {
  const { db, logger } = deps;
  if (typeof sock.groupFetchAllParticipating !== 'function') return 0;

  let groups: Record<string, BaileysGroupMetadataFull>;
  try {
    groups = await sock.groupFetchAllParticipating();
  } catch (err) {
    logger.warn(
      { scope: 'group-sync', event: 'fetch-all.fail', err: (err as Error).message },
      'groupFetchAllParticipating failed (group picker will populate via events)',
    );
    return 0;
  }

  const upsertStmt = db.prepare<[string, string, string | null, number | null]>(
    `INSERT INTO whatsapp_group
       (jid, display_name, description, member_count, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(jid) DO UPDATE SET
       display_name = excluded.display_name,
       description  = excluded.description,
       member_count = excluded.member_count,
       updated_at   = datetime('now')`,
  );

  const list = Object.values(groups ?? {});
  try {
    db.transaction(() => {
      for (const g of list) {
        if (!g?.id) continue;
        upsertStmt.run(
          g.id,
          g.subject ?? g.id,
          g.desc ?? null,
          g.size ?? g.participants?.length ?? null,
        );
      }
    })();
  } catch (err) {
    logger.warn(
      { scope: 'group-sync', event: 'fetch-all.upsert.fail', err: (err as Error).message },
      'failed to upsert fetched groups',
    );
    return 0;
  }

  logger.info(
    { scope: 'group-sync', event: 'fetch-all.done', count: list.length },
    'synced all participating groups (tracked=0 default)',
  );
  return list.length;
}

// ─── registerGroupSync ────────────────────────────────────────────────────────

/**
 * Register Baileys group-metadata event handlers on the given socket.
 *
 * groups.upsert  → upsert whatsapp_group rows with tracked=0 by default (D-03).
 * group-participants.update → refresh member_count.
 */
export function registerGroupSync(sock: BaileysSocket, deps: GroupSyncDeps): void {
  const { db, logger } = deps;

  // Prepared upsert — tracked is NOT set here; it defaults to 0 in the schema.
  const upsertStmt = db.prepare<[string, string, string | null, number | null]>(
    `INSERT INTO whatsapp_group
       (jid, display_name, description, member_count, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(jid) DO UPDATE SET
       display_name = excluded.display_name,
       description  = excluded.description,
       member_count = excluded.member_count,
       updated_at   = datetime('now')`,
    // NOTE: tracked is intentionally absent — ON CONFLICT never sets it, so
    // existing tracked=1 groups keep their value, and new groups default to 0
    // via the schema DEFAULT. (D-03 invariant.)
  );

  // Prepared member_count refresh for group-participants.update
  const updateMemberCountStmt = db.prepare<[number, string]>(
    `UPDATE whatsapp_group SET member_count = ?, updated_at = datetime('now') WHERE jid = ?`,
  );

  // ── groups.upsert: batch upsert of newly-seen or updated group metadata ────
  sock.ev.on('groups.upsert', (groups) => {
    const groupList = groups as BaileysGroupMetadata[];
    for (const g of groupList) {
      try {
        upsertStmt.run(
          g.id,
          g.subject ?? g.id,
          g.desc ?? null,
          g.size ?? null,
        );
        logger.debug(
          { scope: 'group-sync', event: 'group.upsert', jid: g.id },
          'upserted whatsapp_group (tracked=0 default)',
        );
      } catch (err) {
        logger.warn(
          { scope: 'group-sync', event: 'group.upsert.fail', jid: g.id, err },
          'failed to upsert whatsapp_group row',
        );
      }
    }
  });

  // ── group-participants.update: refresh member_count ────────────────────────
  sock.ev.on('group-participants.update', (update) => {
    const { id: jid, participants } = update as BaileysGroupParticipantsUpdate;
    if (!jid) return;
    try {
      // Re-query the current member_count from DB and adjust by participants delta.
      // Since Baileys doesn't always provide the new total, we store a participant
      // count delta via a SELECT+UPDATE approach.
      const row = db
        .prepare<[string], { member_count: number | null }>(
          `SELECT member_count FROM whatsapp_group WHERE jid = ? LIMIT 1`,
        )
        .get(jid);
      if (row == null) return; // group not yet discovered — groups.upsert will handle it
      const current = row.member_count ?? 0;
      // Use participants array length as a floor-signal for delta (add for join events).
      const newCount = Math.max(0, current + (participants?.length ?? 0));
      updateMemberCountStmt.run(newCount, jid);
      logger.debug(
        { scope: 'group-sync', event: 'participants.update', jid, newCount },
        'updated whatsapp_group member_count',
      );
    } catch (err) {
      logger.warn(
        { scope: 'group-sync', event: 'participants.update.fail', jid, err },
        'failed to update member_count',
      );
    }
  });
}

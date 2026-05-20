-- Phase 8 Stream 2 — Weekly Recap.
--
-- Owns:
--   1. VIEW `action_audit_log` unioning send_log / calendar_action_log /
--      meeting_action_task_link+todoist_task / approval(rejected).
--   2. `weekly_recap` row table (one row per ISO week).
--   3. `weekly_recap_section_edit` table (Stream 3 consumes for learning signals).
--
-- Dedicated file per peer-review H-1 (every Phase 8 stream owns its own
-- migration so dev machines that ran prior streams do not silently skip later
-- schema once user_version advances).

CREATE VIEW action_audit_log AS

  -- Arm 1: Email sends (Phase 3 send_log + Phase 5 Outlook send)
  SELECT
    'email_send'                                    AS kind,
    sl.id                                           AS row_id,
    sl.ts                                           AS occurred_at,
    sl.provider                                     AS provider,
    'email'                                         AS resource,
    sl.approval_id                                  AS approval_id,
    json_object(
      'recipients',     json(sl.recipients_json),
      'subject',        sl.subject,
      'ok',             sl.ok,
      'error',          sl.error,
      'providerMsgId',  sl.provider_msg_id
    )                                               AS payload_json,
    CASE WHEN sl.ok = 1 THEN 'sent' ELSE 'failed' END AS outcome
  FROM send_log sl

  UNION ALL

  -- Arm 2: Calendar changes (Phase 4 calendar_action_log).
  -- Phase enum is exactly: 'proposed','pre_write','post_write','failed','override'
  -- (CHECK constraint in migration 010 line 326). We INCLUDE only the 3 terminal
  -- arms; 'proposed' + 'pre_write' are pre-write transient states excluded by
  -- design (B-1 peer review).
  SELECT
    'calendar_change'                               AS kind,
    cal.id                                          AS row_id,
    cal.created_at                                  AS occurred_at,
    'google'                                        AS provider,
    'calendar'                                      AS resource,
    cal.approval_id                                 AS approval_id,
    json_object(
      'phase',          cal.phase,
      'eventId',        cal.event_id,
      'recurringScope', cal.recurring_scope,
      'before',         json(cal.before_json),
      'after',          json(cal.after_json),
      'googleEtag',     cal.google_etag,
      'error',          cal.google_error
    )                                               AS payload_json,
    CASE
      WHEN cal.phase = 'post_write' THEN 'applied'
      WHEN cal.phase = 'override'   THEN 'override'
      ELSE 'failed'
    END                                             AS outcome
  FROM calendar_action_log cal
  WHERE cal.phase IN ('post_write','failed','override')

  UNION ALL

  -- Arm 3: Todoist pushes (Phase 6 meeting_action_task_link joined to todoist_task).
  SELECT
    'task_pushed'                                   AS kind,
    mal.action_id                                   AS row_id,
    mal.created_at                                  AS occurred_at,
    'todoist'                                       AS provider,
    'tasks'                                         AS resource,
    NULL                                            AS approval_id,
    json_object(
      'taskId',         mal.task_id,
      'remoteId',       mal.remote_id,
      'content',        tt.content,
      'projectName',    tt.project_name
    )                                               AS payload_json,
    CASE WHEN tt.is_completed = 1 THEN 'completed' ELSE 'pushed' END AS outcome
  FROM meeting_action_task_link mal
  JOIN todoist_task tt ON tt.id = mal.task_id

  UNION ALL

  -- Arm 4: Approvals declined (rejected — across all kinds: email/calendar/task).
  SELECT
    'approval_declined'                             AS kind,
    a.id                                            AS row_id,
    a.updated_at                                    AS occurred_at,
    NULL                                            AS provider,
    a.kind                                          AS resource,
    a.id                                            AS approval_id,
    json_object(
      'rejectionReason', a.rejection_reason,
      'subject',         a.subject
    )                                               AS payload_json,
    'declined'                                      AS outcome
  FROM approval a
  WHERE a.state = 'rejected'
;

-- ── Recap row tables ──────────────────────────────────────────────────────
CREATE TABLE weekly_recap (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  iso_week        TEXT    NOT NULL UNIQUE,
  week_start_ymd  TEXT    NOT NULL,
  generated_at    TEXT    NOT NULL,
  finalized_at    TEXT,
  canonical_json  TEXT    NOT NULL
);

CREATE INDEX idx_weekly_recap_week_start ON weekly_recap(week_start_ymd DESC);

CREATE TABLE weekly_recap_section_edit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recap_id    INTEGER NOT NULL REFERENCES weekly_recap(id) ON DELETE CASCADE,
  section_key TEXT    NOT NULL,
  before_text TEXT    NOT NULL,
  after_text  TEXT    NOT NULL,
  category    TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX idx_weekly_recap_section_edit_recap ON weekly_recap_section_edit(recap_id);

PRAGMA user_version = 129;

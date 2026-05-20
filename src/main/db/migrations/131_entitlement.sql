-- 131_entitlement.sql — Phase 08.1 entitlement cache + trial state
CREATE TABLE entitlement (
  -- Single row; we use a fixed id = 1 to enforce singleton via UPSERT.
  id INTEGER PRIMARY KEY CHECK (id = 1),
  install_id TEXT NOT NULL,                -- generated once on first launch
  tier TEXT NOT NULL CHECK (tier IN ('trial', 'pro', 'locked')),
  jwt TEXT,                                -- raw JWT (may be NULL when locked)
  jwt_iat TEXT,                            -- ISO8601 from claim
  jwt_exp TEXT,                            -- ISO8601 from claim
  trial_started_at TEXT,                   -- ISO8601 from server (signed)
  trial_expires_at TEXT,                   -- = trial_started_at + 60d
  license_key TEXT,                        -- present once activated
  last_verified_at TEXT NOT NULL,          -- updated on every successful refresh
  last_check_error TEXT,                   -- diagnostic, NOT a security input
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE entitlement_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL CHECK (event IN (
    'trial-start', 'trial-refresh', 'activate-success', 'activate-fail',
    'refresh-success', 'refresh-fail', 'lock', 'unlock', 'clock-skew-warn'
  )),
  detail TEXT
);
CREATE INDEX idx_entitlement_audit_ts ON entitlement_audit(ts);

PRAGMA user_version = 131;

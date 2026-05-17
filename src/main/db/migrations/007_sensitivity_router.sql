-- Plan 03-02 — sensitivity router persistence.
--
-- Adds classifier output columns to the existing routing_log table so the
-- /routing-log diagnostics view + integration test can filter by classifier
-- categories / severity / version.
--
-- Notes:
--   - All columns are nullable so Phase 1 / Phase 2 callers (briefing,
--     ask-aria) that route without a classifier result keep working.
--   - approval table columns for classifier output were pre-declared in
--     migration 006 (Plan 03-01 polymorphic schema); this migration does NOT
--     re-declare them.

ALTER TABLE routing_log ADD COLUMN categories_json TEXT;
ALTER TABLE routing_log ADD COLUMN severity TEXT;
ALTER TABLE routing_log ADD COLUMN classifier_rationale TEXT;
ALTER TABLE routing_log ADD COLUMN classifier_version TEXT;

CREATE INDEX IF NOT EXISTS idx_routing_log_severity ON routing_log(severity);

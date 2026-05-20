-- Plan 08-04 Task 8 (M-3 round 2) — deliberately-failing migration fixture.
--
-- Used by tests/integration/phase8-happy-path.spec.ts Step 9 ONLY when the
-- env `ARIA_E2E_FORCE_MIGRATION_FAIL=true` is set. NEVER registered in
-- src/main/db/migrations/embedded.ts — the prod runner never sees this
-- file. The Step-9 spec includes a grep assertion that proves embedded.ts
-- does not reference `999_force_fail`.
--
-- Failure mechanism: duplicate column declaration raises a clear sqlite
-- syntax error with no destructive side-effect on any existing table.

CREATE TABLE force_fail (id INTEGER, id INTEGER);

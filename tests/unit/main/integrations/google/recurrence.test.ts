/**
 * Plan 04-01 Task 2 — recurrence.ts unit tests.
 *
 * Covers all three scopes per 04-RESEARCH §Pattern 3:
 *   (a) scope='this' on plain instance → instance-ID patch op
 *   (b) scope='this' caller-honoured ID semantics (chokepoint enforces the
 *       '_' guard; here we just confirm the planner does not invent IDs)
 *   (c) scope='all' → parentId patch op
 *   (d) scope='future' → 2 ops with UNTIL on parent + new RRULE on insert
 *   (e) rollback function returns a single op restoring original RRULE
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeRecurringWrite } from '../../../../../src/main/integrations/google/recurrence';

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../../fixtures/google/recurring-events.json'),
    'utf8',
  ),
) as {
  single: { id: string; etag: string };
  weeklyParent: { id: string; etag: string; recurrence: string[] };
  weeklyInstance: { id: string; etag: string };
};

describe('computeRecurringWrite', () => {
  it("scope='this' returns a single PATCH op against the instance id", () => {
    const plan = computeRecurringWrite({
      scope: 'this',
      event: {
        id: FIXTURE.weeklyInstance.id,
        parentId: FIXTURE.weeklyParent.id,
        etag: FIXTURE.weeklyInstance.etag,
        startUtc: '2026-05-26T15:00:00.000Z',
      },
      change: { startUtc: '2026-05-26T16:00:00.000Z', endUtc: '2026-05-26T16:30:00.000Z' },
    });
    expect(plan.ops.length).toBe(1);
    expect(plan.ops[0]!.kind).toBe('patch');
    expect((plan.ops[0] as { id: string }).id).toBe(FIXTURE.weeklyInstance.id);
    expect((plan.ops[0] as { id: string }).id).toContain('_');
    expect(plan.ops[0]!.sendUpdates).toBe('none');
    expect((plan.ops[0] as { etag?: string }).etag).toBe(FIXTURE.weeklyInstance.etag);
    expect(plan.rollback).toBeUndefined();
  });

  it("scope='this' does NOT synthesize an instance id from the parent — caller must provide one", () => {
    // If the caller passes the parent id by mistake, the planner returns a
    // patch keyed on the parent id (no '_'). The chokepoint
    // (write-event.ts) is responsible for refusing this with
    // InvalidInstanceIdError BEFORE the API call.
    const plan = computeRecurringWrite({
      scope: 'this',
      event: {
        id: FIXTURE.weeklyParent.id, // parent id — caller mistake
        parentId: FIXTURE.weeklyParent.id,
        etag: FIXTURE.weeklyParent.etag,
        startUtc: '2026-05-26T15:00:00.000Z',
      },
      change: { startUtc: '2026-05-26T16:00:00.000Z' },
    });
    const opId = (plan.ops[0] as { id: string }).id;
    expect(opId).toBe(FIXTURE.weeklyParent.id);
    expect(opId.includes('_')).toBe(false);
  });

  it("scope='all' returns a single PATCH op against the parent id", () => {
    const plan = computeRecurringWrite({
      scope: 'all',
      event: {
        id: FIXTURE.weeklyInstance.id,
        parentId: FIXTURE.weeklyParent.id,
        etag: FIXTURE.weeklyParent.etag,
        recurrence: FIXTURE.weeklyParent.recurrence,
        startUtc: '2026-05-26T15:00:00.000Z',
      },
      change: { summary: 'Renamed standup' },
    });
    expect(plan.ops.length).toBe(1);
    expect(plan.ops[0]!.kind).toBe('patch');
    expect((plan.ops[0] as { id: string }).id).toBe(FIXTURE.weeklyParent.id);
    expect((plan.ops[0] as { body: { summary?: string } }).body.summary).toBe('Renamed standup');
    expect(plan.rollback).toBeUndefined();
  });

  it("scope='future' returns 2 ops: PATCH parent with UNTIL + INSERT new series", () => {
    const plan = computeRecurringWrite({
      scope: 'future',
      event: {
        id: FIXTURE.weeklyInstance.id,
        parentId: FIXTURE.weeklyParent.id,
        etag: FIXTURE.weeklyParent.etag,
        recurrence: FIXTURE.weeklyParent.recurrence,
        startUtc: '2026-05-26T15:00:00.000Z',
      },
      change: { startUtc: '2026-05-26T16:00:00.000Z', endUtc: '2026-05-26T16:30:00.000Z' },
    });
    expect(plan.ops.length).toBe(2);

    const patch = plan.ops[0] as { kind: 'patch'; id: string; body: { recurrence: string[] } };
    expect(patch.kind).toBe('patch');
    expect(patch.id).toBe(FIXTURE.weeklyParent.id);
    expect(patch.body.recurrence[0]).toMatch(/UNTIL=/);

    const insert = plan.ops[1] as { kind: 'insert'; body: { recurrence: string[]; start: { dateTime: string } } };
    expect(insert.kind).toBe('insert');
    expect(insert.body.recurrence[0]).toMatch(/FREQ=WEEKLY/);
    // The new series RRULE should NOT carry the UNTIL clause.
    expect(insert.body.recurrence[0]).not.toMatch(/UNTIL=/);
    expect(insert.body.start.dateTime).toBe('2026-05-26T16:00:00.000Z');

    expect(plan.rollback).toBeDefined();
  });

  it("scope='future' rollback returns a single op that restores the original RRULE", () => {
    const plan = computeRecurringWrite({
      scope: 'future',
      event: {
        id: FIXTURE.weeklyInstance.id,
        parentId: FIXTURE.weeklyParent.id,
        etag: FIXTURE.weeklyParent.etag,
        recurrence: FIXTURE.weeklyParent.recurrence,
        startUtc: '2026-05-26T15:00:00.000Z',
      },
      change: { startUtc: '2026-05-26T16:00:00.000Z' },
    });
    const ops = plan.rollback!();
    expect(ops.length).toBe(1);
    expect(ops[0]!.kind).toBe('patch');
    expect((ops[0] as { id: string }).id).toBe(FIXTURE.weeklyParent.id);
    expect((ops[0] as { body: { recurrence: string[] } }).body.recurrence[0]).toBe(
      FIXTURE.weeklyParent.recurrence[0],
    );
  });

  it("scope='future' throws when the event has no RRULE", () => {
    expect(() =>
      computeRecurringWrite({
        scope: 'future',
        event: {
          id: FIXTURE.single.id,
          startUtc: '2026-05-20T10:00:00.000Z',
        },
        change: { startUtc: '2026-05-20T11:00:00.000Z' },
      }),
    ).toThrow(/RRULE/);
  });
});

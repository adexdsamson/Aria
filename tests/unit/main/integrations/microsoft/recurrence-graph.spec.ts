import { describe, expect, it } from 'vitest';
import { graphRecurrenceToRrule, rruleToGraphRecurrence } from '../../../../../src/main/integrations/microsoft/recurrence-graph';

describe('microsoft recurrence-graph', () => {
  it('converts a weekly Graph recurrence into RRULE form', () => {
    const converted = graphRecurrenceToRrule([
      {
        pattern: { type: 'weekly', daysOfWeek: ['monday', 'wednesday'], interval: 2 },
        range: { type: 'numbered', numberOfOccurrences: 6 },
      },
    ]);

    expect(converted.unsupported).toBe(false);
    if (converted.unsupported) return;
    expect(converted.rrule).toContain('FREQ=WEEKLY');
    expect(converted.rrule).toContain('INTERVAL=2');
    expect(converted.rrule).toContain('BYDAY=MO,WE');
    expect(converted.rrule).toContain('COUNT=6');
  });

  it('flags unsupported Graph recurrence patterns explicitly', () => {
    const converted = graphRecurrenceToRrule([
      {
        pattern: { type: 'relativeMonthly', daysOfWeek: ['monday'] },
        range: { type: 'noEnd' },
      },
    ]);

    expect(converted.unsupported).toBe(true);
    if (!converted.unsupported) return;
    expect(converted.reason).toMatch(/index/i);
  });

  it('round-trips a basic weekly RRULE back to a Graph recurrence shape', () => {
    const converted = rruleToGraphRecurrence('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE');
    expect(converted.unsupported).toBe(false);
    if (converted.unsupported) return;
    expect(converted.recurrence[0]?.pattern?.type).toBe('weekly');
    expect(converted.recurrence[0]?.pattern?.daysOfWeek).toEqual(['monday', 'wednesday']);
  });
});

import { RRule, Weekday } from 'rrule';

type GraphPatternType =
  | 'daily'
  | 'weekly'
  | 'absoluteMonthly'
  | 'relativeMonthly'
  | 'absoluteYearly'
  | 'relativeYearly';

type GraphRangeType = 'noEnd' | 'endDate' | 'numbered';

export interface GraphRecurrencePattern {
  type?: GraphPatternType | string;
  interval?: number;
  daysOfWeek?: string[];
  firstDayOfWeek?: string;
  dayOfMonth?: number;
  month?: number;
  index?: 'first' | 'second' | 'third' | 'fourth' | 'last';
}

export interface GraphRecurrenceRange {
  type?: GraphRangeType | string;
  startDate?: string;
  endDate?: string;
  numberOfOccurrences?: number;
}

export interface GraphRecurrence {
  pattern?: GraphRecurrencePattern;
  range?: GraphRecurrenceRange;
}

export interface GraphRecurrenceUnsupported {
  unsupported: true;
  reason: string;
}

export interface GraphRecurrenceSupported {
  unsupported: false;
  rrule: string;
}

export type GraphRecurrenceConversion = GraphRecurrenceSupported | GraphRecurrenceUnsupported;

export interface RruleRecurrenceSupported {
  unsupported: false;
  recurrence: GraphRecurrence[];
}

export type RruleRecurrenceConversion = RruleRecurrenceSupported | GraphRecurrenceUnsupported;

const WEEKDAY_MAP: Record<string, Weekday> = {
  monday: RRule.MO,
  tuesday: RRule.TU,
  wednesday: RRule.WE,
  thursday: RRule.TH,
  friday: RRule.FR,
  saturday: RRule.SA,
  sunday: RRule.SU,
};

const INDEX_MAP: Record<NonNullable<GraphRecurrencePattern['index']>, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  last: -1,
};

function unsupported(reason: string): GraphRecurrenceUnsupported {
  return { unsupported: true, reason };
}

function toWeekday(day: string): Weekday | null {
  const key = day.toLowerCase();
  return WEEKDAY_MAP[key] ?? null;
}

function weekdayToGraphDay(day: Weekday | number): string | null {
  const idx = typeof day === 'number'
    ? day
    : (day as unknown as { weekday?: number; n?: number }).weekday ?? (day as unknown as { n?: number }).n;
  switch (idx) {
    case 0:
      return 'monday';
    case 1:
      return 'tuesday';
    case 2:
      return 'wednesday';
    case 3:
      return 'thursday';
    case 4:
      return 'friday';
    case 5:
      return 'saturday';
    case 6:
      return 'sunday';
    default:
      return null;
  }
}

function weekdayNthFromRrule(day: Weekday | number): number | undefined {
  const n = (day as unknown as { n?: number }).n;
  return typeof n === 'number' ? n : undefined;
}

function untilFromGraphDate(date: string): Date {
  return new Date(`${date}T23:59:59.000Z`);
}

function graphPatternToRule(pattern: GraphRecurrencePattern): GraphRecurrenceConversion | RRule {
  const interval = Math.max(1, pattern.interval ?? 1);

  switch (pattern.type) {
    case 'daily':
      return new RRule({ freq: RRule.DAILY, interval });
    case 'weekly': {
      const days = pattern.daysOfWeek ?? [];
      if (days.length === 0) return unsupported('weekly recurrence missing daysOfWeek');
      const byweekday = days.map((day) => toWeekday(day)).filter(Boolean) as Weekday[];
      if (byweekday.length === 0) return unsupported(`weekly recurrence has no supported daysOfWeek: ${days.join(',')}`);
      return new RRule({
        freq: RRule.WEEKLY,
        interval,
        byweekday,
        wkst: pattern.firstDayOfWeek ? toWeekday(pattern.firstDayOfWeek) ?? undefined : undefined,
      });
    }
    case 'absoluteMonthly': {
      if (typeof pattern.dayOfMonth !== 'number') {
        return unsupported('absoluteMonthly recurrence missing dayOfMonth');
      }
      return new RRule({ freq: RRule.MONTHLY, interval, bymonthday: pattern.dayOfMonth });
    }
    case 'relativeMonthly': {
      const days = pattern.daysOfWeek ?? [];
      if (days.length !== 1) {
        return unsupported('relativeMonthly recurrence requires exactly one dayOfWeek');
      }
      const byweekday = toWeekday(days[0]!);
      if (!byweekday) return unsupported(`relativeMonthly recurrence has unsupported dayOfWeek: ${days[0]}`);
      if (!pattern.index) return unsupported('relativeMonthly recurrence missing index');
      return new RRule({
        freq: RRule.MONTHLY,
        interval,
        byweekday: [byweekday.nth(INDEX_MAP[pattern.index])],
      });
    }
    case 'absoluteYearly': {
      if (typeof pattern.month !== 'number' || typeof pattern.dayOfMonth !== 'number') {
        return unsupported('absoluteYearly recurrence missing month/dayOfMonth');
      }
      return new RRule({
        freq: RRule.YEARLY,
        interval,
        bymonth: pattern.month,
        bymonthday: pattern.dayOfMonth,
      });
    }
    case 'relativeYearly': {
      const days = pattern.daysOfWeek ?? [];
      if (days.length !== 1) {
        return unsupported('relativeYearly recurrence requires exactly one dayOfWeek');
      }
      const byweekday = toWeekday(days[0]!);
      if (!byweekday) return unsupported(`relativeYearly recurrence has unsupported dayOfWeek: ${days[0]}`);
      if (typeof pattern.month !== 'number') {
        return unsupported('relativeYearly recurrence missing month');
      }
      if (!pattern.index) return unsupported('relativeYearly recurrence missing index');
      return new RRule({
        freq: RRule.YEARLY,
        interval,
        bymonth: pattern.month,
        byweekday: [byweekday.nth(INDEX_MAP[pattern.index])],
      });
    }
    default:
      return unsupported(`unsupported recurrence pattern type: ${pattern.type ?? 'unknown'}`);
  }
}

export function graphRecurrenceToRrule(recurrence: unknown): GraphRecurrenceConversion {
  if (!Array.isArray(recurrence) || recurrence.length === 0) {
    return unsupported('empty recurrence');
  }
  if (recurrence.length !== 1) {
    return unsupported('multiple recurrence patterns are not supported');
  }
  const [entry] = recurrence as [GraphRecurrence];
  if (!entry?.pattern) {
    return unsupported('missing recurrence pattern');
  }
  const rule = graphPatternToRule(entry.pattern);
  if ('unsupported' in rule) return rule;

  const options = { ...rule.options };
  if (entry.range?.type === 'numbered') {
    if (typeof entry.range.numberOfOccurrences !== 'number') {
      return unsupported('numbered recurrence missing numberOfOccurrences');
    }
    options.count = entry.range.numberOfOccurrences;
  } else if (entry.range?.type === 'endDate') {
    if (!entry.range.endDate) return unsupported('endDate recurrence missing endDate');
    options.until = untilFromGraphDate(entry.range.endDate);
  }

  return { unsupported: false, rrule: new RRule(options).toString() };
}

export function rruleToGraphRecurrence(rrule: string): RruleRecurrenceConversion {
  try {
    const rule = RRule.fromString(rrule.replace(/^RRULE:/, ''));
    const pattern: GraphRecurrencePattern = { interval: rule.options.interval ?? 1 };

    switch (rule.options.freq) {
      case RRule.DAILY:
        pattern.type = 'daily';
        break;
      case RRule.WEEKLY: {
        const weekdays = (rule.options.byweekday ?? []) as Array<Weekday | number>;
        if (weekdays.length === 0) return unsupported('weekly RRULE missing byweekday');
        pattern.type = 'weekly';
        pattern.daysOfWeek = weekdays
          .map((day) => weekdayToGraphDay(day))
          .filter(Boolean) as string[];
        break;
      }
      case RRule.MONTHLY: {
        if (rule.options.bymonthday?.length === 1 && !rule.options.byweekday) {
          pattern.type = 'absoluteMonthly';
          pattern.dayOfMonth = rule.options.bymonthday[0]!;
          break;
        }
        const weekdays = (rule.options.byweekday ?? []) as Array<Weekday | number>;
        const nth = weekdays.length === 1 ? weekdayNthFromRrule(weekdays[0]!) : undefined;
        if (weekdays.length === 1 && nth !== undefined) {
          pattern.type = 'relativeMonthly';
          const day = weekdayToGraphDay(weekdays[0]);
          if (!day) return unsupported('relativeMonthly recurrence has unsupported weekday');
          pattern.daysOfWeek = [day];
          pattern.index = weekdayNthToIndex(nth);
          break;
        }
        return unsupported('unsupported monthly RRULE shape');
      }
      case RRule.YEARLY: {
        const month = rule.options.bymonth?.[0];
        if (!month) return unsupported('yearly RRULE missing month');
        if (rule.options.bymonthday?.length === 1 && !rule.options.byweekday) {
          pattern.type = 'absoluteYearly';
          pattern.month = month;
          pattern.dayOfMonth = rule.options.bymonthday[0]!;
          break;
        }
        const weekdays = (rule.options.byweekday ?? []) as Array<Weekday | number>;
        const nth = weekdays.length === 1 ? weekdayNthFromRrule(weekdays[0]!) : undefined;
        if (weekdays.length === 1 && nth !== undefined) {
          pattern.type = 'relativeYearly';
          pattern.month = month;
          const day = weekdayToGraphDay(weekdays[0]);
          if (!day) return unsupported('relativeYearly recurrence has unsupported weekday');
          pattern.daysOfWeek = [day];
          pattern.index = weekdayNthToIndex(nth);
          break;
        }
        return unsupported('unsupported yearly RRULE shape');
      }
      default:
        return unsupported(`unsupported RRULE frequency: ${rule.options.freq}`);
    }

    const recurrence: GraphRecurrence = { pattern };
    if (typeof rule.options.count === 'number') {
      recurrence.range = { type: 'numbered', numberOfOccurrences: rule.options.count };
    } else if (rule.options.until) {
      recurrence.range = { type: 'endDate', endDate: rule.options.until.toISOString().slice(0, 10) };
    } else {
      recurrence.range = { type: 'noEnd' };
    }

    return { unsupported: false, recurrence: [recurrence] };
  } catch (err) {
    return unsupported(err instanceof Error ? err.message : String(err));
  }
}

function weekdayNthToIndex(n: number): NonNullable<GraphRecurrencePattern['index']> | undefined {
  switch (n) {
    case 1:
      return 'first';
    case 2:
      return 'second';
    case 3:
      return 'third';
    case 4:
      return 'fourth';
    case -1:
      return 'last';
    default:
      return undefined;
  }
}

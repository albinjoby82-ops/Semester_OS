/**
 * Term-week arithmetic.
 *
 * Everything downstream depends on this: academic debt, weekly templates, the
 * overload horizon, and every "Weeks 7-9" assessment window. A bug here is
 * silent and corrupts all of it, so this module is pure, config-driven and
 * covered by tests before anything imports it.
 *
 * All arithmetic is done on UTC midnight to keep it free of timezone drift.
 * Term dates are configuration, never hardcoded logic.
 */

export interface TermConfig {
  id: string;
  label: string;
  /** ISO date (YYYY-MM-DD) of the Monday that starts teaching week 1. */
  startDate: string;
  /** Number of teaching weeks in the trimester. */
  teachingWeeks: number;
  /**
   * Teaching week numbers after which a non-teaching calendar week is
   * inserted (UCD study/review week). Empty if the term runs straight through.
   * e.g. [8] means: teaching weeks 1-8, then a break week, then week 9.
   */
  breakAfterWeeks: number[];
}

export type WeekPosition =
  | { kind: "before-term" }
  | { kind: "teaching"; week: number }
  | { kind: "break"; afterWeek: number }
  | { kind: "after-term" };

export interface DateRange {
  /** UTC midnight on the Monday. */
  start: Date;
  /** UTC midnight on the following Monday (exclusive end). */
  end: Date;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_WEEK = MS_PER_DAY * 7;

/** Parse a YYYY-MM-DD string to UTC midnight. Throws on malformed input. */
export function parseISODate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`Invalid ISO date: ${iso}`);
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC silently rolls over out-of-range parts (month 13 becomes January
  // of the next year), so verify the components survived the round trip.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  return date;
}

/** Truncate any Date to UTC midnight. */
export function toUTCMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** UTC midnight on the Monday of the calendar week containing `date`. */
export function startOfWeek(date: Date): Date {
  const day = toUTCMidnight(date);
  // getUTCDay: 0 = Sunday. Shift so Monday is 0.
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * MS_PER_DAY);
}

/**
 * Calendar-week index since the start of term, where 0 is the week containing
 * the term start date. Negative before term.
 */
function calendarWeekIndex(date: Date, config: TermConfig): number {
  const termStart = startOfWeek(parseISODate(config.startDate));
  const week = startOfWeek(date);
  return Math.round((week.getTime() - termStart.getTime()) / MS_PER_WEEK);
}

function sortedBreaks(config: TermConfig): number[] {
  return [...config.breakAfterWeeks].sort((a, b) => a - b);
}

/**
 * Map a calendar-week index to its position in the term, accounting for
 * inserted break weeks.
 */
function positionForIndex(index: number, config: TermConfig): WeekPosition {
  if (index < 0) return { kind: "before-term" };

  const breaks = sortedBreaks(config);
  let teachingWeek = 0;
  let cursor = 0;

  while (teachingWeek < config.teachingWeeks) {
    teachingWeek += 1;
    if (cursor === index) return { kind: "teaching", week: teachingWeek };
    cursor += 1;

    if (breaks.includes(teachingWeek)) {
      if (cursor === index) return { kind: "break", afterWeek: teachingWeek };
      cursor += 1;
    }
  }

  return { kind: "after-term" };
}

/** Where a given date falls in the term. */
export function weekForDate(date: Date, config: TermConfig): WeekPosition {
  return positionForIndex(calendarWeekIndex(date, config), config);
}

/**
 * The teaching week number for a date, or null if the date is outside teaching
 * (before term, during a break week, or after term). Callers that need to
 * distinguish those cases should use `weekForDate`.
 */
export function teachingWeekForDate(
  date: Date,
  config: TermConfig,
): number | null {
  const position = weekForDate(date, config);
  return position.kind === "teaching" ? position.week : null;
}

/** Calendar-week index of a given teaching week. Throws if out of range. */
function indexForTeachingWeek(week: number, config: TermConfig): number {
  if (!Number.isInteger(week) || week < 1 || week > config.teachingWeeks) {
    throw new RangeError(
      `Teaching week ${week} is outside 1..${config.teachingWeeks}`,
    );
  }
  const breaks = sortedBreaks(config);
  // Each break strictly before this week pushes it one calendar week later.
  const inserted = breaks.filter((b) => b < week).length;
  return week - 1 + inserted;
}

/** Monday-to-Monday date range for a teaching week. */
export function dateRangeForWeek(week: number, config: TermConfig): DateRange {
  const termStart = startOfWeek(parseISODate(config.startDate));
  const start = new Date(
    termStart.getTime() + indexForTeachingWeek(week, config) * MS_PER_WEEK,
  );
  return { start, end: new Date(start.getTime() + MS_PER_WEEK) };
}

/**
 * Resolve an assessment window such as "Weeks 7-9" to a date range.
 * UCD publishes ranges, not dates, so these must stay ranges until the
 * lecturer announces a real deadline.
 */
export function resolveWeekWindow(
  startWeek: number,
  endWeek: number | null | undefined,
  config: TermConfig,
): DateRange {
  const first = dateRangeForWeek(startWeek, config);
  const last = dateRangeForWeek(endWeek ?? startWeek, config);
  if (last.end < first.end) {
    throw new RangeError(`Week window ${startWeek}-${endWeek} is reversed`);
  }
  return { start: first.start, end: last.end };
}

/** Total calendar weeks the term spans, including break weeks. */
export function totalCalendarWeeks(config: TermConfig): number {
  return config.teachingWeeks + sortedBreaks(config).length;
}

/** Every teaching week number, in order. Useful for the 12-week horizon. */
export function allTeachingWeeks(config: TermConfig): number[] {
  return Array.from({ length: config.teachingWeeks }, (_, i) => i + 1);
}

/** Format a range for display, e.g. "29 Sep - 5 Oct". */
export function formatRange(range: DateRange): string {
  const fmt = new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const lastDay = new Date(range.end.getTime() - MS_PER_DAY);
  return `${fmt.format(range.start)} - ${fmt.format(lastDay)}`;
}

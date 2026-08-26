/**
 * The week grid: what is already committed, and what is left.
 *
 * Capacity answers "how many hours do I have this week". That number is a
 * total, and a total cannot tell you that the eight free hours are four
 * scattered forty-minute gaps between labs. This turns the same commitments
 * into the shape of the week, so a slot can be chosen rather than a
 * intention recorded against a day that turns out to be full.
 *
 * Pure arithmetic on local minutes-from-midnight. Converting an instant to a
 * local day and minute is the caller's job, done in the browser, because the
 * Worker runs in UTC and would place every block wrong by the offset. Keeping
 * that conversion out of here also keeps these functions deterministic
 * regardless of the machine the tests run on.
 */

/** 0 = Monday, matching the teaching week the rest of the app counts in. */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface GridBlock {
  id: string;
  dayIndex: number;
  /** Local minutes from midnight. May sit outside the visible day window. */
  startMinute: number;
  endMinute: number;
  kind: "event" | "task";
  title: string;
  moduleCode?: string | null;
}

export interface FreeSlot {
  dayIndex: number;
  startMinute: number;
  endMinute: number;
  minutes: number;
}

export interface DayPlan {
  dayIndex: number;
  /** Blocks that intersect the window, in start order. */
  blocks: GridBlock[];
  free: FreeSlot[];
  /** Committed minutes inside the window, overlaps counted once. */
  busyMinutes: number;
  freeMinutes: number;
}

export interface GridOptions {
  /** Start of the visible day, local minutes from midnight. */
  dayStartMinute: number;
  dayEndMinute: number;
  /**
   * Shortest gap worth offering. Below this a slot is real but useless: the
   * walk between buildings eats it, and offering it as somewhere to put work
   * makes the whole grid less trustworthy.
   */
  minSlotMinutes: number;
}

export const DEFAULT_GRID: GridOptions = {
  dayStartMinute: 8 * 60,
  dayEndMinute: 22 * 60,
  minSlotMinutes: 30,
};

interface Interval {
  start: number;
  end: number;
}

/**
 * Merge overlapping and touching intervals.
 *
 * Overlaps are ordinary here rather than exceptional -- a lecture and a
 * lab-report task can be booked over each other, and two calendar feeds can
 * describe the same hour. Counting that hour twice would report a day as
 * fuller than it is and hide a genuinely free slot.
 */
function mergeIntervals(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];

  for (const next of sorted) {
    const last = merged.at(-1);
    if (last && next.start <= last.end) {
      last.end = Math.max(last.end, next.end);
    } else {
      merged.push({ ...next });
    }
  }

  return merged;
}

/** Gaps left in the window once the busy intervals are removed. */
export function freeSlotsForDay(
  blocks: GridBlock[],
  dayIndex: number,
  options: GridOptions = DEFAULT_GRID,
): FreeSlot[] {
  const { dayStartMinute, dayEndMinute, minSlotMinutes } = options;

  const busy = mergeIntervals(
    blocks
      .map((b) => ({
        start: Math.max(b.startMinute, dayStartMinute),
        end: Math.min(b.endMinute, dayEndMinute),
      }))
      // A block wholly outside the window clamps to a zero or inverted span.
      .filter((i) => i.end > i.start),
  );

  const slots: FreeSlot[] = [];
  let cursor = dayStartMinute;

  for (const interval of busy) {
    if (interval.start - cursor >= minSlotMinutes) {
      slots.push({
        dayIndex,
        startMinute: cursor,
        endMinute: interval.start,
        minutes: interval.start - cursor,
      });
    }
    cursor = Math.max(cursor, interval.end);
  }

  if (dayEndMinute - cursor >= minSlotMinutes) {
    slots.push({
      dayIndex,
      startMinute: cursor,
      endMinute: dayEndMinute,
      minutes: dayEndMinute - cursor,
    });
  }

  return slots;
}

/** Committed minutes inside the window, overlaps counted once. */
export function busyMinutesForDay(
  blocks: GridBlock[],
  options: GridOptions = DEFAULT_GRID,
): number {
  return mergeIntervals(
    blocks
      .map((b) => ({
        start: Math.max(b.startMinute, options.dayStartMinute),
        end: Math.min(b.endMinute, options.dayEndMinute),
      }))
      .filter((i) => i.end > i.start),
  ).reduce((total, i) => total + (i.end - i.start), 0);
}

/** The whole week, one entry per day, Monday first. */
export function buildWeekPlan(
  blocks: GridBlock[],
  options: GridOptions = DEFAULT_GRID,
): DayPlan[] {
  return Array.from({ length: 7 }, (_unused, dayIndex) => {
    const forDay = blocks
      .filter((b) => b.dayIndex === dayIndex)
      .filter(
        (b) =>
          b.endMinute > options.dayStartMinute &&
          b.startMinute < options.dayEndMinute,
      )
      .sort((a, b) => a.startMinute - b.startMinute);

    const busyMinutes = busyMinutesForDay(forDay, options);
    const free = freeSlotsForDay(forDay, dayIndex, options);

    return {
      dayIndex,
      blocks: forDay,
      free,
      busyMinutes,
      freeMinutes: free.reduce((total, slot) => total + slot.minutes, 0),
    };
  });
}

/**
 * Where a task of a given length could go, best fit first.
 *
 * Tightest slot first rather than earliest: dropping a 30 minute task into a
 * three hour evening is how the only block long enough for the lab report
 * gets destroyed. Ties break earlier, so an equally good slot sooner in the
 * week wins.
 */
export function slotsFitting(
  plan: DayPlan[],
  minutes: number,
  fromDayIndex = 0,
): FreeSlot[] {
  return plan
    .flatMap((day) => day.free)
    .filter((slot) => slot.dayIndex >= fromDayIndex && slot.minutes >= minutes)
    .sort(
      (a, b) =>
        a.minutes - b.minutes ||
        a.dayIndex - b.dayIndex ||
        a.startMinute - b.startMinute,
    );
}

/** Total committed and free minutes across the week. */
export function weekTotals(plan: DayPlan[]): {
  busyMinutes: number;
  freeMinutes: number;
  daysWithCommitments: number;
} {
  return {
    busyMinutes: plan.reduce((t, d) => t + d.busyMinutes, 0),
    freeMinutes: plan.reduce((t, d) => t + d.freeMinutes, 0),
    daysWithCommitments: plan.filter((d) => d.busyMinutes > 0).length,
  };
}

/** "1h 30m", "45m", "2h". Minutes are never shown when they are zero. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** "09:00". Local minutes from midnight, zero-padded. */
export function formatMinuteOfDay(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

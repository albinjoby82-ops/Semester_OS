/**
 * Weekly capacity and the 12-week overload horizon.
 *
 * The point of this module is to make future crunch visible in the present.
 * Week 9 already stacks a Solid State lab report, Circuits HW3 and Circuits
 * Lab 3 -- seeing that in week 4 is what lets you pull work forward.
 *
 * Capacity is an ESTIMATE and is presented as one. It is only as good as the
 * task estimates feeding it, which is why the Phase 4 calibration multiplier
 * exists. Never render these numbers as though they were measurements.
 */

import type { TermConfig } from "./term-week";
import { allTeachingWeeks } from "./term-week";

export interface CapacityConfig {
  /**
   * Hours a week realistically available for committed work of any kind.
   * Not 168, and not waking hours: this is time that can actually be
   * allocated after sleep, meals, commuting and slack.
   */
  realisticWeeklyHours: number;
  /** Utilisation above this is flagged as overloaded. */
  overloadThreshold: number;
}

export const DEFAULT_CAPACITY: CapacityConfig = {
  realisticWeeklyHours: 60,
  overloadThreshold: 1,
};

export interface FixedBlock {
  areaId: string;
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  fromWeek: number | null;
  toWeek: number | null;
  active: boolean;
}

export interface WorkItem {
  areaId: string;
  weekNumber: number | null;
  estimatedMinutes: number | null;
  status: string;
}

export interface AssessmentWindow {
  moduleCode: string;
  title: string;
  weightPercent: number;
  dueWeek: number | null;
  dueWeekEnd: number | null;
  isSubmitted: boolean;
}

export interface AreaHours {
  areaId: string;
  hours: number;
}

export interface WeekCapacity {
  week: number;
  /** Total realistically allocatable hours. */
  realisticHours: number;
  /** Timetabled blocks: lectures, labs, meetings. */
  fixedHours: number;
  /** What is left once fixed commitments are taken out. */
  freeHours: number;
  /** Estimated hours of open task work landing in this week. */
  committedHours: number;
  byArea: AreaHours[];
  /** committedHours / freeHours. Above 1 means the week does not fit. */
  utilisation: number;
  overloaded: boolean;
  /** Assessment weight falling in this week, for the horizon shading. */
  assessmentWeight: number;
  assessments: string[];
}

const isBlockActiveInWeek = (block: FixedBlock, week: number): boolean =>
  block.active &&
  (block.fromWeek == null || week >= block.fromWeek) &&
  (block.toWeek == null || week <= block.toWeek);

/** Timetabled hours in a given teaching week. */
export function fixedHoursForWeek(
  blocks: readonly FixedBlock[],
  week: number,
): number {
  let minutes = 0;
  for (const block of blocks) {
    if (!isBlockActiveInWeek(block, week)) continue;
    minutes += Math.max(0, block.endMinute - block.startMinute);
  }
  return minutes / 60;
}

const OPEN = new Set(["todo", "in_progress"]);

/**
 * Assessment weight landing in each week. A window such as "Weeks 3-5" is
 * spread across the weeks it covers rather than spiking the first one.
 */
export function assessmentWeightByWeek(
  assessments: readonly AssessmentWindow[],
): Map<number, { weight: number; items: string[] }> {
  const result = new Map<number, { weight: number; items: string[] }>();

  for (const a of assessments) {
    if (a.dueWeek == null || a.isSubmitted) continue;
    const last = a.dueWeekEnd ?? a.dueWeek;
    const span = Math.max(1, last - a.dueWeek + 1);
    const perWeek = a.weightPercent / span;

    for (let week = a.dueWeek; week <= last; week += 1) {
      const entry = result.get(week) ?? { weight: 0, items: [] };
      entry.weight += perWeek;
      entry.items.push(`${a.moduleCode} ${a.title} (${a.weightPercent}%)`);
      result.set(week, entry);
    }
  }
  return result;
}

export function capacityForWeek(
  week: number,
  options: {
    blocks: readonly FixedBlock[];
    items: readonly WorkItem[];
    assessments: readonly AssessmentWindow[];
    config?: CapacityConfig;
  },
): WeekCapacity {
  const config = options.config ?? DEFAULT_CAPACITY;
  const fixedHours = fixedHoursForWeek(options.blocks, week);
  const freeHours = Math.max(0, config.realisticWeeklyHours - fixedHours);

  const byAreaMap = new Map<string, number>();
  let committedMinutes = 0;

  for (const item of options.items) {
    if (item.weekNumber !== week) continue;
    if (!OPEN.has(item.status)) continue;
    const minutes = item.estimatedMinutes ?? 0;
    committedMinutes += minutes;
    byAreaMap.set(item.areaId, (byAreaMap.get(item.areaId) ?? 0) + minutes);
  }

  const weightMap = assessmentWeightByWeek(options.assessments);
  const weightEntry = weightMap.get(week);
  const committedHours = committedMinutes / 60;

  return {
    week,
    realisticHours: config.realisticWeeklyHours,
    fixedHours,
    freeHours,
    committedHours,
    byArea: [...byAreaMap.entries()]
      .map(([areaId, minutes]) => ({ areaId, hours: minutes / 60 }))
      .sort((a, b) => b.hours - a.hours),
    // A week with no free hours left is fully utilised by definition, not
    // divide-by-zero undefined.
    utilisation: freeHours > 0 ? committedHours / freeHours : committedHours > 0 ? Infinity : 0,
    overloaded:
      freeHours > 0
        ? committedHours / freeHours > config.overloadThreshold
        : committedHours > 0,
    assessmentWeight: weightEntry?.weight ?? 0,
    assessments: weightEntry?.items ?? [],
  };
}

/** Capacity across every teaching week: the overload horizon. */
export function buildHorizon(
  term: TermConfig,
  options: {
    blocks: readonly FixedBlock[];
    items: readonly WorkItem[];
    assessments: readonly AssessmentWindow[];
    config?: CapacityConfig;
  },
): WeekCapacity[] {
  return allTeachingWeeks(term).map((week) =>
    capacityForWeek(week, options),
  );
}

export interface OverloadWarning {
  week: number;
  utilisationPercent: number;
  message: string;
}

/**
 * Weeks that do not fit. Warn, never block -- the user decides, the app is
 * only responsible for making the trade-off visible.
 */
export function overloadedWeeks(
  horizon: readonly WeekCapacity[],
): OverloadWarning[] {
  return horizon
    .filter((week) => week.overloaded)
    .map((week) => ({
      week: week.week,
      utilisationPercent: Math.round(week.utilisation * 100),
      message: `Week ${week.week} is at ~${Math.round(week.utilisation * 100)}% of realistic capacity (${week.committedHours.toFixed(1)}h of work, ${week.freeHours.toFixed(1)}h free).`,
    }));
}

/**
 * What adding a task would do to a week. Shown before the task is saved so
 * the trade-off is visible, but it never prevents the save.
 */
export function projectAddition(
  week: WeekCapacity,
  addedMinutes: number,
): { utilisation: number; message: string | null } {
  if (week.freeHours <= 0) {
    return {
      utilisation: Infinity,
      message: `Week ${week.week} has no free hours left after fixed commitments.`,
    };
  }
  const utilisation =
    (week.committedHours + addedMinutes / 60) / week.freeHours;

  return {
    utilisation,
    message:
      utilisation > 1
        ? `This puts Week ${week.week} at ~${Math.round(utilisation * 100)}% of realistic capacity.`
        : null,
  };
}

/**
 * UCD's stated effort versus what a week can actually hold.
 *
 * Across the six Autumn modules this is 678h, about 57h/week of university
 * work alone. Showing the gap honestly in week one is the point; implying it
 * is all achievable would make every downstream number a lie.
 */
export function effortBudget(
  totalStatedHours: number,
  term: TermConfig,
  config: CapacityConfig = DEFAULT_CAPACITY,
): {
  statedPerWeek: number;
  realisticHours: number;
  gapPerWeek: number;
  feasible: boolean;
} {
  const statedPerWeek = totalStatedHours / term.teachingWeeks;
  return {
    statedPerWeek,
    realisticHours: config.realisticWeeklyHours,
    gapPerWeek: statedPerWeek - config.realisticWeeklyHours,
    feasible: statedPerWeek <= config.realisticWeeklyHours,
  };
}

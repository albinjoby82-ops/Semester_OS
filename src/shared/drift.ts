/**
 * Anti-drift: keeping university from quietly losing to extracurriculars.
 *
 * The model is friction and a visible record, never a block. A lockout gets
 * resented and bypassed within a fortnight. What works is making drift
 * impossible to NOT notice, measured against the allocation the user set
 * themselves in Plan Week -- much harder to argue with, and not patronising.
 *
 * Every message here is factual. No lectures, no nagging, no streaks.
 */

export interface Allocation {
  areaId: string;
  plannedHours: number;
}

export interface ActualHours {
  areaId: string;
  hours: number;
}

export interface AreaDrift {
  areaId: string;
  plannedHours: number;
  actualHours: number;
  /** actual - planned. Positive means over your own allocation. */
  deltaHours: number;
  /** Share of the allocation used, 0-1+. Null when nothing was allocated. */
  progress: number | null;
  /** Over the allocation for this area. */
  overAllocation: boolean;
}

export interface DriftReport {
  byArea: AreaDrift[];
  /** Days remaining in the week, including today. */
  daysLeft: number;
  /** Hours of university work still owed against the allocation. */
  universityShortfall: number;
  /** Hours logged beyond allocation across non-university areas. */
  extracurricularOverage: number;
  /** Single factual line for Today. Null when nothing is worth saying. */
  message: string | null;
}

const round = (value: number): number => Math.round(value * 10) / 10;

const formatHours = (hours: number): string =>
  Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** Days remaining in the current week, counting today. Monday-start weeks. */
export function daysLeftInWeek(now: Date): number {
  const dayIndex = (now.getDay() + 6) % 7; // 0 = Monday
  return 7 - dayIndex;
}

export function computeDrift(
  allocations: readonly Allocation[],
  actuals: readonly ActualHours[],
  options: { now?: Date; universityAreaId?: string } = {},
): DriftReport {
  const now = options.now ?? new Date();
  const universityAreaId = options.universityAreaId ?? "university";

  const actualByArea = new Map(actuals.map((a) => [a.areaId, a.hours]));
  const areaIds = new Set([
    ...allocations.map((a) => a.areaId),
    ...actuals.map((a) => a.areaId),
  ]);

  const byArea: AreaDrift[] = [...areaIds].map((areaId) => {
    const plannedHours =
      allocations.find((a) => a.areaId === areaId)?.plannedHours ?? 0;
    const actualHours = actualByArea.get(areaId) ?? 0;
    return {
      areaId,
      plannedHours,
      actualHours,
      deltaHours: round(actualHours - plannedHours),
      progress: plannedHours > 0 ? actualHours / plannedHours : null,
      overAllocation: plannedHours > 0 && actualHours > plannedHours,
    };
  });

  const university = byArea.find((a) => a.areaId === universityAreaId);
  const universityShortfall = university
    ? Math.max(0, round(university.plannedHours - university.actualHours))
    : 0;

  const extracurricularOverage = round(
    byArea
      .filter((a) => a.areaId !== universityAreaId)
      .reduce((sum, a) => sum + Math.max(0, a.deltaHours), 0),
  );

  const daysLeft = daysLeftInWeek(now);

  return {
    byArea: byArea.sort((a, b) => b.actualHours - a.actualHours),
    daysLeft,
    universityShortfall,
    extracurricularOverage,
    message: buildMessage({
      now,
      byArea,
      university,
      universityShortfall,
      extracurricularOverage,
      daysLeft,
    }),
  };
}

function buildMessage(input: {
  now: Date;
  byArea: AreaDrift[];
  university: AreaDrift | undefined;
  universityShortfall: number;
  extracurricularOverage: number;
  daysLeft: number;
}): string | null {
  const { university, universityShortfall, daysLeft, now } = input;
  if (!university || university.plannedHours <= 0) return null;

  const today = DAY_NAMES[now.getDay()];
  const others = input.byArea
    .filter((a) => a.areaId !== university.areaId && a.actualHours > 0)
    .sort((a, b) => b.actualHours - a.actualHours);

  if (universityShortfall <= 0) {
    return `${today}. University allocation met (${formatHours(round(university.actualHours))} of ${formatHours(university.plannedHours)}).`;
  }

  // Show the side-by-side whenever university is behind and real time went
  // elsewhere -- not only when the extracurricular number is the larger one.
  // "GaelForce 9h / University 11h" is exactly the comparison worth seeing
  // while university is 9h short, even though university leads on raw hours.
  const leader = others[0];
  if (leader) {
    return `${today}. ${labelFor(leader.areaId)} ${formatHours(round(leader.actualHours))} / University ${formatHours(round(university.actualHours))}. You planned ${formatHours(university.plannedHours)} University — ${formatHours(universityShortfall)} short with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`;
  }

  return `${today}. University ${formatHours(round(university.actualHours))} of ${formatHours(university.plannedHours)} planned — ${formatHours(universityShortfall)} short with ${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`;
}

const labelFor = (areaId: string): string =>
  areaId.charAt(0).toUpperCase() + areaId.slice(1);

export interface WeeklyActuals {
  weekNumber: number;
  actuals: ActualHours[];
}

export interface TrailingRatio {
  weeks: number[];
  universityHours: number;
  extracurricularHours: number;
  /** University share of tracked hours, 0-1. Null when nothing is tracked. */
  universityShare: number | null;
  /** True when extracurricular work has outweighed university work. */
  sustainedDrift: boolean;
  message: string | null;
}

/**
 * Trailing multi-week ratio. One extracurricular-heavy week is fine; three in
 * a row is a pattern, and the single-week view cannot see it.
 */
export function trailingRatio(
  history: readonly WeeklyActuals[],
  options: { weeks?: number; universityAreaId?: string } = {},
): TrailingRatio {
  const windowSize = options.weeks ?? 3;
  const universityAreaId = options.universityAreaId ?? "university";

  const recent = [...history]
    .sort((a, b) => b.weekNumber - a.weekNumber)
    .slice(0, windowSize);

  let universityHours = 0;
  let extracurricularHours = 0;

  for (const week of recent) {
    for (const actual of week.actuals) {
      if (actual.areaId === universityAreaId) universityHours += actual.hours;
      else extracurricularHours += actual.hours;
    }
  }

  const tracked = universityHours + extracurricularHours;
  const universityShare = tracked > 0 ? universityHours / tracked : null;
  const sustainedDrift =
    recent.length >= windowSize && tracked > 0 && universityHours < extracurricularHours;

  return {
    weeks: recent.map((w) => w.weekNumber).sort((a, b) => a - b),
    universityHours: round(universityHours),
    extracurricularHours: round(extracurricularHours),
    universityShare,
    sustainedDrift,
    message: sustainedDrift
      ? `Across weeks ${recent.map((w) => w.weekNumber).sort((a, b) => a - b).join(", ")}, extracurricular work has taken more hours than university work (${formatHours(round(extracurricularHours))} vs ${formatHours(round(universityHours))}).`
      : null,
  };
}

export interface OverrideCheck {
  required: boolean;
  areaId: string;
  overageHours: number;
  message: string | null;
}

/**
 * Whether adding work to an area exceeds the allocation the user set.
 *
 * When it does, saving costs one line of reason, which is logged. It is never
 * blocked -- the friction exists so the choice is deliberate and visible
 * later, not so it can be prevented.
 */
export function checkOverride(
  areaId: string,
  addedHours: number,
  allocations: readonly Allocation[],
  actuals: readonly ActualHours[],
  options: { universityAreaId?: string } = {},
): OverrideCheck {
  const universityAreaId = options.universityAreaId ?? "university";

  // University is the protected floor, never the thing being capped.
  if (areaId === universityAreaId) {
    return { required: false, areaId, overageHours: 0, message: null };
  }

  const planned =
    allocations.find((a) => a.areaId === areaId)?.plannedHours ?? 0;
  if (planned <= 0) {
    return { required: false, areaId, overageHours: 0, message: null };
  }

  const actual = actuals.find((a) => a.areaId === areaId)?.hours ?? 0;
  const projected = actual + addedHours;
  if (projected <= planned) {
    return { required: false, areaId, overageHours: 0, message: null };
  }

  const overageHours = round(projected - planned);
  return {
    required: true,
    areaId,
    overageHours,
    message: `This puts ${labelFor(areaId)} at ${formatHours(round(projected))} against the ${formatHours(planned)} you allocated this week.`,
  };
}

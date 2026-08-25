/**
 * "What should I do next?" — deterministic, explainable ranking.
 *
 * No LLM, no hidden weighting. Every score is the sum of named components,
 * and the reason shown to the user is generated FROM those components rather
 * than written separately, so the explanation cannot drift away from the
 * maths that produced the ranking. A recommendation the user cannot
 * interrogate is one they stop trusting.
 *
 * Duration affects FIT, not importance (brief section 8): with 40 minutes
 * before a lecture, a 30-minute high-value task beats a 2-hour one. That is a
 * demotion, never an exclusion -- if nothing fits, the most important thing
 * is still the most important thing.
 */

import type { TermConfig } from "./term-week";

export interface Candidate {
  id: string;
  title: string;
  areaId: string;
  moduleId: string | null;
  assignmentId: string | null;
  status: string;
  dueAt: string | null;
  estimatedMinutes: number | null;
  isRequiredWeekly: boolean;
  priorityOverride: number | null;
  deferredAt: string | null;
}

export interface ScoringContext {
  now?: Date;
  term: TermConfig;
  /** moduleId -> share of that module's grade behind schedule, 0-100. */
  moduleRisk?: Map<string, number>;
  /** moduleId -> display code, for readable reasons. */
  moduleCode?: Map<string, string>;
  /** taskId -> weight of the assessment it belongs to, 0-100. */
  assessmentWeight?: Map<string, number>;
  /** moduleId -> when that module was last worked on. */
  lastWorked?: Map<string, Date>;
  /** Minutes until the next fixed commitment. Null when nothing is next. */
  minutesAvailable?: number | null;
  /** True when any university module is behind schedule. */
  universityAtRisk?: boolean;
  /** Area treated as the protected floor. */
  universityAreaId?: string;
}

export interface ScoreComponent {
  key: string;
  /** Human-readable fragment used to build the reason. */
  label: string;
  points: number;
}

export interface ScoredTask {
  task: Candidate;
  score: number;
  components: ScoreComponent[];
  /** False when the task will not fit before the next commitment. */
  fits: boolean;
  /** Multipliers applied after scoring, each with a stated cause. */
  adjustments: ScoreComponent[];
  reason: string;
}

/**
 * Component weights, from brief section 8. Each factor is normalised to 0-1
 * first so the weights are directly comparable and the ceiling is knowable
 * (38 before overrides).
 */
export const WEIGHTS = {
  overdue: 12,
  urgency: 8,
  assessmentWeight: 5,
  moduleRisk: 6,
  weeklyRequirement: 4,
  neglect: 3,
} as const;

/** Beyond this many days overdue, the factor is maxed. */
const OVERDUE_SATURATION_DAYS = 7;
/** Work due further out than this contributes no urgency yet. */
const URGENCY_HORIZON_DAYS = 7;
/** An assessment at or above this weight maxes the weight factor. */
const WEIGHT_SATURATION = 40;
/** Days without touching a module before neglect is maxed. */
const NEGLECT_SATURATION_DAYS = 10;

/** Applied when a task cannot fit the time available before the next event. */
const DOES_NOT_FIT_MULTIPLIER = 0.5;
/** Applied to extracurricular work while a university module is behind. */
const RED_LINE_MULTIPLIER = 0.6;

const MS_PER_DAY = 86_400_000;

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const daysBetween = (from: Date, to: Date): number =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY);

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const OPEN = new Set(["todo", "in_progress"]);

export function scoreTask(
  task: Candidate,
  context: ScoringContext,
): ScoredTask {
  const now = context.now ?? new Date();
  const universityAreaId = context.universityAreaId ?? "university";
  const components: ScoreComponent[] = [];

  const daysAway = task.dueAt ? daysBetween(now, new Date(task.dueAt)) : null;

  // Overdue work is MAXIMALLY urgent by definition, so it carries the full
  // urgency weight plus an escalation for how late it is. Scoring overdue
  // work as a small standalone factor would rank a task that is already late
  // below one merely due tomorrow, which inverts the whole point.
  //
  // The escalation saturates so a task forgotten for a month cannot pin
  // itself to the top of the list forever.
  if (daysAway != null && daysAway < 0) {
    const overdueDays = Math.abs(daysAway);
    const factor = clamp01(overdueDays / OVERDUE_SATURATION_DAYS);
    components.push({
      key: "overdue",
      label:
        overdueDays === 1 ? "it is a day overdue" : `it is ${overdueDays} days overdue`,
      points: WEIGHTS.urgency + factor * WEIGHTS.overdue,
    });
  }

  // Deadline urgency, for work not yet late.
  if (daysAway != null && daysAway >= 0) {
    const factor = clamp01((URGENCY_HORIZON_DAYS - daysAway) / URGENCY_HORIZON_DAYS);
    if (factor > 0) {
      components.push({
        key: "urgency",
        label:
          daysAway === 0
            ? "it is due today"
            : daysAway === 1
              ? "it is due tomorrow"
              : `it is due in ${daysAway} days`,
        points: factor * WEIGHTS.urgency,
      });
    }
  }

  // What the assessment is worth.
  const weight = task.assignmentId
    ? (context.assessmentWeight?.get(task.id) ?? 0)
    : 0;
  if (weight > 0) {
    components.push({
      key: "assessmentWeight",
      label: `it is worth ${weight}%`,
      points: clamp01(weight / WEIGHT_SATURATION) * WEIGHTS.assessmentWeight,
    });
  }

  // Module already behind schedule.
  const risk = task.moduleId ? (context.moduleRisk?.get(task.moduleId) ?? 0) : 0;
  if (risk > 0) {
    const code = task.moduleId
      ? (context.moduleCode?.get(task.moduleId) ?? "this module")
      : "this module";
    components.push({
      key: "moduleRisk",
      label: `${code} is falling behind`,
      points: clamp01(risk / 100) * WEIGHTS.moduleRisk,
    });
  }

  // Mandatory weekly work.
  if (task.isRequiredWeekly) {
    components.push({
      key: "weeklyRequirement",
      label: "it is required weekly work",
      points: WEIGHTS.weeklyRequirement,
    });
  }

  // Neglected module.
  const lastWorked = task.moduleId
    ? context.lastWorked?.get(task.moduleId)
    : undefined;
  if (task.moduleId && lastWorked) {
    const days = daysBetween(lastWorked, now);
    const factor = clamp01(days / NEGLECT_SATURATION_DAYS);
    if (factor > 0) {
      const code = context.moduleCode?.get(task.moduleId) ?? "this module";
      components.push({
        key: "neglect",
        label: `${code} has not been touched in ${days} day${days === 1 ? "" : "s"}`,
        points: factor * WEIGHTS.neglect,
      });
    }
  }

  // Explicit user override, added directly and never scaled.
  if (task.priorityOverride) {
    components.push({
      key: "override",
      label: "you marked it a priority",
      points: task.priorityOverride,
    });
  }

  const base = components.reduce((sum, c) => sum + c.points, 0);

  // Adjustments are multiplicative and always explained.
  const adjustments: ScoreComponent[] = [];
  let score = base;

  const available = context.minutesAvailable;
  const fits =
    available == null ||
    task.estimatedMinutes == null ||
    task.estimatedMinutes <= available;

  if (!fits) {
    score *= DOES_NOT_FIT_MULTIPLIER;
    adjustments.push({
      key: "doesNotFit",
      label: `it needs longer than the ${available} minutes you have before your next commitment`,
      points: score - base,
    });
  }

  const isExtracurricular = task.areaId !== universityAreaId;
  if (isExtracurricular && context.universityAtRisk) {
    const before = score;
    score *= RED_LINE_MULTIPLIER;
    adjustments.push({
      key: "redLine",
      label: "university work is behind, so extracurricular work is ranked lower",
      points: score - before,
    });
  }

  return {
    task,
    score,
    components: [...components].sort((a, b) => b.points - a.points),
    fits,
    adjustments,
    reason: buildReason(components, adjustments),
  };
}

/**
 * The reason, built from the highest-scoring components. Capped at three so
 * it stays a sentence rather than an audit log; the full breakdown is
 * available on the ScoredTask for anyone who wants it.
 */
function buildReason(
  components: readonly ScoreComponent[],
  adjustments: readonly ScoreComponent[],
): string {
  const top = [...components]
    .sort((a, b) => b.points - a.points)
    .filter((c) => c.points > 0)
    .slice(0, 3)
    .map((c) => c.label);

  if (top.length === 0) {
    return "Nothing else is competing for your attention right now.";
  }

  const joined =
    top.length === 1
      ? top[0]!
      : `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;

  const caveat = adjustments.find((a) => a.key === "doesNotFit");
  return caveat
    ? `Recommended because ${joined}. Note that ${caveat.label}.`
    : `Recommended because ${joined}.`;
}

/** Every open task, ranked. Deferred and finished work is excluded. */
export function rankTasks(
  candidates: readonly Candidate[],
  context: ScoringContext,
): ScoredTask[] {
  return candidates
    .filter((task) => OPEN.has(task.status) && !task.deferredAt)
    .map((task) => scoreTask(task, context))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tie-break: a task that fits beats one that does not,
      // then the shorter task, then id -- so the same inputs always give the
      // same answer.
      if (a.fits !== b.fits) return a.fits ? -1 : 1;
      const aMinutes = a.task.estimatedMinutes ?? Number.MAX_SAFE_INTEGER;
      const bMinutes = b.task.estimatedMinutes ?? Number.MAX_SAFE_INTEGER;
      if (aMinutes !== bMinutes) return aMinutes - bMinutes;
      return a.task.id.localeCompare(b.task.id);
    });
}

/** The single next action, or null when there is nothing open. */
export function recommendNext(
  candidates: readonly Candidate[],
  context: ScoringContext,
): ScoredTask | null {
  return rankTasks(candidates, context)[0] ?? null;
}

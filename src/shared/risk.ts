/**
 * Module risk, expressed as weight-at-risk rather than a health percentage.
 *
 * "30% of this module's grade is behind schedule" is actionable and comparable
 * across modules. "67% health" is neither. Health survives only as the
 * traffic-light colour; this is the number.
 *
 * Every risk carries a stated reason. A recommendation the user cannot
 * interrogate is one they will stop trusting.
 */

import type { TermConfig } from "./term-week";
import { dateRangeForWeek } from "./term-week";

export interface RiskAssessment {
  id: string;
  title: string;
  weightPercent: number;
  dueWeek: number | null;
  dueWeekEnd: number | null;
  dueAt: string | null;
  isExam: boolean;
  isSubmitted: boolean;
  startedAt: string | null;
  mainWorkDoneAt: string | null;
  estimatedMinutes: number | null;
}

export type RiskLevel = "none" | "watch" | "at-risk";

export interface AssessmentRisk {
  id: string;
  title: string;
  weightPercent: number;
  level: RiskLevel;
  reason: string;
  /** The last date work can start and still fit. Null if not computable. */
  latestSafeStart: Date | null;
  /** Effective deadline: a pinned date if known, else the end of the window. */
  effectiveDue: Date | null;
  daysUntilDue: number | null;
  hasStarted: boolean;
}

const MS_PER_DAY = 86_400_000;

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const wholeDaysBetween = (from: Date, to: Date): number =>
  Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY,
  );

/**
 * The deadline to plan against. A lecturer-announced date wins; otherwise the
 * end of the published UCD window, because "Weeks 7-9" means you are late if
 * you have not moved by the end of week 9.
 */
export function effectiveDueDate(
  assessment: RiskAssessment,
  term: TermConfig,
): Date | null {
  if (assessment.dueAt) return new Date(assessment.dueAt);
  if (assessment.dueWeek == null) return null;

  const lastWeek = assessment.dueWeekEnd ?? assessment.dueWeek;
  try {
    // The window's last day, not the Monday after it.
    return new Date(dateRangeForWeek(lastWeek, term).end.getTime() - MS_PER_DAY);
  } catch {
    return null;
  }
}

/**
 * The latest date work can start and still finish in time, given how much free
 * time there realistically is per day.
 *
 * Turns "due 15 Oct" into "start by 2 Oct", which is the actionable form.
 */
export function latestSafeStart(
  assessment: RiskAssessment,
  due: Date | null,
  freeHoursPerDay: number,
): Date | null {
  if (!due) return null;

  // With no estimate, fall back to a weight-scaled default: a 10% lab report
  // is not a 60% exam's worth of preparation.
  const estimatedHours =
    (assessment.estimatedMinutes ?? defaultMinutesForWeight(assessment)) / 60;

  if (freeHoursPerDay <= 0) return null;
  const daysNeeded = Math.ceil(estimatedHours / freeHoursPerDay);

  const start = startOfDay(due);
  start.setDate(start.getDate() - daysNeeded);
  return start;
}

/**
 * Rough effort default when nothing is estimated yet, scaled by what the
 * assessment is worth. Deliberately conservative: under-estimating here
 * produces a start date that is too late, which is the harmful direction.
 */
function defaultMinutesForWeight(assessment: RiskAssessment): number {
  const perWeightPoint = assessment.isExam ? 60 : 30;
  return Math.max(60, assessment.weightPercent * perWeightPoint);
}

export function assessRisk(
  assessment: RiskAssessment,
  options: {
    term: TermConfig;
    now?: Date;
    freeHoursPerDay?: number;
  },
): AssessmentRisk {
  const now = options.now ?? new Date();
  const freeHoursPerDay = options.freeHoursPerDay ?? 3;
  const due = effectiveDueDate(assessment, options.term);
  const safeStart = latestSafeStart(assessment, due, freeHoursPerDay);
  const hasStarted = Boolean(assessment.startedAt ?? assessment.mainWorkDoneAt);
  const daysUntilDue = due ? wholeDaysBetween(now, due) : null;

  const base = {
    id: assessment.id,
    title: assessment.title,
    weightPercent: assessment.weightPercent,
    latestSafeStart: safeStart,
    effectiveDue: due,
    daysUntilDue,
    hasStarted,
  };

  if (assessment.isSubmitted) {
    return { ...base, level: "none", reason: "Submitted." };
  }

  // Past the deadline and not submitted: the clearest possible risk.
  if (daysUntilDue != null && daysUntilDue < 0) {
    return {
      ...base,
      level: "at-risk",
      // State the weight: "overdue" alone does not distinguish a 5% homework
      // from a 20% midterm, and that difference is the whole point.
      reason: `Worth ${assessment.weightPercent}% and overdue by ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) === 1 ? "" : "s"}, not submitted.`,
    };
  }

  // Work done but not submitted. Complete != submitted.
  if (assessment.mainWorkDoneAt && !assessment.isSubmitted) {
    return {
      ...base,
      level: "watch",
      reason: "Work is done but it has not been submitted.",
    };
  }

  // Past the point where starting still comfortably fits.
  if (safeStart && !hasStarted && startOfDay(now) > safeStart) {
    const daysLate = wholeDaysBetween(safeStart, now);
    return {
      ...base,
      level: "at-risk",
      reason: `Worth ${assessment.weightPercent}% and not started — the comfortable start date was ${daysLate} day${daysLate === 1 ? "" : "s"} ago.`,
    };
  }

  // Approaching the start date without having started.
  if (safeStart && !hasStarted) {
    const daysToStart = wholeDaysBetween(now, safeStart);
    if (daysToStart <= 3) {
      return {
        ...base,
        level: "watch",
        reason:
          daysToStart <= 0
            ? `Worth ${assessment.weightPercent}% — start today to stay comfortable.`
            : `Worth ${assessment.weightPercent}% — start within ${daysToStart} day${daysToStart === 1 ? "" : "s"}.`,
      };
    }
  }

  return {
    ...base,
    level: "none",
    reason: hasStarted ? "In progress and on schedule." : "Not yet due to start.",
  };
}

export interface ModuleRisk {
  atRiskWeight: number;
  watchWeight: number;
  totalWeight: number;
  /** Share of the module's grade currently behind schedule, 0-100. */
  percentAtRisk: number;
  level: RiskLevel;
  risks: AssessmentRisk[];
  /** The single most important thing wrong, for the module card. */
  headline: string | null;
}

export function assessModule(
  assessments: readonly RiskAssessment[],
  options: { term: TermConfig; now?: Date; freeHoursPerDay?: number },
): ModuleRisk {
  const risks = assessments.map((a) => assessRisk(a, options));

  let atRiskWeight = 0;
  let watchWeight = 0;
  let totalWeight = 0;

  for (const risk of risks) {
    totalWeight += risk.weightPercent;
    if (risk.level === "at-risk") atRiskWeight += risk.weightPercent;
    if (risk.level === "watch") watchWeight += risk.weightPercent;
  }

  const level: RiskLevel =
    atRiskWeight > 0 ? "at-risk" : watchWeight > 0 ? "watch" : "none";

  // Headline is the heaviest problem, not the first one found.
  const headline =
    risks
      .filter((r) => r.level !== "none")
      .sort((a, b) => {
        if (a.level !== b.level) return a.level === "at-risk" ? -1 : 1;
        return b.weightPercent - a.weightPercent;
      })[0] ?? null;

  return {
    atRiskWeight,
    watchWeight,
    totalWeight,
    percentAtRisk: totalWeight > 0 ? (atRiskWeight / totalWeight) * 100 : 0,
    level,
    risks,
    headline: headline ? `${headline.title}: ${headline.reason}` : null,
  };
}

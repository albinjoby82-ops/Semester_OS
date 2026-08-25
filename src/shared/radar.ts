/**
 * Assessment radar: what is coming, ordered by when and how much it matters.
 *
 * Assessed work must be impossible to forget, so this deliberately includes
 * work that is already overdue rather than quietly dropping it off the front
 * of the list.
 */

import { assessRisk, effectiveDueDate, type AssessmentRisk, type RiskAssessment } from "./risk";
import type { TermConfig } from "./term-week";

export interface RadarModule {
  code: string;
  name: string;
  colorToken: string;
  assessments: RiskAssessment[];
}

export interface RadarItem {
  id: string;
  moduleCode: string;
  moduleName: string;
  colorToken: string;
  title: string;
  weightPercent: number;
  isExam: boolean;
  isSubmitted: boolean;
  /** Null for undated end-of-trimester exams. */
  due: Date | null;
  daysAway: number | null;
  /** True when only a UCD week window is known, not a real date. */
  isWindowOnly: boolean;
  risk: AssessmentRisk;
}

const MS_PER_DAY = 86_400_000;

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Upcoming assessed work within the horizon.
 *
 * Overdue-but-unsubmitted items are always included regardless of how far
 * past they are: the whole point is that assessed work cannot slip away.
 */
export function buildRadar(
  modules: readonly RadarModule[],
  options: {
    term: TermConfig;
    now?: Date;
    /** How far ahead to look. The brief's radar shows 14 days. */
    days?: number;
    freeHoursPerDay?: number;
    includeUndated?: boolean;
  },
): RadarItem[] {
  const now = options.now ?? new Date();
  const horizonDays = options.days ?? 14;
  const items: RadarItem[] = [];

  for (const module of modules) {
    for (const assessment of module.assessments) {
      const due = effectiveDueDate(assessment, options.term);
      const risk = assessRisk(assessment, {
        term: options.term,
        now,
        freeHoursPerDay: options.freeHoursPerDay,
      });

      const daysAway =
        due == null
          ? null
          : Math.round(
              (startOfDay(due).getTime() - startOfDay(now).getTime()) /
                MS_PER_DAY,
            );

      if (due == null) {
        // Undated exams have no place on a 14-day radar, but they must still
        // be reachable -- the caller opts in.
        if (!options.includeUndated || assessment.isSubmitted) continue;
      } else {
        if (assessment.isSubmitted) continue;
        // Past work stays visible; future work only within the horizon.
        if (daysAway !== null && daysAway > horizonDays) continue;
      }

      items.push({
        id: assessment.id,
        moduleCode: module.code,
        moduleName: module.name,
        colorToken: module.colorToken,
        title: assessment.title,
        weightPercent: assessment.weightPercent,
        isExam: assessment.isExam,
        isSubmitted: assessment.isSubmitted,
        due,
        daysAway,
        isWindowOnly: assessment.dueAt == null && assessment.dueWeek != null,
        risk,
      });
    }
  }

  return items.sort(compareRadarItems);
}

/** Soonest first; undated last; ties broken by weight, because 20% > 5%. */
function compareRadarItems(a: RadarItem, b: RadarItem): number {
  if (a.due && b.due) {
    const diff = a.due.getTime() - b.due.getTime();
    if (diff !== 0) return diff;
    return b.weightPercent - a.weightPercent;
  }
  if (a.due) return -1;
  if (b.due) return 1;
  return b.weightPercent - a.weightPercent;
}

/** The six stages an assessment moves through. Submitted is not the last one. */
export const SUBMISSION_STAGES = [
  { key: "readBriefAt", label: "Read brief" },
  { key: "startedAt", label: "Started" },
  { key: "mainWorkDoneAt", label: "Main work complete" },
  { key: "checkedAt", label: "Checked" },
  { key: "isSubmitted", label: "Submitted" },
  { key: "submissionVerifiedAt", label: "Submission verified" },
] as const;

export type StageKey = (typeof SUBMISSION_STAGES)[number]["key"];

export interface StageState {
  key: StageKey;
  label: string;
  done: boolean;
}

/**
 * Checklist state. Stages are independent flags rather than a single status
 * column, because real work does not always move in order -- and because
 * "submitted" must never be inferred from "the work is finished".
 */
export function stageStates(assessment: {
  readBriefAt: string | null;
  startedAt: string | null;
  mainWorkDoneAt: string | null;
  checkedAt: string | null;
  isSubmitted: boolean;
  submissionVerifiedAt: string | null;
}): StageState[] {
  return SUBMISSION_STAGES.map((stage) => ({
    key: stage.key,
    label: stage.label,
    done:
      stage.key === "isSubmitted"
        ? assessment.isSubmitted
        : Boolean(assessment[stage.key]),
  }));
}

/** How far through the checklist, 0-1. Progress here is earned, not decorative. */
export function stageProgress(states: readonly StageState[]): number {
  if (states.length === 0) return 0;
  return states.filter((s) => s.done).length / states.length;
}

/**
 * Grade position for a module.
 *
 * Deliberately scoped to per-module arithmetic over marks actually received.
 * This is not the speculative whole-degree GPA projection the brief rules out.
 *
 * Vocabulary:
 * - banked weight:  % of the module already assessed and returned
 * - banked points:  % of the FINAL grade already secured by those results
 * - at stake:       % of the module still to be assessed
 */

export interface GradeableAssessment {
  id: string;
  weightPercent: number;
}

export interface AwardedGrade {
  marksAwarded: number;
  marksPossible: number;
}

export interface GradeSummary {
  /** Weight of assessments with a result in, 0-100. */
  bankedWeight: number;
  /** Points of the final grade already secured, 0-100. */
  bankedPoints: number;
  /** Weight still to be assessed, 0-100. */
  atStakeWeight: number;
  /** Average mark across returned assessments, 0-100, or null if none yet. */
  averageSoFar: number | null;
  /**
   * Best achievable final grade if everything remaining is perfect.
   * Equals bankedPoints + atStakeWeight.
   */
  ceiling: number;
  /** Final grade if everything remaining scores zero. */
  floor: number;
  gradedCount: number;
  totalCount: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Percentage score for one result, 0-100. Guards divide-by-zero. */
export function scorePercent(grade: AwardedGrade): number {
  if (grade.marksPossible <= 0) return 0;
  return (grade.marksAwarded / grade.marksPossible) * 100;
}

export function summariseGrades(
  assessments: readonly GradeableAssessment[],
  gradesById: ReadonlyMap<string, AwardedGrade>,
): GradeSummary {
  let bankedWeight = 0;
  let bankedPoints = 0;
  let gradedCount = 0;
  let totalWeight = 0;

  for (const assessment of assessments) {
    totalWeight += assessment.weightPercent;
    const grade = gradesById.get(assessment.id);
    if (!grade) continue;
    gradedCount += 1;
    bankedWeight += assessment.weightPercent;
    bankedPoints += (assessment.weightPercent * scorePercent(grade)) / 100;
  }

  const atStakeWeight = Math.max(0, totalWeight - bankedWeight);

  return {
    bankedWeight,
    bankedPoints,
    atStakeWeight,
    averageSoFar:
      bankedWeight > 0 ? (bankedPoints / bankedWeight) * 100 : null,
    ceiling: bankedPoints + atStakeWeight,
    floor: bankedPoints,
    gradedCount,
    totalCount: assessments.length,
  };
}

export type RequiredMark =
  | { kind: "already-secured" }
  | { kind: "impossible"; required: number }
  | { kind: "needed"; required: number }
  | { kind: "nothing-left" };

/**
 * "To finish Solid State at 60%, you need >=57% in the final."
 *
 * Returns the average mark needed across everything not yet assessed.
 */
export function requiredMarkForTarget(
  summary: GradeSummary,
  targetPercent: number,
): RequiredMark {
  if (summary.atStakeWeight <= 0) {
    return summary.bankedPoints >= targetPercent
      ? { kind: "already-secured" }
      : { kind: "nothing-left" };
  }

  const shortfall = targetPercent - summary.bankedPoints;
  if (shortfall <= 0) return { kind: "already-secured" };

  const required = (shortfall / summary.atStakeWeight) * 100;
  if (required > 100) return { kind: "impossible", required };

  return { kind: "needed", required: clamp(required, 0, 100) };
}

/** Human-readable one-liner for the module page. */
export function describeRequiredMark(
  result: RequiredMark,
  targetPercent: number,
): string {
  switch (result.kind) {
    case "already-secured":
      return `${targetPercent}% is already secured.`;
    case "nothing-left":
      return `All assessments are in. ${targetPercent}% is no longer reachable.`;
    case "impossible":
      return `${targetPercent}% is no longer reachable - it would need ${Math.round(result.required)}% in what remains.`;
    case "needed":
      return `Needs ${Math.ceil(result.required)}% across what remains to finish at ${targetPercent}%.`;
  }
}

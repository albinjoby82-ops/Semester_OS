/**
 * Wire types.
 *
 * The shared modules type dates as `Date`, which is correct in-process but a
 * lie across JSON: `Date` serialises to an ISO string and comes back as one.
 * Typing the client against the shared types compiles cleanly and then throws
 * at runtime on `.toISOString()`.
 *
 * These mirror the shared shapes with dates as strings, which is what the
 * client actually receives.
 */

import type { RiskLevel } from "../../shared/risk";

/** Recursively replace Date with string — the shape JSON actually delivers. */
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

export interface WireAssessmentRisk {
  id: string;
  title: string;
  weightPercent: number;
  level: RiskLevel;
  reason: string;
  latestSafeStart: string | null;
  effectiveDue: string | null;
  daysUntilDue: number | null;
  hasStarted: boolean;
}

export interface WireModuleRisk {
  atRiskWeight: number;
  watchWeight: number;
  totalWeight: number;
  percentAtRisk: number;
  level: RiskLevel;
  risks: WireAssessmentRisk[];
  headline: string | null;
}

export interface WireRadarItem {
  id: string;
  moduleCode: string;
  moduleName: string;
  colorToken: string;
  title: string;
  weightPercent: number;
  isExam: boolean;
  isSubmitted: boolean;
  due: string | null;
  daysAway: number | null;
  isWindowOnly: boolean;
  risk: WireAssessmentRisk;
}

export interface WireScoreComponent {
  key: string;
  label: string;
  points: number;
}

export interface WireScoredTask {
  task: {
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
  };
  score: number;
  components: WireScoreComponent[];
  fits: boolean;
  adjustments: WireScoreComponent[];
  reason: string;
}

export interface WireNextView {
  recommended: WireScoredTask | null;
  ranked: WireScoredTask[];
  minutesAvailable: number | null;
  universityAtRisk: boolean;
}

/** Parse an optional ISO string to a Date, tolerating null. */
export const toDate = (iso: string | null | undefined): Date | null =>
  iso ? new Date(iso) : null;

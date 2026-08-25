/**
 * Estimation calibration: how wrong your estimates actually are.
 *
 * Everyone underestimates, consistently and in the same direction. Once Focus
 * mode has tracked real sessions, this derives a personal multiplier so that
 * capacity forecasting quietly corrects for it -- no self-honesty required.
 *
 * Uses the MEDIAN ratio, not the mean: one 4-hour session that was really a
 * 20-minute task plus three hours of procrastination should not redefine your
 * whole model.
 */

export interface CompletedWork {
  estimatedMinutes: number | null;
  actualMinutes: number | null;
}

export type Confidence = "none" | "low" | "good";

export interface Calibration {
  /** How many completed items had both an estimate and a tracked actual. */
  sampleSize: number;
  /** actual / estimated. Above 1 means you underestimate. Null if unknown. */
  multiplier: number | null;
  confidence: Confidence;
  message: string | null;
}

/** Below this many samples the multiplier is not trustworthy enough to apply. */
const MIN_SAMPLE = 5;
/** Below this it is not worth reporting at all. */
const MIN_REPORTABLE = 3;

/** Guard against absurd ratios from mis-tracked sessions. */
const MIN_RATIO = 0.1;
const MAX_RATIO = 10;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function computeCalibration(
  items: readonly CompletedWork[],
  options: { minSample?: number } = {},
): Calibration {
  const minSample = options.minSample ?? MIN_SAMPLE;

  const ratios = items
    .filter(
      (item): item is { estimatedMinutes: number; actualMinutes: number } =>
        typeof item.estimatedMinutes === "number" &&
        typeof item.actualMinutes === "number" &&
        item.estimatedMinutes > 0 &&
        item.actualMinutes > 0,
    )
    .map((item) => item.actualMinutes / item.estimatedMinutes)
    .filter((ratio) => ratio >= MIN_RATIO && ratio <= MAX_RATIO);

  if (ratios.length < MIN_REPORTABLE) {
    return {
      sampleSize: ratios.length,
      multiplier: null,
      confidence: "none",
      message: null,
    };
  }

  const multiplier = median(ratios);
  const confidence: Confidence = ratios.length >= minSample ? "good" : "low";

  return {
    sampleSize: ratios.length,
    multiplier,
    confidence,
    message: describe(multiplier, ratios.length, confidence),
  };
}

function describe(
  multiplier: number,
  sampleSize: number,
  confidence: Confidence,
): string | null {
  const percent = Math.round(Math.abs(multiplier - 1) * 100);
  const prefix =
    confidence === "low" ? `Early signal from ${sampleSize} tasks` : `Across ${sampleSize} tasks`;

  // Within 10% either way is not a bias worth reporting.
  if (percent < 10) {
    return `${prefix}, your estimates are about right.`;
  }
  if (multiplier > 1) {
    return `${prefix}, work takes about ${percent}% longer than you estimate.`;
  }
  return `${prefix}, work takes about ${percent}% less time than you estimate.`;
}

/**
 * Apply the multiplier to an estimate for forecasting.
 *
 * Only applied once there is enough data to trust it -- a multiplier derived
 * from three tasks would make capacity worse, not better.
 */
export function applyCalibration(
  estimatedMinutes: number | null,
  calibration: Calibration,
): number | null {
  if (estimatedMinutes == null) return null;
  if (calibration.multiplier == null || calibration.confidence !== "good") {
    return estimatedMinutes;
  }
  return Math.round(estimatedMinutes * calibration.multiplier);
}

/** Elapsed whole minutes between two instants, floored at zero. */
export function sessionMinutes(startedAt: string, endedAt: string): number {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

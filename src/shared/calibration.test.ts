import { describe, expect, it } from "vitest";
import {
  applyCalibration,
  computeCalibration,
  sessionMinutes,
  type CompletedWork,
} from "./calibration";

const work = (estimated: number | null, actual: number | null): CompletedWork => ({
  estimatedMinutes: estimated,
  actualMinutes: actual,
});

/** n items that each took `ratio` times as long as estimated. */
const consistent = (count: number, ratio: number): CompletedWork[] =>
  Array.from({ length: count }, () => work(60, 60 * ratio));

describe("computeCalibration", () => {
  it("reports nothing without enough data", () => {
    const result = computeCalibration([work(60, 90), work(60, 90)]);
    expect(result.multiplier).toBeNull();
    expect(result.confidence).toBe("none");
    expect(result.message).toBeNull();
  });

  it("detects consistent underestimation", () => {
    const result = computeCalibration(consistent(6, 1.5));
    expect(result.multiplier).toBeCloseTo(1.5, 6);
    expect(result.confidence).toBe("good");
    expect(result.message).toContain("50% longer");
  });

  it("detects overestimation too", () => {
    const result = computeCalibration(consistent(6, 0.5));
    expect(result.multiplier).toBeCloseTo(0.5, 6);
    expect(result.message).toContain("50% less time");
  });

  it("says estimates are fine when they are close", () => {
    const result = computeCalibration(consistent(6, 1.05));
    expect(result.message).toContain("about right");
  });

  it("uses the median so one bad session cannot redefine the model", () => {
    // Five honest 1.2x tasks and one session left running for hours.
    const items = [...consistent(5, 1.2), work(30, 240)];
    const result = computeCalibration(items);
    expect(result.multiplier).toBeCloseTo(1.2, 1);
  });

  it("discards absurd ratios entirely", () => {
    const items = [...consistent(5, 1.2), work(1, 600), work(600, 1)];
    const result = computeCalibration(items);
    expect(result.sampleSize).toBe(5);
  });

  it("ignores items missing either number", () => {
    const items = [
      ...consistent(4, 2),
      work(60, null),
      work(null, 60),
      work(0, 60),
    ];
    const result = computeCalibration(items);
    expect(result.sampleSize).toBe(4);
  });

  it("marks a small sample as low confidence", () => {
    const result = computeCalibration(consistent(3, 1.5));
    expect(result.confidence).toBe("low");
    expect(result.message).toContain("Early signal");
  });

  it("handles an empty history", () => {
    const result = computeCalibration([]);
    expect(result.sampleSize).toBe(0);
    expect(result.multiplier).toBeNull();
  });
});

describe("applyCalibration", () => {
  it("scales an estimate once the multiplier is trustworthy", () => {
    const calibration = computeCalibration(consistent(6, 1.5));
    expect(applyCalibration(60, calibration)).toBe(90);
  });

  it("leaves estimates alone on a low-confidence sample", () => {
    // Three tasks is not enough to start rewriting the user's numbers.
    const calibration = computeCalibration(consistent(3, 2));
    expect(applyCalibration(60, calibration)).toBe(60);
  });

  it("leaves estimates alone with no data at all", () => {
    expect(applyCalibration(60, computeCalibration([]))).toBe(60);
  });

  it("passes through a missing estimate", () => {
    expect(applyCalibration(null, computeCalibration(consistent(6, 1.5)))).toBeNull();
  });
});

describe("sessionMinutes", () => {
  it("rounds elapsed time to whole minutes", () => {
    expect(
      sessionMinutes("2026-09-09T10:00:00.000Z", "2026-09-09T10:42:30.000Z"),
    ).toBe(43);
  });

  it("returns zero rather than a negative for a reversed pair", () => {
    expect(
      sessionMinutes("2026-09-09T11:00:00.000Z", "2026-09-09T10:00:00.000Z"),
    ).toBe(0);
  });
});

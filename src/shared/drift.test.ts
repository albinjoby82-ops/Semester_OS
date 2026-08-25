import { describe, expect, it } from "vitest";
import {
  checkOverride,
  computeDrift,
  daysLeftInWeek,
  trailingRatio,
} from "./drift";

/** Wednesday 9 September 2026. */
const wednesday = new Date(2026, 8, 9, 15, 0, 0);

const allocations = [
  { areaId: "university", plannedHours: 20 },
  { areaId: "gaelforce", plannedHours: 6 },
  { areaId: "accio", plannedHours: 3 },
];

describe("daysLeftInWeek", () => {
  it("counts today as remaining", () => {
    expect(daysLeftInWeek(new Date(2026, 8, 7))).toBe(7); // Monday
    expect(daysLeftInWeek(wednesday)).toBe(5); // Wednesday
    expect(daysLeftInWeek(new Date(2026, 8, 13))).toBe(1); // Sunday
  });
});

describe("computeDrift", () => {
  it("reports the drift line from the plan's worked example", () => {
    const report = computeDrift(
      allocations,
      [
        { areaId: "gaelforce", hours: 9 },
        { areaId: "university", hours: 11 },
      ],
      { now: wednesday },
    );

    expect(report.universityShortfall).toBe(9);
    expect(report.daysLeft).toBe(5);
    expect(report.message).toContain("Wednesday");
    expect(report.message).toContain("Gaelforce 9h");
    expect(report.message).toContain("University 11h");
    expect(report.message).toContain("9h short");
    expect(report.message).toContain("5 days left");
  });

  it("measures against the user's own allocation, not an invented rule", () => {
    // Same hours, a smaller self-set university allocation: no shortfall.
    const report = computeDrift(
      [{ areaId: "university", plannedHours: 10 }],
      [{ areaId: "university", hours: 11 }],
      { now: wednesday },
    );
    expect(report.universityShortfall).toBe(0);
    expect(report.message).toContain("allocation met");
  });

  it("computes per-area deltas and over-allocation flags", () => {
    const report = computeDrift(
      allocations,
      [
        { areaId: "gaelforce", hours: 9 },
        { areaId: "university", hours: 11 },
      ],
      { now: wednesday },
    );

    const gaelforce = report.byArea.find((a) => a.areaId === "gaelforce")!;
    expect(gaelforce.deltaHours).toBe(3);
    expect(gaelforce.overAllocation).toBe(true);

    const university = report.byArea.find((a) => a.areaId === "university")!;
    expect(university.deltaHours).toBe(-9);
    expect(university.overAllocation).toBe(false);
  });

  it("totals extracurricular overage across areas", () => {
    const report = computeDrift(
      allocations,
      [
        { areaId: "gaelforce", hours: 9 }, // +3
        { areaId: "accio", hours: 5 }, // +2
        { areaId: "university", hours: 25 }, // over, but not extracurricular
      ],
      { now: wednesday },
    );
    expect(report.extracurricularOverage).toBe(5);
  });

  it("says nothing when no allocation has been set", () => {
    const report = computeDrift([], [{ areaId: "gaelforce", hours: 9 }], {
      now: wednesday,
    });
    expect(report.message).toBeNull();
  });

  it("does not divide by zero for a zero allocation", () => {
    const report = computeDrift(
      [{ areaId: "personal", plannedHours: 0 }],
      [{ areaId: "personal", hours: 4 }],
      { now: wednesday },
    );
    const personal = report.byArea.find((a) => a.areaId === "personal")!;
    expect(personal.progress).toBeNull();
    expect(personal.overAllocation).toBe(false);
  });
});

describe("trailingRatio", () => {
  const week = (weekNumber: number, uni: number, gf: number) => ({
    weekNumber,
    actuals: [
      { areaId: "university", hours: uni },
      { areaId: "gaelforce", hours: gf },
    ],
  });

  it("catches sustained drift the weekly view cannot see", () => {
    const ratio = trailingRatio([week(3, 8, 12), week(4, 9, 14), week(5, 7, 15)]);
    expect(ratio.sustainedDrift).toBe(true);
    expect(ratio.weeks).toEqual([3, 4, 5]);
    expect(ratio.universityHours).toBe(24);
    expect(ratio.extracurricularHours).toBe(41);
    expect(ratio.message).toContain("weeks 3, 4, 5");
  });

  it("does not fire on a single heavy week", () => {
    const ratio = trailingRatio([week(3, 20, 2), week(4, 18, 3), week(5, 4, 15)]);
    expect(ratio.sustainedDrift).toBe(false);
    expect(ratio.message).toBeNull();
  });

  it("needs a full window before calling it a pattern", () => {
    const ratio = trailingRatio([week(5, 2, 12)]);
    expect(ratio.sustainedDrift).toBe(false);
  });

  it("uses only the most recent weeks", () => {
    const ratio = trailingRatio(
      [week(1, 30, 0), week(3, 8, 12), week(4, 9, 14), week(5, 7, 15)],
      { weeks: 3 },
    );
    expect(ratio.weeks).toEqual([3, 4, 5]);
    expect(ratio.universityHours).toBe(24);
  });

  it("reports no share when nothing is tracked", () => {
    expect(trailingRatio([]).universityShare).toBeNull();
  });
});

describe("checkOverride", () => {
  const actuals = [
    { areaId: "gaelforce", hours: 5 },
    { areaId: "university", hours: 11 },
  ];

  it("requires a reason above your own extracurricular allocation", () => {
    // 5h logged + 2h added = 7h against a 6h allocation.
    const check = checkOverride("gaelforce", 2, allocations, actuals);
    expect(check.required).toBe(true);
    expect(check.overageHours).toBe(1);
    expect(check.message).toContain("6h you allocated");
  });

  it("stays quiet while still inside the allocation", () => {
    expect(checkOverride("gaelforce", 0.5, allocations, actuals).required).toBe(
      false,
    );
  });

  it("never caps university -- it is the protected floor", () => {
    const check = checkOverride("university", 40, allocations, actuals);
    expect(check.required).toBe(false);
    expect(check.message).toBeNull();
  });

  it("does not cap an area with no allocation set", () => {
    expect(checkOverride("personal", 10, allocations, actuals).required).toBe(
      false,
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  describeRequiredMark,
  requiredMarkForTarget,
  scorePercent,
  summariseGrades,
  type AwardedGrade,
  type GradeableAssessment,
} from "./grades";

/** EEEN20070 Solid State: 60 final, 20 midterm, 10 lab, 10 lab. */
const solidState: GradeableAssessment[] = [
  { id: "final", weightPercent: 60 },
  { id: "midterm", weightPercent: 20 },
  { id: "lab1", weightPercent: 10 },
  { id: "lab2", weightPercent: 10 },
];

const gradeMap = (entries: Record<string, [number, number]>) =>
  new Map<string, AwardedGrade>(
    Object.entries(entries).map(([id, [awarded, possible]]) => [
      id,
      { marksAwarded: awarded, marksPossible: possible },
    ]),
  );

describe("scorePercent", () => {
  it("converts marks to a percentage", () => {
    expect(scorePercent({ marksAwarded: 17, marksPossible: 20 })).toBe(85);
  });

  it("returns 0 rather than dividing by zero", () => {
    expect(scorePercent({ marksAwarded: 5, marksPossible: 0 })).toBe(0);
  });
});

describe("summariseGrades", () => {
  it("reports nothing banked before any results", () => {
    const summary = summariseGrades(solidState, new Map());
    expect(summary.bankedWeight).toBe(0);
    expect(summary.bankedPoints).toBe(0);
    expect(summary.atStakeWeight).toBe(100);
    expect(summary.averageSoFar).toBeNull();
    expect(summary.ceiling).toBe(100);
    expect(summary.floor).toBe(0);
  });

  it("banks points in proportion to weight, not raw marks", () => {
    // Both labs at 70%: 10% weight each, so 7 points of the final grade.
    const summary = summariseGrades(
      solidState,
      gradeMap({ lab1: [70, 100], lab2: [70, 100] }),
    );
    expect(summary.bankedWeight).toBe(20);
    expect(summary.bankedPoints).toBeCloseTo(14, 6);
    expect(summary.atStakeWeight).toBe(80);
    expect(summary.averageSoFar).toBeCloseTo(70, 6);
    // Perfect from here: 14 + 80 = 94.
    expect(summary.ceiling).toBeCloseTo(94, 6);
    // Nothing more: 14.
    expect(summary.floor).toBeCloseTo(14, 6);
    expect(summary.gradedCount).toBe(2);
    expect(summary.totalCount).toBe(4);
  });

  it("handles marks given out of something other than 100", () => {
    // 17/20 on the midterm = 85%, worth 20% => 17 points.
    const summary = summariseGrades(solidState, gradeMap({ midterm: [17, 20] }));
    expect(summary.bankedPoints).toBeCloseTo(17, 6);
    expect(summary.averageSoFar).toBeCloseTo(85, 6);
  });

  it("ignores grades for assessments not in this module", () => {
    const summary = summariseGrades(solidState, gradeMap({ other: [90, 100] }));
    expect(summary.gradedCount).toBe(0);
    expect(summary.bankedPoints).toBe(0);
  });
});

describe("requiredMarkForTarget", () => {
  it("computes the mark needed in what remains", () => {
    // Labs 70% each (14 banked), 80% still at stake, target 60.
    // (60 - 14) / 80 * 100 = 57.5
    const summary = summariseGrades(
      solidState,
      gradeMap({ lab1: [70, 100], lab2: [70, 100] }),
    );
    const result = requiredMarkForTarget(summary, 60);
    expect(result.kind).toBe("needed");
    if (result.kind === "needed") {
      expect(result.required).toBeCloseTo(57.5, 6);
    }
  });

  it("reports a target already secured", () => {
    // 90% on everything except the 10% lab2: 90 banked, target 60.
    const summary = summariseGrades(
      solidState,
      gradeMap({ final: [90, 100], midterm: [90, 100], lab1: [90, 100] }),
    );
    expect(requiredMarkForTarget(summary, 60)).toEqual({
      kind: "already-secured",
    });
  });

  it("reports an unreachable target rather than a misleading number", () => {
    // Everything so far at 10%: 9 banked of 90 weight, 10 left, target 70.
    const summary = summariseGrades(
      solidState,
      gradeMap({ final: [10, 100], midterm: [10, 100], lab1: [10, 100] }),
    );
    const result = requiredMarkForTarget(summary, 70);
    expect(result.kind).toBe("impossible");
    if (result.kind === "impossible") {
      expect(result.required).toBeGreaterThan(100);
    }
  });

  it("handles a fully assessed module", () => {
    const summary = summariseGrades(
      solidState,
      gradeMap({
        final: [50, 100],
        midterm: [50, 100],
        lab1: [50, 100],
        lab2: [50, 100],
      }),
    );
    expect(requiredMarkForTarget(summary, 60)).toEqual({ kind: "nothing-left" });
    expect(requiredMarkForTarget(summary, 40)).toEqual({
      kind: "already-secured",
    });
  });

  it("MATH20290: one midterm result barely moves the needle", () => {
    // 15% midterm at 80% = 12 banked; 85% rests on the final.
    const maths: GradeableAssessment[] = [
      { id: "midterm", weightPercent: 15 },
      { id: "final", weightPercent: 85 },
    ];
    const summary = summariseGrades(maths, gradeMap({ midterm: [80, 100] }));
    expect(summary.bankedPoints).toBeCloseTo(12, 6);
    const result = requiredMarkForTarget(summary, 60);
    // (60 - 12) / 85 * 100 = 56.47
    if (result.kind === "needed") {
      expect(result.required).toBeCloseTo(56.47, 1);
    } else {
      throw new Error(`expected needed, got ${result.kind}`);
    }
  });
});

describe("describeRequiredMark", () => {
  it("rounds up so the stated mark is actually sufficient", () => {
    const summary = summariseGrades(
      solidState,
      gradeMap({ lab1: [70, 100], lab2: [70, 100] }),
    );
    // 57.5 must round UP to 58 -- 57 would fall short.
    expect(describeRequiredMark(requiredMarkForTarget(summary, 60), 60)).toBe(
      "Needs 58% across what remains to finish at 60%.",
    );
  });
});

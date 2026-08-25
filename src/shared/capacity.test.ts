import { describe, expect, it } from "vitest";
import {
  assessmentWeightByWeek,
  buildHorizon,
  capacityForWeek,
  effortBudget,
  fixedHoursForWeek,
  overloadedWeeks,
  projectAddition,
  type AssessmentWindow,
  type FixedBlock,
  type WorkItem,
} from "./capacity";
import type { TermConfig } from "./term-week";

const term: TermConfig = {
  id: "t",
  label: "T",
  startDate: "2026-09-07",
  teachingWeeks: 12,
  breakAfterWeeks: [],
};

const block = (over: Partial<FixedBlock> = {}): FixedBlock => ({
  areaId: "university",
  dayOfWeek: 1,
  startMinute: 9 * 60,
  endMinute: 11 * 60,
  fromWeek: null,
  toWeek: null,
  active: true,
  ...over,
});

const task = (over: Partial<WorkItem> = {}): WorkItem => ({
  areaId: "university",
  weekNumber: 5,
  estimatedMinutes: 60,
  status: "todo",
  ...over,
});

describe("fixedHoursForWeek", () => {
  it("sums timetabled blocks", () => {
    expect(fixedHoursForWeek([block(), block({ dayOfWeek: 3 })], 5)).toBe(4);
  });

  it("respects week ranges", () => {
    const labs = block({ fromWeek: 3, toWeek: 5 });
    expect(fixedHoursForWeek([labs], 4)).toBe(2);
    expect(fixedHoursForWeek([labs], 6)).toBe(0);
    expect(fixedHoursForWeek([labs], 2)).toBe(0);
  });

  it("ignores inactive blocks", () => {
    expect(fixedHoursForWeek([block({ active: false })], 5)).toBe(0);
  });

  it("never counts a negative-length block", () => {
    expect(
      fixedHoursForWeek([block({ startMinute: 600, endMinute: 300 })], 5),
    ).toBe(0);
  });
});

describe("capacityForWeek", () => {
  const base = { blocks: [], items: [], assessments: [] };

  it("takes fixed commitments out of realistic hours", () => {
    const week = capacityForWeek(5, {
      ...base,
      blocks: [block(), block({ dayOfWeek: 2 })],
    });
    expect(week.fixedHours).toBe(4);
    expect(week.freeHours).toBe(56);
  });

  it("counts only open tasks in the given week", () => {
    const week = capacityForWeek(5, {
      ...base,
      items: [
        task({ estimatedMinutes: 120 }),
        task({ estimatedMinutes: 60, status: "done" }),
        task({ estimatedMinutes: 90, weekNumber: 6 }),
      ],
    });
    expect(week.committedHours).toBe(2);
  });

  it("breaks committed hours down by area", () => {
    const week = capacityForWeek(5, {
      ...base,
      items: [
        task({ estimatedMinutes: 120 }),
        task({ areaId: "gaelforce", estimatedMinutes: 180 }),
      ],
    });
    expect(week.byArea).toEqual([
      { areaId: "gaelforce", hours: 3 },
      { areaId: "university", hours: 2 },
    ]);
  });

  it("treats a missing estimate as zero rather than guessing", () => {
    const week = capacityForWeek(5, {
      ...base,
      items: [task({ estimatedMinutes: null })],
    });
    expect(week.committedHours).toBe(0);
  });

  it("flags a week that does not fit", () => {
    const week = capacityForWeek(5, {
      ...base,
      items: [task({ estimatedMinutes: 70 * 60 })],
    });
    expect(week.overloaded).toBe(true);
    expect(week.utilisation).toBeGreaterThan(1);
  });

  it("does not divide by zero when fixed commitments consume the week", () => {
    const wall = block({ startMinute: 0, endMinute: 60 * 60 });
    const week = capacityForWeek(5, { ...base, blocks: [wall] });
    expect(week.freeHours).toBe(0);
    expect(week.utilisation).toBe(0);
    expect(week.overloaded).toBe(false);
  });
});

describe("assessmentWeightByWeek", () => {
  const window = (over: Partial<AssessmentWindow>): AssessmentWindow => ({
    moduleCode: "EEEN20020",
    title: "Lab",
    weightPercent: 5,
    dueWeek: 3,
    dueWeekEnd: null,
    isSubmitted: false,
    ...over,
  });

  it("spreads a multi-week window instead of spiking the first week", () => {
    const map = assessmentWeightByWeek([
      window({ dueWeek: 3, dueWeekEnd: 5, weightPercent: 6 }),
    ]);
    expect(map.get(3)?.weight).toBeCloseTo(2, 6);
    expect(map.get(4)?.weight).toBeCloseTo(2, 6);
    expect(map.get(5)?.weight).toBeCloseTo(2, 6);
  });

  it("puts a single-week assessment entirely in that week", () => {
    const map = assessmentWeightByWeek([window({ dueWeek: 7, weightPercent: 20 })]);
    expect(map.get(7)?.weight).toBe(20);
  });

  it("excludes submitted work -- it is no longer pressure", () => {
    const map = assessmentWeightByWeek([window({ isSubmitted: true })]);
    expect(map.size).toBe(0);
  });

  it("ignores undated end-of-trimester exams", () => {
    const map = assessmentWeightByWeek([window({ dueWeek: null })]);
    expect(map.size).toBe(0);
  });
});

describe("buildHorizon", () => {
  it("covers every teaching week", () => {
    const horizon = buildHorizon(term, {
      blocks: [],
      items: [],
      assessments: [],
    });
    expect(horizon).toHaveLength(12);
    expect(horizon.map((w) => w.week)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });

  it("surfaces the real Week 9 pile-up from the seeded modules", () => {
    // Solid State Lab 1 (10%, wk 9), Circuits HW3 (5%, wk 9),
    // Circuits Lab 3 (5%, wks 9-11).
    const assessments: AssessmentWindow[] = [
      {
        moduleCode: "EEEN20070",
        title: "Lab Assignment 1 Report",
        weightPercent: 10,
        dueWeek: 9,
        dueWeekEnd: null,
        isSubmitted: false,
      },
      {
        moduleCode: "EEEN20020",
        title: "Homework 3",
        weightPercent: 5,
        dueWeek: 9,
        dueWeekEnd: null,
        isSubmitted: false,
      },
      {
        moduleCode: "EEEN20020",
        title: "Laboratory 3",
        weightPercent: 5,
        dueWeek: 9,
        dueWeekEnd: 11,
        isSubmitted: false,
      },
    ];

    const horizon = buildHorizon(term, { blocks: [], items: [], assessments });
    const week9 = horizon.find((w) => w.week === 9)!;

    // 10 + 5 + (5/3) = 16.67
    expect(week9.assessmentWeight).toBeCloseTo(16.67, 1);
    expect(week9.assessments).toHaveLength(3);

    const peak = horizon.reduce((max, w) =>
      w.assessmentWeight > max.assessmentWeight ? w : max,
    );
    expect(peak.week).toBe(9);
  });
});

describe("overloadedWeeks", () => {
  it("reports only the weeks that do not fit, with numbers", () => {
    const horizon = buildHorizon(term, {
      blocks: [],
      items: [
        task({ weekNumber: 3, estimatedMinutes: 70 * 60 }),
        task({ weekNumber: 4, estimatedMinutes: 10 * 60 }),
      ],
      assessments: [],
    });
    const warnings = overloadedWeeks(horizon);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.week).toBe(3);
    expect(warnings[0]!.message).toContain("Week 3");
    expect(warnings[0]!.message).toContain("%");
  });
});

describe("projectAddition", () => {
  it("warns when a new task tips the week over", () => {
    const week = capacityForWeek(5, {
      blocks: [],
      items: [task({ estimatedMinutes: 55 * 60 })],
      assessments: [],
    });
    const result = projectAddition(week, 6 * 60);
    expect(result.utilisation).toBeGreaterThan(1);
    expect(result.message).toContain("Week 5");
  });

  it("says nothing when the week still fits", () => {
    const week = capacityForWeek(5, {
      blocks: [],
      items: [task({ estimatedMinutes: 60 })],
      assessments: [],
    });
    expect(projectAddition(week, 60).message).toBeNull();
  });
});

describe("effortBudget", () => {
  it("shows the honest gap for the six Autumn modules", () => {
    // 120 + 120 + 120 + 108 + 100 + 110 = 678
    const budget = effortBudget(678, term);
    expect(budget.statedPerWeek).toBeCloseTo(56.5, 1);
    expect(budget.feasible).toBe(true); // just barely, at 60h realistic
    expect(budget.gapPerWeek).toBeLessThan(0);
  });

  it("reports infeasibility rather than hiding it", () => {
    const budget = effortBudget(678, term, {
      realisticWeeklyHours: 40,
      overloadThreshold: 1,
    });
    expect(budget.feasible).toBe(false);
    expect(budget.gapPerWeek).toBeCloseTo(16.5, 1);
  });
});

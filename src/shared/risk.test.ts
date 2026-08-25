import { describe, expect, it } from "vitest";
import {
  assessModule,
  assessRisk,
  effectiveDueDate,
  latestSafeStart,
  type RiskAssessment,
} from "./risk";
import type { TermConfig } from "./term-week";

const term: TermConfig = {
  id: "t",
  label: "T",
  startDate: "2026-09-07",
  teachingWeeks: 12,
  breakAfterWeeks: [],
};

const assessment = (over: Partial<RiskAssessment> = {}): RiskAssessment => ({
  id: "a1",
  title: "Lab Assignment 1 Report",
  weightPercent: 10,
  dueWeek: 9,
  dueWeekEnd: null,
  dueAt: null,
  isExam: false,
  isSubmitted: false,
  startedAt: null,
  mainWorkDoneAt: null,
  estimatedMinutes: 6 * 60,
  ...over,
});

/** Week 9 runs Mon 2 Nov to Sun 8 Nov 2026 with this term config. */
const inWeek = (week: number, dayOffset = 0): Date => {
  const start = new Date(2026, 8, 7);
  start.setDate(start.getDate() + (week - 1) * 7 + dayOffset);
  start.setHours(12, 0, 0, 0);
  return start;
};

describe("effectiveDueDate", () => {
  it("prefers a pinned lecturer-announced date", () => {
    const due = effectiveDueDate(
      assessment({ dueAt: "2026-10-15T23:59:00.000Z" }),
      term,
    );
    expect(due?.toISOString()).toBe("2026-10-15T23:59:00.000Z");
  });

  it("falls back to the END of a published window", () => {
    // "Weeks 7-9" means you are late if you have not moved by end of week 9.
    const due = effectiveDueDate(
      assessment({ dueWeek: 7, dueWeekEnd: 9 }),
      term,
    );
    // Week 9 ends Sunday 8 Nov 2026.
    expect(due?.toISOString().slice(0, 10)).toBe("2026-11-08");
  });

  it("returns null for an undated end-of-trimester exam", () => {
    expect(effectiveDueDate(assessment({ dueWeek: null }), term)).toBeNull();
  });
});

describe("latestSafeStart", () => {
  it("back-plans from the deadline through available hours", () => {
    // 6h of work at 3h/day = 2 days before the deadline.
    const due = new Date(2026, 9, 15);
    const start = latestSafeStart(assessment(), due, 3);
    expect(start?.getDate()).toBe(13);
  });

  it("scales the default effort by weight when no estimate exists", () => {
    const small = latestSafeStart(
      assessment({ estimatedMinutes: null, weightPercent: 5 }),
      new Date(2026, 9, 15),
      3,
    );
    const large = latestSafeStart(
      assessment({ estimatedMinutes: null, weightPercent: 60, isExam: true }),
      new Date(2026, 9, 15),
      3,
    );
    // A 60% exam must demand a far earlier start than a 5% homework.
    expect(large!.getTime()).toBeLessThan(small!.getTime());
  });

  it("returns null rather than dividing by zero with no free time", () => {
    expect(latestSafeStart(assessment(), new Date(2026, 9, 15), 0)).toBeNull();
  });

  it("returns null when there is no deadline to plan against", () => {
    expect(latestSafeStart(assessment(), null, 3)).toBeNull();
  });
});

describe("assessRisk", () => {
  const opts = { term, freeHoursPerDay: 3 };

  it("clears submitted work entirely", () => {
    const risk = assessRisk(assessment({ isSubmitted: true }), {
      ...opts,
      now: inWeek(12),
    });
    expect(risk.level).toBe("none");
    expect(risk.reason).toBe("Submitted.");
  });

  it("flags overdue unsubmitted work with the number of days", () => {
    const risk = assessRisk(assessment(), { ...opts, now: inWeek(10, 2) });
    expect(risk.level).toBe("at-risk");
    expect(risk.reason).toMatch(/Worth 10% and overdue by \d+ days?, not submitted/);
  });

  it("flags work that is done but not submitted", () => {
    // The brief's key rule, surfaced as risk rather than silently closed.
    const risk = assessRisk(
      assessment({ mainWorkDoneAt: "2026-11-01T10:00:00.000Z" }),
      { ...opts, now: inWeek(9, 1) },
    );
    expect(risk.level).toBe("watch");
    expect(risk.reason).toContain("not been submitted");
  });

  it("flags an unstarted assessment past its comfortable start date", () => {
    // Due end of week 9 (8 Nov), 6h of work at 3h/day => start by 6 Nov.
    const risk = assessRisk(assessment(), { ...opts, now: inWeek(9, 6) });
    expect(risk.level).toBe("at-risk");
    expect(risk.reason).toContain("not started");
    expect(risk.reason).toContain("10%");
  });

  it("warns as the start date approaches", () => {
    const risk = assessRisk(assessment(), { ...opts, now: inWeek(9, 3) });
    expect(risk.level).toBe("watch");
    expect(risk.reason).toContain("10%");
  });

  it("stays quiet when the work is not due to start yet", () => {
    const risk = assessRisk(assessment(), { ...opts, now: inWeek(3) });
    expect(risk.level).toBe("none");
    expect(risk.reason).toBe("Not yet due to start.");
  });

  it("does not nag about something already in progress", () => {
    const risk = assessRisk(
      assessment({ startedAt: "2026-11-01T10:00:00.000Z" }),
      { ...opts, now: inWeek(9, 5) },
    );
    expect(risk.level).toBe("none");
    expect(risk.hasStarted).toBe(true);
  });

  it("always states a reason", () => {
    for (const now of [inWeek(1), inWeek(9), inWeek(12)]) {
      expect(assessRisk(assessment(), { ...opts, now }).reason.length)
        .toBeGreaterThan(0);
    }
  });
});

describe("assessModule", () => {
  it("reports the share of the grade behind schedule, not a health score", () => {
    // Solid State: 60 final, 20 midterm, 10 lab, 10 lab.
    // Make the two labs overdue and unsubmitted => 20% at risk.
    const risk = assessModule(
      [
        assessment({ id: "final", weightPercent: 60, dueWeek: null, isExam: true }),
        assessment({ id: "mid", weightPercent: 20, dueWeek: 7, dueWeekEnd: 9 }),
        assessment({ id: "lab1", weightPercent: 10, dueWeek: 9 }),
        assessment({ id: "lab2", weightPercent: 10, dueWeek: 11 }),
      ],
      { term, now: inWeek(10, 2), freeHoursPerDay: 3 },
    );

    // lab1 (10%) and the midterm window (20%) are both past their end.
    expect(risk.atRiskWeight).toBe(30);
    expect(risk.totalWeight).toBe(100);
    expect(risk.percentAtRisk).toBe(30);
    expect(risk.level).toBe("at-risk");
  });

  it("leads with the heaviest problem, not the first one found", () => {
    const risk = assessModule(
      [
        assessment({ id: "small", title: "Homework 1", weightPercent: 5, dueWeek: 3 }),
        assessment({ id: "big", title: "Mid-term Exam", weightPercent: 20, dueWeek: 3 }),
      ],
      { term, now: inWeek(6), freeHoursPerDay: 3 },
    );
    expect(risk.headline).toContain("Mid-term Exam");
    expect(risk.headline).toContain("20%");
  });

  it("reports nothing at risk for a fully submitted module", () => {
    const risk = assessModule(
      [
        assessment({ id: "a", weightPercent: 50, isSubmitted: true }),
        assessment({ id: "b", weightPercent: 50, isSubmitted: true }),
      ],
      { term, now: inWeek(12), freeHoursPerDay: 3 },
    );
    expect(risk.percentAtRisk).toBe(0);
    expect(risk.level).toBe("none");
    expect(risk.headline).toBeNull();
  });

  it("handles a module with no assessments without dividing by zero", () => {
    const risk = assessModule([], { term, now: inWeek(5) });
    expect(risk.percentAtRisk).toBe(0);
    expect(risk.level).toBe("none");
  });
});

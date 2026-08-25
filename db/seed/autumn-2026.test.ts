import { describe, expect, it } from "vitest";
import {
  AUTUMN_2026_MODULES,
  SEED_AREAS,
  TOTAL_STATED_EFFORT_HOURS,
} from "./autumn-2026";
import { CURRENT_TERM } from "../../src/shared/term-config";
import { dateRangeForWeek } from "../../src/shared/term-week";

describe("Autumn 2026 seed data", () => {
  it("has all six modules", () => {
    expect(AUTUMN_2026_MODULES).toHaveLength(6);
    expect(AUTUMN_2026_MODULES.map((m) => m.code).sort()).toEqual([
      "EEEN20010",
      "EEEN20020",
      "EEEN20050",
      "EEEN20070",
      "MATH20290",
      "SCI20020",
    ]);
  });

  it.each(AUTUMN_2026_MODULES.map((m) => [m.code, m] as const))(
    "%s assessment weights sum to 100%%",
    (_code, module) => {
      const total = module.assessments.reduce((sum, a) => sum + a.weight, 0);
      // Floating point: 7.5 * 4 style splits need a tolerance.
      expect(total).toBeCloseTo(100, 6);
    },
  );

  it("gives every module a unique code and colour", () => {
    const codes = new Set(AUTUMN_2026_MODULES.map((m) => m.code));
    const colors = new Set(AUTUMN_2026_MODULES.map((m) => m.colorToken));
    expect(codes.size).toBe(6);
    // Distinct colours matter: modules are identified by colour across the UI.
    expect(colors.size).toBe(6);
  });

  it("places every dated assessment inside the term", () => {
    for (const module of AUTUMN_2026_MODULES) {
      for (const a of module.assessments) {
        if (a.dueWeek == null) {
          // Only end-of-trimester exams may be undated.
          expect(a.isExam, `${module.code} ${a.title}`).toBe(true);
          continue;
        }
        expect(() => dateRangeForWeek(a.dueWeek!, CURRENT_TERM)).not.toThrow();
        if (a.dueWeekEnd != null) {
          expect(a.dueWeekEnd).toBeGreaterThanOrEqual(a.dueWeek);
          expect(() =>
            dateRangeForWeek(a.dueWeekEnd!, CURRENT_TERM),
          ).not.toThrow();
        }
      }
    }
  });

  it("marks exam-heavy modules as such", () => {
    // A module is exam-heavy if any single exam carries 50% or more.
    for (const module of AUTUMN_2026_MODULES) {
      const heaviestExam = Math.max(
        0,
        ...module.assessments.filter((a) => a.isExam).map((a) => a.weight),
      );
      if (heaviestExam >= 50) {
        expect(module.assessmentProfile, module.code).toBe("exam_heavy");
      }
    }
  });

  it("records the honest effort budget", () => {
    // 120 + 120 + 120 + 108 + 100 + 110
    expect(TOTAL_STATED_EFFORT_HOURS).toBe(678);
    // Over 12 teaching weeks that is ~56.5h/week of university work alone,
    // before GaelForce and Accio. The app must show this gap, not hide it.
    const perWeek = TOTAL_STATED_EFFORT_HOURS / CURRENT_TERM.teachingWeeks;
    expect(perWeek).toBeGreaterThan(50);
  });

  it("has exactly one university area, used as the protected floor", () => {
    expect(SEED_AREAS.filter((a) => a.isUniversity)).toHaveLength(1);
    expect(new Set(SEED_AREAS.map((a) => a.id)).size).toBe(SEED_AREAS.length);
  });
});

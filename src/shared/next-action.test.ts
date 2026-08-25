import { describe, expect, it } from "vitest";
import {
  rankTasks,
  recommendNext,
  scoreTask,
  WEIGHTS,
  type Candidate,
  type ScoringContext,
} from "./next-action";
import type { TermConfig } from "./term-week";

const term: TermConfig = {
  id: "t",
  label: "T",
  startDate: "2026-09-07",
  teachingWeeks: 12,
  breakAfterWeeks: [],
};

/** Wednesday 7 October 2026, midday. */
const now = new Date(2026, 9, 7, 12, 0, 0);

const daysFromNow = (days: number): string => {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  date.setHours(23, 59, 0, 0);
  return date.toISOString();
};

const task = (over: Partial<Candidate> = {}): Candidate => ({
  id: "t1",
  title: "Tutorial 4",
  areaId: "university",
  moduleId: "eeen20070",
  assignmentId: null,
  status: "todo",
  dueAt: null,
  estimatedMinutes: 50,
  isRequiredWeekly: false,
  priorityOverride: null,
  deferredAt: null,
  ...over,
});

const base: ScoringContext = { now, term };

const pointsFor = (scored: ReturnType<typeof scoreTask>, key: string) =>
  scored.components.find((c) => c.key === key)?.points ?? 0;

describe("scoring components", () => {
  it("scores overdue work by how late it is", () => {
    const oneDay = scoreTask(task({ dueAt: daysFromNow(-1) }), base);
    const fiveDays = scoreTask(task({ dueAt: daysFromNow(-5) }), base);
    expect(pointsFor(fiveDays, "overdue")).toBeGreaterThan(
      pointsFor(oneDay, "overdue"),
    );
  });

  it("saturates overdue so an ancient task cannot pin itself to the top", () => {
    const week = scoreTask(task({ dueAt: daysFromNow(-7) }), base);
    const month = scoreTask(task({ dueAt: daysFromNow(-30) }), base);
    expect(pointsFor(month, "overdue")).toBe(pointsFor(week, "overdue"));
    // Full urgency plus full escalation.
    expect(pointsFor(month, "overdue")).toBe(WEIGHTS.urgency + WEIGHTS.overdue);
  });

  it("ranks overdue work above work that is merely due soon", () => {
    // Overdue is maximally urgent by definition; scoring it as a small
    // standalone factor would put a late task below one due tomorrow.
    const ranked = rankTasks(
      [
        task({ id: "late", dueAt: daysFromNow(-2) }),
        task({ id: "tomorrow", dueAt: daysFromNow(1) }),
        task({ id: "today", dueAt: daysFromNow(0) }),
      ],
      base,
    );
    expect(ranked.map((r) => r.task.id)).toEqual(["late", "today", "tomorrow"]);
  });

  it("keeps even one-day-overdue work above anything not yet due", () => {
    const ranked = rankTasks(
      [
        task({ id: "today", dueAt: daysFromNow(0) }),
        task({ id: "late", dueAt: daysFromNow(-1) }),
      ],
      base,
    );
    expect(ranked[0]!.task.id).toBe("late");
  });

  it("scores urgency higher the closer the deadline", () => {
    const today = scoreTask(task({ dueAt: daysFromNow(0) }), base);
    const inThree = scoreTask(task({ dueAt: daysFromNow(3) }), base);
    expect(pointsFor(today, "urgency")).toBeGreaterThan(
      pointsFor(inThree, "urgency"),
    );
  });

  it("gives no urgency beyond the horizon", () => {
    expect(pointsFor(scoreTask(task({ dueAt: daysFromNow(20) }), base), "urgency"))
      .toBe(0);
  });

  it("reports overdue as a single component, not overdue plus urgency", () => {
    // Overdue subsumes urgency so the reason does not read "it is 2 days
    // overdue and it is past its deadline".
    const late = scoreTask(task({ dueAt: daysFromNow(-2) }), base);
    expect(pointsFor(late, "urgency")).toBe(0);
    expect(pointsFor(late, "overdue")).toBeGreaterThan(WEIGHTS.urgency);
    expect(late.reason).toContain("2 days overdue");

    const soon = scoreTask(task({ dueAt: daysFromNow(2) }), base);
    expect(pointsFor(soon, "overdue")).toBe(0);
  });

  it("weights assessed work by what it is worth", () => {
    const context: ScoringContext = {
      ...base,
      assessmentWeight: new Map([["heavy", 30], ["light", 5]]),
    };
    const heavy = scoreTask(
      task({ id: "heavy", assignmentId: "a1" }),
      context,
    );
    const light = scoreTask(
      task({ id: "light", assignmentId: "a2" }),
      context,
    );
    expect(pointsFor(heavy, "assessmentWeight")).toBeGreaterThan(
      pointsFor(light, "assessmentWeight"),
    );
  });

  it("ignores assessment weight for a task not tied to assessed work", () => {
    const context: ScoringContext = {
      ...base,
      assessmentWeight: new Map([["t1", 30]]),
    };
    expect(pointsFor(scoreTask(task({ assignmentId: null }), context), "assessmentWeight"))
      .toBe(0);
  });

  it("raises tasks in a module that is behind", () => {
    const context: ScoringContext = {
      ...base,
      moduleRisk: new Map([["eeen20070", 50]]),
      moduleCode: new Map([["eeen20070", "EEEN20070"]]),
    };
    const scored = scoreTask(task(), context);
    expect(pointsFor(scored, "moduleRisk")).toBeCloseTo(WEIGHTS.moduleRisk / 2, 6);
    expect(scored.reason).toContain("EEEN20070 is falling behind");
  });

  it("credits required weekly work", () => {
    expect(pointsFor(scoreTask(task({ isRequiredWeekly: true }), base), "weeklyRequirement"))
      .toBe(WEIGHTS.weeklyRequirement);
  });

  it("raises a neglected module", () => {
    const context: ScoringContext = {
      ...base,
      lastWorked: new Map([["eeen20070", new Date(2026, 8, 25)]]),
      moduleCode: new Map([["eeen20070", "EEEN20070"]]),
    };
    const scored = scoreTask(task(), context);
    expect(pointsFor(scored, "neglect")).toBeGreaterThan(0);
  });

  it("adds a user override directly, unscaled", () => {
    expect(pointsFor(scoreTask(task({ priorityOverride: 15 }), base), "override"))
      .toBe(15);
  });
});

describe("duration affects fit, not importance", () => {
  const context: ScoringContext = { ...base, minutesAvailable: 40 };

  it("prefers a task that fits the gap over a longer, similar one", () => {
    // The brief's example: 40 minutes free, prefer the 30-minute task.
    const ranked = rankTasks(
      [
        task({ id: "short", estimatedMinutes: 30, dueAt: daysFromNow(1) }),
        task({ id: "long", estimatedMinutes: 120, dueAt: daysFromNow(1) }),
      ],
      context,
    );
    expect(ranked[0]!.task.id).toBe("short");
    expect(ranked[0]!.fits).toBe(true);
    expect(ranked[1]!.fits).toBe(false);
  });

  it("demotes rather than excludes -- importance still wins if big enough", () => {
    const ranked = rankTasks(
      [
        // Trivial but fits.
        task({ id: "small", estimatedMinutes: 10, dueAt: daysFromNow(6) }),
        // Badly overdue and heavy, but too long for the gap.
        task({
          id: "urgent",
          estimatedMinutes: 180,
          dueAt: daysFromNow(-6),
          priorityOverride: 10,
        }),
      ],
      context,
    );
    expect(ranked[0]!.task.id).toBe("urgent");
    expect(ranked[0]!.fits).toBe(false);
    expect(ranked[0]!.reason).toContain("40 minutes");
  });

  it("treats an unestimated task as fitting rather than guessing", () => {
    const scored = scoreTask(task({ estimatedMinutes: null }), context);
    expect(scored.fits).toBe(true);
  });

  it("ignores fit entirely when nothing is scheduled next", () => {
    const scored = scoreTask(task({ estimatedMinutes: 600 }), {
      ...base,
      minutesAvailable: null,
    });
    expect(scored.fits).toBe(true);
    expect(scored.adjustments).toHaveLength(0);
  });
});

describe("red-line demotion", () => {
  it("ranks extracurricular work lower while university is behind", () => {
    const context: ScoringContext = { ...base, universityAtRisk: true };
    const scored = scoreTask(
      task({ areaId: "gaelforce", moduleId: null, dueAt: daysFromNow(0) }),
      context,
    );
    expect(scored.adjustments.some((a) => a.key === "redLine")).toBe(true);
    // Demoted, not removed.
    expect(scored.score).toBeGreaterThan(0);
  });

  it("never demotes university work", () => {
    const scored = scoreTask(task({ dueAt: daysFromNow(0) }), {
      ...base,
      universityAtRisk: true,
    });
    expect(scored.adjustments.some((a) => a.key === "redLine")).toBe(false);
  });

  it("does not demote extracurricular work when nothing is behind", () => {
    const scored = scoreTask(
      task({ areaId: "gaelforce", moduleId: null }),
      { ...base, universityAtRisk: false },
    );
    expect(scored.adjustments).toHaveLength(0);
  });
});

describe("the reason", () => {
  it("is always present", () => {
    expect(scoreTask(task(), base).reason.length).toBeGreaterThan(0);
  });

  it("names the actual top factors, matching the scoring", () => {
    const context: ScoringContext = {
      ...base,
      assessmentWeight: new Map([["t1", 10]]),
      moduleRisk: new Map([["eeen20070", 40]]),
      moduleCode: new Map([["eeen20070", "Solid State"]]),
    };
    const scored = scoreTask(
      task({ assignmentId: "a1", dueAt: daysFromNow(1) }),
      context,
    );
    // "due tomorrow, worth 10%, and Solid State is falling behind"
    expect(scored.reason).toContain("due tomorrow");
    expect(scored.reason).toContain("worth 10%");
    expect(scored.reason).toContain("Solid State is falling behind");
  });

  it("only cites factors that actually scored", () => {
    const scored = scoreTask(task({ dueAt: daysFromNow(1) }), base);
    expect(scored.reason).not.toContain("worth");
    expect(scored.reason).not.toContain("falling behind");
  });

  it("caps at three factors so it stays a sentence", () => {
    const context: ScoringContext = {
      ...base,
      assessmentWeight: new Map([["t1", 40]]),
      moduleRisk: new Map([["eeen20070", 80]]),
      moduleCode: new Map([["eeen20070", "EEEN20070"]]),
      lastWorked: new Map([["eeen20070", new Date(2026, 8, 20)]]),
    };
    const scored = scoreTask(
      task({
        assignmentId: "a1",
        dueAt: daysFromNow(-3),
        isRequiredWeekly: true,
        priorityOverride: 5,
      }),
      context,
    );
    expect(scored.components.length).toBeGreaterThan(3);
    // Three fragments => at most two separators.
    expect(scored.reason.split(/,| and /).length).toBeLessThanOrEqual(4);
  });

  it("says something sensible when nothing is pressing", () => {
    const scored = scoreTask(task({ estimatedMinutes: null }), base);
    expect(scored.reason).toContain("Nothing else is competing");
  });
});

describe("rankTasks", () => {
  it("excludes finished and deferred work", () => {
    const ranked = rankTasks(
      [
        task({ id: "open" }),
        task({ id: "done", status: "done" }),
        task({ id: "submitted", status: "submitted" }),
        task({ id: "dropped", deferredAt: "2026-10-01T00:00:00.000Z" }),
      ],
      base,
    );
    expect(ranked.map((r) => r.task.id)).toEqual(["open"]);
  });

  it("includes in-progress work", () => {
    const ranked = rankTasks([task({ status: "in_progress" })], base);
    expect(ranked).toHaveLength(1);
  });

  it("is deterministic for identical inputs", () => {
    const tasks = [
      task({ id: "b", estimatedMinutes: 30 }),
      task({ id: "a", estimatedMinutes: 30 }),
    ];
    const first = rankTasks(tasks, base).map((r) => r.task.id);
    const second = rankTasks([...tasks].reverse(), base).map((r) => r.task.id);
    expect(first).toEqual(second);
  });

  it("breaks ties toward the shorter task", () => {
    const ranked = rankTasks(
      [
        task({ id: "long", estimatedMinutes: 180 }),
        task({ id: "short", estimatedMinutes: 20 }),
      ],
      base,
    );
    expect(ranked[0]!.task.id).toBe("short");
  });
});

describe("recommendNext", () => {
  it("returns null when nothing is open", () => {
    expect(recommendNext([task({ status: "done" })], base)).toBeNull();
  });

  it("picks the overdue, heavy, at-risk task over a light one", () => {
    // The brief's worked example: Solid State Tutorial 4, overdue 3 days,
    // module falling behind, chosen over a distant low-value task.
    const context: ScoringContext = {
      ...base,
      assessmentWeight: new Map([["solid", 10]]),
      moduleRisk: new Map([["eeen20070", 40]]),
      moduleCode: new Map([["eeen20070", "Solid State"]]),
    };
    const next = recommendNext(
      [
        task({
          id: "solid",
          title: "Solid State Tutorial 4",
          assignmentId: "a1",
          dueAt: daysFromNow(-3),
        }),
        task({
          id: "light",
          title: "Read one paper",
          moduleId: null,
          dueAt: daysFromNow(12),
        }),
      ],
      context,
    );
    expect(next?.task.title).toBe("Solid State Tutorial 4");
    expect(next?.reason).toContain("overdue");
  });
});

import { describe, expect, it } from "vitest";
import {
  buildRadar,
  stageProgress,
  stageStates,
  SUBMISSION_STAGES,
  type RadarModule,
} from "./radar";
import type { RiskAssessment } from "./risk";
import type { TermConfig } from "./term-week";

const term: TermConfig = {
  id: "t",
  label: "T",
  startDate: "2026-09-07",
  teachingWeeks: 12,
  breakAfterWeeks: [],
};

const assessment = (over: Partial<RiskAssessment> = {}): RiskAssessment => ({
  id: "a",
  title: "Lab Report",
  weightPercent: 10,
  dueWeek: null,
  dueWeekEnd: null,
  dueAt: null,
  isExam: false,
  isSubmitted: false,
  startedAt: null,
  mainWorkDoneAt: null,
  estimatedMinutes: 120,
  ...over,
});

const moduleWith = (
  code: string,
  assessments: RiskAssessment[],
): RadarModule => ({
  code,
  name: code,
  colorToken: "sky",
  assessments,
});

/** Monday of teaching week 5 = 5 Oct 2026. */
const week5 = new Date(2026, 9, 5, 12, 0, 0);

describe("buildRadar", () => {
  it("orders by due date, soonest first", () => {
    const radar = buildRadar(
      [
        moduleWith("A", [
          assessment({ id: "later", dueAt: "2026-10-14T23:59:00.000Z" }),
          assessment({ id: "sooner", dueAt: "2026-10-08T23:59:00.000Z" }),
        ]),
      ],
      { term, now: week5 },
    );
    expect(radar.map((r) => r.id)).toEqual(["sooner", "later"]);
  });

  it("breaks ties on weight, because 20% outranks 5%", () => {
    const radar = buildRadar(
      [
        moduleWith("A", [
          assessment({ id: "light", weightPercent: 5, dueAt: "2026-10-08T23:59:00.000Z" }),
          assessment({ id: "heavy", weightPercent: 20, dueAt: "2026-10-08T23:59:00.000Z" }),
        ]),
      ],
      { term, now: week5 },
    );
    expect(radar.map((r) => r.id)).toEqual(["heavy", "light"]);
  });

  it("respects the horizon", () => {
    const radar = buildRadar(
      [
        moduleWith("A", [
          assessment({ id: "inside", dueAt: "2026-10-15T23:59:00.000Z" }),
          assessment({ id: "outside", dueAt: "2026-11-20T23:59:00.000Z" }),
        ]),
      ],
      { term, now: week5, days: 14 },
    );
    expect(radar.map((r) => r.id)).toEqual(["inside"]);
  });

  it("keeps overdue work visible no matter how far past it is", () => {
    // Assessed work must be impossible to forget.
    const radar = buildRadar(
      [moduleWith("A", [assessment({ id: "old", dueAt: "2026-09-10T23:59:00.000Z" })])],
      { term, now: week5, days: 14 },
    );
    expect(radar.map((r) => r.id)).toEqual(["old"]);
    expect(radar[0]!.daysAway).toBeLessThan(0);
    expect(radar[0]!.risk.level).toBe("at-risk");
  });

  it("drops submitted work", () => {
    const radar = buildRadar(
      [
        moduleWith("A", [
          assessment({ id: "done", dueAt: "2026-10-08T23:59:00.000Z", isSubmitted: true }),
        ]),
      ],
      { term, now: week5 },
    );
    expect(radar).toHaveLength(0);
  });

  it("excludes undated exams unless asked for", () => {
    const exam = assessment({ id: "final", isExam: true, weightPercent: 60 });
    expect(buildRadar([moduleWith("A", [exam])], { term, now: week5 })).toHaveLength(0);
    expect(
      buildRadar([moduleWith("A", [exam])], {
        term,
        now: week5,
        includeUndated: true,
      }),
    ).toHaveLength(1);
  });

  it("sorts undated exams last", () => {
    const radar = buildRadar(
      [
        moduleWith("A", [
          assessment({ id: "final", isExam: true, weightPercent: 85 }),
          assessment({ id: "dated", dueAt: "2026-10-08T23:59:00.000Z" }),
        ]),
      ],
      { term, now: week5, includeUndated: true },
    );
    expect(radar.map((r) => r.id)).toEqual(["dated", "final"]);
  });

  it("marks items known only by a UCD week window", () => {
    const radar = buildRadar(
      [moduleWith("A", [assessment({ id: "window", dueWeek: 6, dueWeekEnd: 6 })])],
      { term, now: week5 },
    );
    expect(radar[0]!.isWindowOnly).toBe(true);
  });

  it("does not mark a pinned date as a window", () => {
    const radar = buildRadar(
      [
        moduleWith("A", [
          assessment({ id: "pinned", dueWeek: 6, dueAt: "2026-10-08T23:59:00.000Z" }),
        ]),
      ],
      { term, now: week5 },
    );
    expect(radar[0]!.isWindowOnly).toBe(false);
  });

  it("carries the module identity through for display", () => {
    const radar = buildRadar(
      [moduleWith("EEEN20070", [assessment({ dueAt: "2026-10-08T23:59:00.000Z" })])],
      { term, now: week5 },
    );
    expect(radar[0]!.moduleCode).toBe("EEEN20070");
    expect(radar[0]!.colorToken).toBe("sky");
  });
});

describe("submission stages", () => {
  const blank = {
    readBriefAt: null,
    startedAt: null,
    mainWorkDoneAt: null,
    checkedAt: null,
    isSubmitted: false,
    submissionVerifiedAt: null,
  };

  it("has six stages, ending after submission", () => {
    expect(SUBMISSION_STAGES).toHaveLength(6);
    // Submission is not the final stage -- verification is.
    expect(SUBMISSION_STAGES[4]!.key).toBe("isSubmitted");
    expect(SUBMISSION_STAGES[5]!.key).toBe("submissionVerifiedAt");
  });

  it("reports nothing done for a fresh assessment", () => {
    expect(stageStates(blank).every((s) => !s.done)).toBe(true);
    expect(stageProgress(stageStates(blank))).toBe(0);
  });

  it("tracks stages independently, since work does not always go in order", () => {
    const states = stageStates({
      ...blank,
      readBriefAt: "2026-10-01T10:00:00.000Z",
      mainWorkDoneAt: "2026-10-05T10:00:00.000Z",
    });
    expect(states.find((s) => s.key === "readBriefAt")!.done).toBe(true);
    expect(states.find((s) => s.key === "startedAt")!.done).toBe(false);
    expect(states.find((s) => s.key === "mainWorkDoneAt")!.done).toBe(true);
  });

  it("never infers submission from the work being finished", () => {
    const states = stageStates({
      ...blank,
      readBriefAt: "x",
      startedAt: "x",
      mainWorkDoneAt: "x",
      checkedAt: "x",
    });
    expect(states.find((s) => s.key === "isSubmitted")!.done).toBe(false);
    expect(stageProgress(states)).toBeCloseTo(4 / 6, 6);
  });

  it("reaches full progress only when verified", () => {
    const states = stageStates({
      readBriefAt: "x",
      startedAt: "x",
      mainWorkDoneAt: "x",
      checkedAt: "x",
      isSubmitted: true,
      submissionVerifiedAt: "x",
    });
    expect(stageProgress(states)).toBe(1);
  });
});

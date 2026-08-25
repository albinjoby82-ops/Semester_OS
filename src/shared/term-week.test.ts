import { describe, expect, it } from "vitest";
import {
  allTeachingWeeks,
  dateRangeForWeek,
  formatRange,
  parseISODate,
  resolveWeekWindow,
  startOfWeek,
  teachingWeekForDate,
  totalCalendarWeeks,
  weekForDate,
  type TermConfig,
} from "./term-week";

/**
 * Synthetic config: term starts Monday 7 Sep 2026, 12 teaching weeks, with a
 * break week inserted after teaching week 8. Deliberately not the real UCD
 * config -- these tests prove the arithmetic, not the calendar.
 */
const term: TermConfig = {
  id: "test-term",
  label: "Test Term",
  startDate: "2026-09-07",
  teachingWeeks: 12,
  breakAfterWeeks: [8],
};

const straightThrough: TermConfig = { ...term, breakAfterWeeks: [] };

const d = parseISODate;

describe("startOfWeek", () => {
  it("returns the same Monday for a Monday", () => {
    expect(startOfWeek(d("2026-09-07")).toISOString()).toBe(
      "2026-09-07T00:00:00.000Z",
    );
  });

  it("walks back to Monday from mid-week", () => {
    expect(startOfWeek(d("2026-09-10")).toISOString()).toBe(
      "2026-09-07T00:00:00.000Z",
    );
  });

  it("treats Sunday as the end of the week, not the start", () => {
    // Sunday 13 Sep belongs to the week beginning Monday 7 Sep.
    expect(startOfWeek(d("2026-09-13")).toISOString()).toBe(
      "2026-09-07T00:00:00.000Z",
    );
  });

  it("is stable when given a time-of-day, not just a date", () => {
    const withTime = new Date("2026-09-10T23:45:00.000Z");
    expect(startOfWeek(withTime).toISOString()).toBe(
      "2026-09-07T00:00:00.000Z",
    );
  });
});

describe("weekForDate", () => {
  it("reports week 1 on the first Monday", () => {
    expect(weekForDate(d("2026-09-07"), term)).toEqual({
      kind: "teaching",
      week: 1,
    });
  });

  it("reports week 1 on the Sunday that closes week 1", () => {
    expect(weekForDate(d("2026-09-13"), term)).toEqual({
      kind: "teaching",
      week: 1,
    });
  });

  it("reports before-term for the day before the term starts", () => {
    expect(weekForDate(d("2026-09-06"), term)).toEqual({ kind: "before-term" });
  });

  it("reports before-term well ahead of the term", () => {
    expect(weekForDate(d("2026-08-25"), term)).toEqual({ kind: "before-term" });
  });

  it("counts straight through weeks 1-8", () => {
    // Week 8 begins 8 * 7 = 49 days after the start: 26 Oct 2026.
    expect(weekForDate(d("2026-10-26"), term)).toEqual({
      kind: "teaching",
      week: 8,
    });
  });

  it("identifies the break week after week 8", () => {
    expect(weekForDate(d("2026-11-02"), term)).toEqual({
      kind: "break",
      afterWeek: 8,
    });
  });

  it("resumes at week 9 after the break", () => {
    expect(weekForDate(d("2026-11-09"), term)).toEqual({
      kind: "teaching",
      week: 9,
    });
  });

  it("reports after-term past the final teaching week", () => {
    // 12 teaching weeks + 1 break = 13 calendar weeks; the 14th is past it.
    expect(weekForDate(d("2026-12-14"), term)).toEqual({ kind: "after-term" });
  });

  it("has no break week when none is configured", () => {
    expect(weekForDate(d("2026-11-02"), straightThrough)).toEqual({
      kind: "teaching",
      week: 9,
    });
  });
});

describe("teachingWeekForDate", () => {
  it("returns the week number during teaching", () => {
    expect(teachingWeekForDate(d("2026-09-14"), term)).toBe(2);
  });

  it("returns null during the break week", () => {
    expect(teachingWeekForDate(d("2026-11-02"), term)).toBeNull();
  });

  it("returns null before and after term", () => {
    expect(teachingWeekForDate(d("2026-08-01"), term)).toBeNull();
    expect(teachingWeekForDate(d("2027-01-01"), term)).toBeNull();
  });
});

describe("dateRangeForWeek", () => {
  it("gives a Monday-to-Monday exclusive range", () => {
    const range = dateRangeForWeek(1, term);
    expect(range.start.toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-09-14T00:00:00.000Z");
  });

  it("skips the break week when computing later weeks", () => {
    // Week 9 sits one calendar week later than it would without the break.
    expect(dateRangeForWeek(9, term).start.toISOString()).toBe(
      "2026-11-09T00:00:00.000Z",
    );
    expect(dateRangeForWeek(9, straightThrough).start.toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
  });

  it("round-trips with weekForDate for every teaching week", () => {
    for (const week of allTeachingWeeks(term)) {
      const { start } = dateRangeForWeek(week, term);
      expect(weekForDate(start, term)).toEqual({ kind: "teaching", week });
    }
  });

  it("rejects weeks outside the term", () => {
    expect(() => dateRangeForWeek(0, term)).toThrow(RangeError);
    expect(() => dateRangeForWeek(13, term)).toThrow(RangeError);
    expect(() => dateRangeForWeek(1.5, term)).toThrow(RangeError);
  });
});

describe("resolveWeekWindow", () => {
  it("spans a multi-week window such as Weeks 7-9", () => {
    const window = resolveWeekWindow(7, 9, term);
    expect(window.start.toISOString()).toBe("2026-10-19T00:00:00.000Z");
    // Week 9 ends 16 Nov because the break week sits between 8 and 9.
    expect(window.end.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("treats a missing end week as a single week", () => {
    expect(resolveWeekWindow(5, null, term)).toEqual(dateRangeForWeek(5, term));
    expect(resolveWeekWindow(5, undefined, term)).toEqual(
      dateRangeForWeek(5, term),
    );
  });

  it("rejects a reversed window", () => {
    expect(() => resolveWeekWindow(9, 7, term)).toThrow(RangeError);
  });
});

describe("term shape", () => {
  it("counts break weeks in the calendar span", () => {
    expect(totalCalendarWeeks(term)).toBe(13);
    expect(totalCalendarWeeks(straightThrough)).toBe(12);
  });

  it("lists every teaching week in order", () => {
    expect(allTeachingWeeks(term)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
  });
});

describe("parseISODate", () => {
  it("rejects malformed input rather than producing an Invalid Date", () => {
    expect(() => parseISODate("2026-9-7")).toThrow();
    expect(() => parseISODate("not-a-date")).toThrow();
    expect(() => parseISODate("2026-13-01")).toThrow();
  });
});

describe("formatRange", () => {
  it("shows the inclusive last day, not the exclusive end", () => {
    // Week 1 runs Mon 7 Sep to Sun 13 Sep. en-IE abbreviates September as
    // "Sept", so assert against that rather than a hand-written guess.
    expect(formatRange(dateRangeForWeek(1, term))).toBe("7 Sept - 13 Sept");
  });

  it("does not bleed into the following month's first day", () => {
    // Week 4 runs Mon 28 Sep to Sun 4 Oct -- the exclusive end is 5 Oct.
    expect(formatRange(dateRangeForWeek(4, term))).toBe("28 Sept - 4 Oct");
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRID,
  buildWeekPlan,
  busyMinutesForDay,
  formatMinuteOfDay,
  formatMinutes,
  freeSlotsForDay,
  slotsFitting,
  weekTotals,
  type DayPlan,
  type GridBlock,
} from "./week-grid";

const at = (
  dayIndex: number,
  startMinute: number,
  endMinute: number,
  overrides: Partial<GridBlock> = {},
): GridBlock => ({
  id: `${dayIndex}-${startMinute}`,
  dayIndex,
  startMinute,
  endMinute,
  kind: "event",
  title: "Lecture",
  ...overrides,
});

const h = (hours: number, minutes = 0) => hours * 60 + minutes;

/** Indexing a fixed-length week still widens to undefined under strict mode. */
const day = (plan: DayPlan[], index: number): DayPlan => {
  const found = plan[index];
  if (!found) throw new Error(`no day ${index} in plan`);
  return found;
};

describe("freeSlotsForDay", () => {
  it("returns the whole window when nothing is booked", () => {
    expect(freeSlotsForDay([], 0)).toEqual([
      { dayIndex: 0, startMinute: h(8), endMinute: h(22), minutes: h(14) },
    ]);
  });

  it("splits the day around a single block", () => {
    const slots = freeSlotsForDay([at(0, h(9), h(11))], 0);
    expect(slots).toEqual([
      { dayIndex: 0, startMinute: h(8), endMinute: h(9), minutes: 60 },
      { dayIndex: 0, startMinute: h(11), endMinute: h(22), minutes: h(11) },
    ]);
  });

  it("drops gaps shorter than the minimum", () => {
    // 20 minutes between the two lectures is real but not usable.
    const slots = freeSlotsForDay(
      [at(0, h(8), h(10)), at(0, h(10, 20), h(12))],
      0,
    );
    expect(slots).toEqual([
      { dayIndex: 0, startMinute: h(12), endMinute: h(22), minutes: h(10) },
    ]);
  });

  it("keeps a gap exactly at the minimum", () => {
    const slots = freeSlotsForDay(
      [at(0, h(8), h(10)), at(0, h(10, 30), h(12))],
      0,
    );
    expect(slots.at(0)).toEqual({
      dayIndex: 0,
      startMinute: h(10),
      endMinute: h(10, 30),
      minutes: 30,
    });
  });

  it("counts an overlapped hour once rather than twice", () => {
    // A lecture and a task booked over each other must not invent a gap.
    const slots = freeSlotsForDay(
      [at(0, h(9), h(11)), at(0, h(10), h(12), { kind: "task" })],
      0,
    );
    expect(slots).toEqual([
      { dayIndex: 0, startMinute: h(8), endMinute: h(9), minutes: 60 },
      { dayIndex: 0, startMinute: h(12), endMinute: h(22), minutes: h(10) },
    ]);
  });

  it("merges a block fully contained in another", () => {
    const slots = freeSlotsForDay(
      [at(0, h(9), h(13)), at(0, h(10), h(11))],
      0,
    );
    expect(slots).toEqual([
      { dayIndex: 0, startMinute: h(8), endMinute: h(9), minutes: 60 },
      { dayIndex: 0, startMinute: h(13), endMinute: h(22), minutes: h(9) },
    ]);
  });

  it("treats touching blocks as continuous", () => {
    const slots = freeSlotsForDay(
      [at(0, h(8), h(10)), at(0, h(10), h(12))],
      0,
    );
    expect(slots).toEqual([
      { dayIndex: 0, startMinute: h(12), endMinute: h(22), minutes: h(10) },
    ]);
  });

  it("clamps a block that starts before the window", () => {
    // An 07:00 start must not create a negative-length busy interval.
    const slots = freeSlotsForDay([at(0, h(7), h(9))], 0);
    expect(slots).toEqual([
      { dayIndex: 0, startMinute: h(9), endMinute: h(22), minutes: h(13) },
    ]);
  });

  it("ignores a block entirely outside the window", () => {
    const slots = freeSlotsForDay([at(0, h(5), h(7))], 0);
    expect(slots).toEqual([
      { dayIndex: 0, startMinute: h(8), endMinute: h(22), minutes: h(14) },
    ]);
  });

  it("returns nothing when the day is full", () => {
    expect(freeSlotsForDay([at(0, h(8), h(22))], 0)).toEqual([]);
  });

  it("respects a caller-supplied window", () => {
    const slots = freeSlotsForDay([], 0, {
      dayStartMinute: h(10),
      dayEndMinute: h(12),
      minSlotMinutes: 30,
    });
    expect(slots).toEqual([
      { dayIndex: 0, startMinute: h(10), endMinute: h(12), minutes: 120 },
    ]);
  });
});

describe("busyMinutesForDay", () => {
  it("is zero for an empty day", () => {
    expect(busyMinutesForDay([])).toBe(0);
  });

  it("sums separate blocks", () => {
    expect(busyMinutesForDay([at(0, h(9), h(10)), at(0, h(13), h(15))])).toBe(
      180,
    );
  });

  it("counts overlapping blocks once", () => {
    expect(busyMinutesForDay([at(0, h(9), h(11)), at(0, h(10), h(12))])).toBe(
      180,
    );
  });

  it("counts only the part inside the window", () => {
    expect(busyMinutesForDay([at(0, h(6), h(9))])).toBe(60);
  });
});

describe("buildWeekPlan", () => {
  it("always returns seven days", () => {
    expect(buildWeekPlan([])).toHaveLength(7);
  });

  it("assigns blocks to their own day only", () => {
    const plan = buildWeekPlan([at(0, h(9), h(10)), at(3, h(9), h(10))]);
    expect(day(plan, 0).blocks).toHaveLength(1);
    expect(day(plan, 1).blocks).toHaveLength(0);
    expect(day(plan, 3).blocks).toHaveLength(1);
  });

  it("orders a day's blocks by start time", () => {
    const plan = buildWeekPlan([
      at(0, h(14), h(15), { title: "Lab" }),
      at(0, h(9), h(10), { title: "Lecture" }),
    ]);
    expect(day(plan, 0).blocks.map((b) => b.title)).toEqual(["Lecture", "Lab"]);
  });

  it("excludes a block outside the visible window", () => {
    const plan = buildWeekPlan([at(0, h(23), h(23, 30))]);
    expect(day(plan, 0).blocks).toHaveLength(0);
  });

  it("reports busy and free minutes that account for the whole window", () => {
    const plan = buildWeekPlan([at(0, h(9), h(11))]);
    expect(day(plan, 0).busyMinutes).toBe(120);
    expect(day(plan, 0).freeMinutes).toBe(h(14) - 120);
  });

  it("does not count an unusable gap as free", () => {
    // The 20 minute gap is neither busy nor offered, so the two do not sum
    // to the window. That is deliberate and worth pinning down.
    const plan = buildWeekPlan([
      at(0, h(8), h(10)),
      at(0, h(10, 20), h(22)),
    ]);
    expect(day(plan, 0).busyMinutes).toBe(h(14) - 20);
    expect(day(plan, 0).freeMinutes).toBe(0);
  });
});

describe("slotsFitting", () => {
  it("excludes slots shorter than the task", () => {
    // Every other day is booked solid, so only Monday's 08:00-09:00 gap and
    // its 21:30-22:00 tail remain -- neither long enough for two hours.
    const plan = buildWeekPlan([
      at(0, h(9), h(21, 30)),
      ...[1, 2, 3, 4, 5, 6].map((day) => at(day, h(8), h(22))),
    ]);
    expect(slotsFitting(plan, 120)).toEqual([]);
    expect(slotsFitting(plan, 60)).toHaveLength(1);
    expect(slotsFitting(plan, 30)).toHaveLength(2);
  });

  it("offers the tightest fit first so long slots survive", () => {
    const plan = buildWeekPlan([
      // Monday: a 1h gap then the rest of the day booked.
      at(0, h(9), h(22)),
      // Tuesday: wide open.
      at(1, h(8), h(9)),
    ]);
    const fits = slotsFitting(plan, 60);
    expect(fits.at(0)).toMatchObject({ dayIndex: 0, minutes: 60 });
  });

  it("breaks ties towards the earlier day", () => {
    const plan = buildWeekPlan([at(0, h(9), h(22)), at(2, h(9), h(22))]);
    const fits = slotsFitting(plan, 60);
    expect(fits.map((slot) => slot.dayIndex).slice(0, 2)).toEqual([0, 2]);
  });

  it("can skip days already gone", () => {
    const plan = buildWeekPlan([]);
    expect(slotsFitting(plan, 60, 3)).toHaveLength(4);
  });
});

describe("weekTotals", () => {
  it("sums across the week and counts only days with commitments", () => {
    const plan = buildWeekPlan([at(0, h(9), h(11)), at(2, h(9), h(10))]);
    const totals = weekTotals(plan);
    expect(totals.busyMinutes).toBe(180);
    expect(totals.daysWithCommitments).toBe(2);
    expect(totals.freeMinutes).toBe(7 * h(14) - 180);
  });
});

describe("formatting", () => {
  it("formats durations without a bare zero", () => {
    expect(formatMinutes(45)).toBe("45m");
    expect(formatMinutes(60)).toBe("1h");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(formatMinutes(0)).toBe("0m");
  });

  it("zero-pads clock times", () => {
    expect(formatMinuteOfDay(h(9))).toBe("09:00");
    expect(formatMinuteOfDay(h(14, 5))).toBe("14:05");
    expect(formatMinuteOfDay(DEFAULT_GRID.dayEndMinute)).toBe("22:00");
  });
});

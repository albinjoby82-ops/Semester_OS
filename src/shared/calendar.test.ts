import { describe, expect, it } from "vitest";
import {
  busyHoursInWindow,
  clipToWindow,
  eventsInWindow,
  matchModule,
  mergeIntervals,
  minutesUntilNextEvent,
  normaliseEvent,
  type CalendarEventLike,
  type GoogleEvent,
  type MatchableModule,
} from "./calendar";

const iso = (day: number, hour: number, minute = 0): string =>
  new Date(Date.UTC(2026, 9, day, hour, minute)).toISOString();

const event = (over: Partial<CalendarEventLike> = {}): CalendarEventLike => ({
  id: "e1",
  title: "Circuits lecture",
  startAt: iso(7, 9),
  endAt: iso(7, 11),
  isAllDay: false,
  moduleId: null,
  areaId: null,
  ...over,
});

const window = {
  start: new Date(Date.UTC(2026, 9, 5)),
  end: new Date(Date.UTC(2026, 9, 12)),
};

const modules: MatchableModule[] = [
  { id: "eeen20020", code: "EEEN20020", name: "Electrical and Electronic Circuits" },
  { id: "math20290", code: "MATH20290", name: "Multivariable Calculus for Engineers" },
];

describe("mergeIntervals", () => {
  it("merges overlapping intervals", () => {
    const merged = mergeIntervals([
      { start: new Date(iso(7, 9)), end: new Date(iso(7, 11)) },
      { start: new Date(iso(7, 10)), end: new Date(iso(7, 12)) },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.end.toISOString()).toBe(iso(7, 12));
  });

  it("keeps separate intervals apart", () => {
    expect(
      mergeIntervals([
        { start: new Date(iso(7, 9)), end: new Date(iso(7, 10)) },
        { start: new Date(iso(7, 14)), end: new Date(iso(7, 15)) },
      ]),
    ).toHaveLength(2);
  });

  it("treats touching intervals as contiguous", () => {
    expect(
      mergeIntervals([
        { start: new Date(iso(7, 9)), end: new Date(iso(7, 10)) },
        { start: new Date(iso(7, 10)), end: new Date(iso(7, 11)) },
      ]),
    ).toHaveLength(1);
  });

  it("drops zero-length and reversed intervals", () => {
    expect(
      mergeIntervals([
        { start: new Date(iso(7, 9)), end: new Date(iso(7, 9)) },
        { start: new Date(iso(7, 12)), end: new Date(iso(7, 10)) },
      ]),
    ).toHaveLength(0);
  });
});

describe("clipToWindow", () => {
  it("clips an event that starts before the window", () => {
    const clipped = clipToWindow(
      { start: new Date(iso(4, 9)), end: new Date(iso(6, 9)) },
      window,
    );
    expect(clipped?.start.toISOString()).toBe(window.start.toISOString());
  });

  it("returns null for an event entirely outside", () => {
    expect(
      clipToWindow(
        { start: new Date(iso(1, 9)), end: new Date(iso(1, 10)) },
        window,
      ),
    ).toBeNull();
  });
});

describe("busyHoursInWindow", () => {
  it("sums event hours", () => {
    expect(
      busyHoursInWindow(
        [event(), event({ id: "e2", startAt: iso(8, 14), endAt: iso(8, 17) })],
        window,
      ),
    ).toBe(5);
  });

  it("does not double-count double-booked slots", () => {
    // A lecture and a reminder on the same slot must not consume two hours.
    expect(
      busyHoursInWindow(
        [
          event(),
          event({ id: "dup", startAt: iso(7, 9, 30), endAt: iso(7, 10, 30) }),
        ],
        window,
      ),
    ).toBe(2);
  });

  it("excludes all-day events by default", () => {
    // An all-day entry must not zero out the week.
    expect(
      busyHoursInWindow(
        [event({ isAllDay: true, startAt: iso(7, 0), endAt: iso(8, 0) })],
        window,
      ),
    ).toBe(0);
  });

  it("can include all-day events when asked", () => {
    expect(
      busyHoursInWindow(
        [event({ isAllDay: true, startAt: iso(7, 0), endAt: iso(8, 0) })],
        window,
        { includeAllDay: true },
      ),
    ).toBe(24);
  });

  it("counts only the part inside the window", () => {
    expect(
      busyHoursInWindow(
        [event({ startAt: iso(11, 22), endAt: iso(12, 2) })],
        window,
      ),
    ).toBe(2);
  });

  it("is zero for an empty calendar", () => {
    expect(busyHoursInWindow([], window)).toBe(0);
  });
});

describe("eventsInWindow", () => {
  it("returns overlapping events soonest first", () => {
    const list = eventsInWindow(
      [
        event({ id: "late", startAt: iso(9, 9), endAt: iso(9, 10) }),
        event({ id: "early", startAt: iso(6, 9), endAt: iso(6, 10) }),
        event({ id: "outside", startAt: iso(20, 9), endAt: iso(20, 10) }),
      ],
      window,
    );
    expect(list.map((e) => e.id)).toEqual(["early", "late"]);
  });
});

describe("minutesUntilNextEvent", () => {
  const now = new Date(iso(7, 8));

  it("reports the gap to the next event", () => {
    expect(minutesUntilNextEvent([event()], now)).toBe(60);
  });

  it("returns 0 while inside an event", () => {
    expect(minutesUntilNextEvent([event()], new Date(iso(7, 10)))).toBe(0);
  });

  it("returns null when nothing is ahead", () => {
    expect(
      minutesUntilNextEvent([event({ startAt: iso(6, 9), endAt: iso(6, 10) })], now),
    ).toBeNull();
  });

  it("picks the soonest of several", () => {
    expect(
      minutesUntilNextEvent(
        [event(), event({ id: "sooner", startAt: iso(7, 8, 30), endAt: iso(7, 9) })],
        now,
      ),
    ).toBe(30);
  });

  it("ignores events beyond the horizon", () => {
    expect(
      minutesUntilNextEvent(
        [event({ startAt: iso(9, 9), endAt: iso(9, 10) })],
        now,
        { withinHours: 6 },
      ),
    ).toBeNull();
  });

  it("ignores all-day events", () => {
    expect(
      minutesUntilNextEvent(
        [event({ isAllDay: true, startAt: iso(7, 9), endAt: iso(8, 9) })],
        now,
      ),
    ).toBeNull();
  });
});

describe("matchModule", () => {
  it("matches on module code", () => {
    expect(matchModule("EEEN20020 Lecture", modules)).toBe("eeen20020");
  });

  it("matches case-insensitively", () => {
    expect(matchModule("eeen20020 lab", modules)).toBe("eeen20020");
  });

  it("matches on a full module name", () => {
    expect(
      matchModule("Multivariable Calculus for Engineers tutorial", modules),
    ).toBe("math20290");
  });

  it("returns null rather than guessing from a vague title", () => {
    // A wrong association corrupts neglect and drift, which is worse than none.
    expect(matchModule("Lecture", modules)).toBeNull();
    expect(matchModule("Maths", modules)).toBeNull();
    expect(matchModule("Team meeting", modules)).toBeNull();
  });
});

describe("normaliseEvent", () => {
  const google = (over: Partial<GoogleEvent> = {}): GoogleEvent => ({
    id: "g1",
    summary: "EEEN20020 Lecture",
    start: { dateTime: iso(7, 9) },
    end: { dateTime: iso(7, 11) },
    ...over,
  });

  it("converts a timed event and matches its module", () => {
    const result = normaliseEvent(google(), modules);
    expect(result).toMatchObject({
      googleEventId: "g1",
      title: "EEEN20020 Lecture",
      isAllDay: false,
      moduleId: "eeen20020",
    });
  });

  it("marks date-only events as all-day", () => {
    const result = normaliseEvent(
      google({ start: { date: "2026-10-07" }, end: { date: "2026-10-08" } }),
      modules,
    );
    expect(result?.isAllDay).toBe(true);
  });

  it("drops cancelled events", () => {
    expect(normaliseEvent(google({ status: "cancelled" }), modules)).toBeNull();
  });

  it("drops events missing an endpoint rather than inventing one", () => {
    expect(normaliseEvent(google({ end: {} }), modules)).toBeNull();
    expect(normaliseEvent(google({ start: {} }), modules)).toBeNull();
  });

  it("drops events with no id", () => {
    expect(normaliseEvent(google({ id: undefined }), modules)).toBeNull();
  });

  it("drops a reversed timed event", () => {
    expect(
      normaliseEvent(
        google({ start: { dateTime: iso(7, 11) }, end: { dateTime: iso(7, 9) } }),
        modules,
      ),
    ).toBeNull();
  });

  it("falls back to a placeholder title rather than an empty one", () => {
    expect(normaliseEvent(google({ summary: "   " }), modules)?.title).toBe(
      "(untitled)",
    );
  });

  it("matches a module mentioned only in the description or location", () => {
    const result = normaliseEvent(
      google({ summary: "Lecture", description: "Module MATH20290" }),
      modules,
    );
    expect(result?.moduleId).toBe("math20290");
  });
});

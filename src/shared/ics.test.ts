import { describe, expect, it } from "vitest";
import { parseIcs, zonedTimeToUtc } from "./ics";

const wrap = (body: string) =>
  `BEGIN:VCALENDAR\nVERSION:2.0\nX-WR-CALNAME:UCD Timetable\nX-WR-TIMEZONE:Europe/Dublin\n${body}\nEND:VCALENDAR\n`;

const HORIZON = new Date("2027-06-01T00:00:00Z");

describe("zonedTimeToUtc", () => {
  it("applies Irish summer time", () => {
    // September is IST (UTC+1): 09:00 local is 08:00Z.
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 9, day: 9, hour: 9, minute: 0, second: 0 },
        "Europe/Dublin",
      ).toISOString(),
    ).toBe("2026-09-09T08:00:00.000Z");
  });

  it("applies winter time after the October change", () => {
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 11, day: 18, hour: 9, minute: 0, second: 0 },
        "Europe/Dublin",
      ).toISOString(),
    ).toBe("2026-11-18T09:00:00.000Z");
  });
});

describe("parseIcs", () => {
  it("reads a single timed event", () => {
    const { events, calendarName } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART:20261118T140000Z",
          "DTEND:20261118T155000Z",
          "UID:one@google.com",
          "LOCATION:Eng & Material Sci Centre 329Lab-ENG",
          "SUMMARY:EEEN20070: Solid State Devices (Laboratory)",
          "END:VEVENT",
        ].join("\n"),
      ),
      { horizon: HORIZON },
    );

    expect(calendarName).toBe("UCD Timetable");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      title: "EEEN20070: Solid State Devices (Laboratory)",
      startAt: "2026-11-18T14:00:00.000Z",
      endAt: "2026-11-18T15:50:00.000Z",
      isAllDay: false,
      location: "Eng & Material Sci Centre 329Lab-ENG",
    });
  });

  it("expands a weekly rule up to UNTIL", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART;TZID=Europe/Dublin:20260909T090000",
          "DTEND;TZID=Europe/Dublin:20260909T095000",
          "RRULE:FREQ=WEEKLY;WKST=SU;UNTIL=20261126;BYDAY=WE",
          "UID:lab@google.com",
          "SUMMARY:EEEN20050: Digital Electronics (Laboratory)",
          "END:VEVENT",
        ].join("\n"),
      ),
      { horizon: HORIZON },
    );

    // Wednesdays from 9 Sep to 25 Nov inclusive.
    expect(events).toHaveLength(12);
    expect(events[0]?.startAt).toBe("2026-09-09T08:00:00.000Z");
    expect(events.at(-1)?.startAt).toBe("2026-11-25T09:00:00.000Z");
  });

  it("keeps the wall-clock time across the DST change", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART;TZID=Europe/Dublin:20261021T090000",
          "DTEND;TZID=Europe/Dublin:20261021T095000",
          "RRULE:FREQ=WEEKLY;UNTIL=20261105;BYDAY=WE",
          "UID:dst@google.com",
          "SUMMARY:EEEN20010: Computer Engineering (Lecture)",
          "END:VEVENT",
        ].join("\n"),
      ),
      { horizon: HORIZON },
    );

    // Clocks go back on 25 October: 08:00Z before, 09:00Z after, 09:00 local
    // throughout -- which is what a student actually turns up to.
    expect(events.map((e) => e.startAt)).toEqual([
      "2026-10-21T08:00:00.000Z",
      "2026-10-28T09:00:00.000Z",
      "2026-11-04T09:00:00.000Z",
    ]);
  });

  it("honours COUNT and multiple BYDAY values", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART;TZID=Europe/Dublin:20260907T130000",
          "DTEND;TZID=Europe/Dublin:20260907T135000",
          "RRULE:FREQ=WEEKLY;COUNT=4;BYDAY=MO,TH",
          "UID:multi@google.com",
          "SUMMARY:MATH20290: Multivariable Calculus for Eng (Lecture)",
          "END:VEVENT",
        ].join("\n"),
      ),
      { horizon: HORIZON },
    );

    expect(events).toHaveLength(4);
    expect(events.map((e) => e.startAt.slice(0, 10))).toEqual([
      "2026-09-07",
      "2026-09-10",
      "2026-09-14",
      "2026-09-17",
    ]);
  });

  it("drops excluded occurrences", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART;TZID=Europe/Dublin:20260909T090000",
          "DTEND;TZID=Europe/Dublin:20260909T095000",
          "RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=WE",
          "EXDATE;TZID=Europe/Dublin:20260916T090000",
          "UID:exdate@google.com",
          "SUMMARY:EEEN20020: Electrical&Electronic Circuits (Lecture)",
          "END:VEVENT",
        ].join("\n"),
      ),
      { horizon: HORIZON },
    );

    expect(events.map((e) => e.startAt.slice(0, 10))).toEqual([
      "2026-09-09",
      "2026-09-23",
    ]);
  });

  it("unfolds wrapped lines", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART:20260907T090000Z",
          "DTEND:20260907T095000Z",
          "UID:fold@google.com",
          "SUMMARY:EEEN20020: Electrical&Electronic Circuits",
          "  (Lecture)",
          "END:VEVENT",
        ].join("\n"),
      ),
      { horizon: HORIZON },
    );

    expect(events[0]?.title).toBe(
      "EEEN20020: Electrical&Electronic Circuits (Lecture)",
    );
  });

  it("treats a date-only event as all day", () => {
    const { events } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART;VALUE=DATE:20261026",
          "DTEND;VALUE=DATE:20261031",
          "UID:allday@google.com",
          "SUMMARY:Study Review Week",
          "END:VEVENT",
        ].join("\n"),
      ),
      { horizon: HORIZON },
    );

    expect(events[0]?.isAllDay).toBe(true);
  });

  it("skips cancelled events with a reason", () => {
    const { events, skipped } = parseIcs(
      wrap(
        [
          "BEGIN:VEVENT",
          "DTSTART:20260907T090000Z",
          "DTEND:20260907T095000Z",
          "UID:gone@google.com",
          "STATUS:CANCELLED",
          "SUMMARY:EEEN20050: Digital Electronics (Tutorial)",
          "END:VEVENT",
        ].join("\n"),
      ),
      { horizon: HORIZON },
    );

    expect(events).toHaveLength(0);
    expect(skipped).toEqual([
      {
        summary: "EEEN20050: Digital Electronics (Tutorial)",
        reason: "cancelled",
      },
    ]);
  });

  it("ignores VTIMEZONE definitions", () => {
    const { events } = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Dublin",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700329T010000",
        "TZOFFSETFROM:+0000",
        "TZNAME:IST",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "DTSTART:20260907T090000Z",
        "DTEND:20260907T095000Z",
        "UID:real@google.com",
        "SUMMARY:SCI20020: Introduction to Leadership (Lecture)",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\n"),
      { horizon: HORIZON },
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.title).toContain("SCI20020");
  });

  it("gives each occurrence a stable, distinct id", () => {
    const ics = wrap(
      [
        "BEGIN:VEVENT",
        "DTSTART;TZID=Europe/Dublin:20260909T090000",
        "DTEND;TZID=Europe/Dublin:20260909T095000",
        "RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=WE",
        "UID:stable@google.com",
        "SUMMARY:EEEN20010: Computer Engineering (Lecture)",
        "END:VEVENT",
      ].join("\n"),
    );

    const first = parseIcs(ics, { horizon: HORIZON }).events.map((e) => e.uid);
    const second = parseIcs(ics, { horizon: HORIZON }).events.map((e) => e.uid);

    expect(new Set(first).size).toBe(3);
    expect(first).toEqual(second);
  });
});

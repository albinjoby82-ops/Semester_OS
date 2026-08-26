/**
 * iCalendar (.ics) parsing.
 *
 * The alternative to the Google Calendar API: a student exports their
 * timetable from Google (or subscribes to UCD's feed) and the app reads the
 * file directly. No OAuth client, no consent screen, no admin approval -- all
 * of which are obstacles a university Workspace account can put in the way.
 *
 * Pure functions only, mirroring `calendar.ts`, so the whole expansion is
 * testable without a database or a network.
 */

export interface IcsEvent {
  /** Stable per-occurrence identity: UID plus the occurrence start. */
  uid: string;
  title: string;
  /** ISO instants, always UTC. */
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  location: string | null;
}

export interface IcsParseResult {
  events: IcsEvent[];
  calendarName: string | null;
  /** Events that could not be used, with the reason, rather than dropped silently. */
  skipped: { summary: string; reason: string }[];
}

/** Occurrences to generate for one recurring event before giving up. */
const MAX_OCCURRENCES = 400;

/** How far ahead an unbounded recurrence is expanded, in days. */
const DEFAULT_HORIZON_DAYS = 400;

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

// ---------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------

/**
 * Offset of a zone at a given instant, in milliseconds.
 *
 * Derived from Intl rather than a hardcoded table so Irish summer time (and
 * any other zone) is handled by the platform's own tz database.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const field = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return asIfUtc - instant.getTime();
}

/**
 * Convert a wall-clock time in a zone to a UTC instant.
 *
 * Two passes: the offset depends on the instant, and the instant depends on
 * the offset. The second pass settles it except in the ambiguous hour of a
 * DST transition, where either answer is defensible.
 */
export function zonedTimeToUtc(
  fields: LocalFields,
  timeZone: string,
): Date {
  const naive = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  const firstPass = naive - zoneOffsetMs(new Date(naive), timeZone);
  const refined = naive - zoneOffsetMs(new Date(firstPass), timeZone);
  return new Date(refined);
}

export interface LocalFields {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// ---------------------------------------------------------------------------
// Lexing
// ---------------------------------------------------------------------------

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

/**
 * Undo RFC 5545 line folding.
 *
 * Long values are split across lines with a leading space or tab, so a naive
 * line-by-line read truncates any summary past 75 octets -- which is most
 * module titles.
 */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

function parseProperty(line: string): Property | null {
  const colon = line.indexOf(":");
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name = "", ...paramParts] = head.split(";");

  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    params[part.slice(0, eq).toUpperCase()] = part
      .slice(eq + 1)
      .replace(/^"|"$/g, "");
  }

  return { name: name.toUpperCase(), params, value };
}

/** Text values escape commas, semicolons and newlines. */
function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\;/g, ";")
    .replace(/\\\\/g, "\\")
    .trim();
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/;
const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;

interface ParsedDate {
  fields: LocalFields;
  /** True when the value carried no time component (VALUE=DATE). */
  dateOnly: boolean;
  /** True when the value was already UTC (trailing Z). */
  utc: boolean;
}

function parseDateValue(value: string): ParsedDate | null {
  const trimmed = value.trim();

  const dateTime = DATE_TIME.exec(trimmed);
  if (dateTime) {
    return {
      fields: {
        year: Number(dateTime[1]),
        month: Number(dateTime[2]),
        day: Number(dateTime[3]),
        hour: Number(dateTime[4]),
        minute: Number(dateTime[5]),
        second: Number(dateTime[6]),
      },
      dateOnly: false,
      utc: dateTime[7] === "Z",
    };
  }

  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    return {
      fields: {
        year: Number(dateOnly[1]),
        month: Number(dateOnly[2]),
        day: Number(dateOnly[3]),
        hour: 0,
        minute: 0,
        second: 0,
      },
      dateOnly: true,
      utc: false,
    };
  }

  return null;
}

/** Resolve a parsed date to an instant, honouring TZID or a trailing Z. */
function toInstant(
  parsed: ParsedDate,
  timeZone: string,
  fallbackZone: string,
): Date {
  if (parsed.utc) {
    return new Date(
      Date.UTC(
        parsed.fields.year,
        parsed.fields.month - 1,
        parsed.fields.day,
        parsed.fields.hour,
        parsed.fields.minute,
        parsed.fields.second,
      ),
    );
  }
  return zonedTimeToUtc(parsed.fields, timeZone || fallbackZone);
}

/** Shift local calendar fields by whole days, normalising overflow. */
function addDays(fields: LocalFields, days: number): LocalFields {
  const shifted = new Date(
    Date.UTC(fields.year, fields.month - 1, fields.day + days),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second,
  };
}

/** Day of week (0 = Sunday) for the calendar date in local fields. */
function weekdayOf(fields: LocalFields): number {
  return new Date(
    Date.UTC(fields.year, fields.month - 1, fields.day),
  ).getUTCDay();
}

function sameCalendarDay(a: LocalFields, b: LocalFields): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

interface Recurrence {
  freq: string;
  interval: number;
  count: number | null;
  until: ParsedDate | null;
  byDay: number[];
}

function parseRrule(value: string): Recurrence {
  const parts: Record<string, string> = {};
  for (const chunk of value.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    parts[chunk.slice(0, eq).toUpperCase()] = chunk.slice(eq + 1);
  }

  const byDay = (parts.BYDAY ?? "")
    .split(",")
    .map((token) => WEEKDAYS.indexOf(token.trim().slice(-2).toUpperCase() as (typeof WEEKDAYS)[number]))
    .filter((index) => index >= 0);

  return {
    freq: (parts.FREQ ?? "").toUpperCase(),
    interval: Math.max(1, Number(parts.INTERVAL ?? "1") || 1),
    count: parts.COUNT ? Number(parts.COUNT) : null,
    until: parts.UNTIL ? parseDateValue(parts.UNTIL) : null,
    byDay,
  };
}

/**
 * Expand a weekly recurrence into concrete local start times.
 *
 * Expansion happens in local calendar fields rather than on instants, so a
 * 09:00 lecture stays at 09:00 after the October clock change instead of
 * drifting to 08:00 for the rest of the trimester.
 */
function expandWeekly(
  start: LocalFields,
  rule: Recurrence,
  horizon: Date,
  timeZone: string,
): LocalFields[] {
  const days = rule.byDay.length > 0 ? [...rule.byDay].sort() : [weekdayOf(start)];

  // Sunday-anchored week containing DTSTART, so BYDAY offsets are absolute.
  const weekStart = addDays(start, -weekdayOf(start));

  const untilMs = rule.until
    ? toInstant(
        rule.until.dateOnly
          ? { ...rule.until, fields: { ...rule.until.fields, hour: 23, minute: 59, second: 59 } }
          : rule.until,
        timeZone,
        timeZone,
      ).getTime()
    : null;

  const startMs = zonedTimeToUtc(start, timeZone).getTime();
  const horizonMs = horizon.getTime();

  const occurrences: LocalFields[] = [];
  for (let week = 0; occurrences.length < MAX_OCCURRENCES; week += 1) {
    const offset = week * rule.interval * 7;
    if (offset > 365 * 5) break;

    let anyInRange = false;
    for (const day of days) {
      const local = addDays(weekStart, offset + day);
      const instantMs = zonedTimeToUtc(local, timeZone).getTime();

      if (instantMs < startMs) continue;
      if (untilMs !== null && instantMs > untilMs) continue;
      if (instantMs > horizonMs) continue;

      anyInRange = true;
      occurrences.push(local);
      if (rule.count !== null && occurrences.length >= rule.count) {
        return occurrences;
      }
    }

    // Nothing landed in range and we are past the start: the rule is spent.
    const weekInstant = zonedTimeToUtc(addDays(weekStart, offset), timeZone).getTime();
    if (!anyInRange && weekInstant > startMs) {
      if (untilMs !== null && weekInstant > untilMs) break;
      if (weekInstant > horizonMs) break;
    }
  }

  return occurrences;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Basic-format stamp of local fields, used for EXDATE matching and ids. */
function stamp(fields: LocalFields): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(fields.year, 4)}${pad(fields.month)}${pad(fields.day)}T${pad(fields.hour)}${pad(fields.minute)}${pad(fields.second)}`;
}

/** Deterministic id for one occurrence, so re-importing updates rather than duplicates. */
export function occurrenceId(uid: string, fields: LocalFields): string {
  return `ics:${uid}:${stamp(fields)}`;
}

/**
 * Parse an .ics file into concrete, non-recurring events.
 *
 * Recurring entries are expanded, because everything downstream (capacity,
 * the next-commitment gap, drift) reasons about individual occurrences.
 */
export function parseIcs(
  text: string,
  options: { horizon?: Date; defaultTimeZone?: string } = {},
): IcsParseResult {
  const lines = unfold(text);
  const horizon =
    options.horizon ??
    new Date(Date.now() + DEFAULT_HORIZON_DAYS * 86_400_000);

  let calendarName: string | null = null;
  let fallbackZone = options.defaultTimeZone ?? "UTC";

  const events: IcsEvent[] = [];
  const skipped: { summary: string; reason: string }[] = [];

  let current: Property[] | null = null;
  // VTIMEZONE carries nested blocks with their own DTSTART and RRULE values
  // describing DST rules. They are not events, and reading them as such
  // invents a lecture in 1970.
  let timezoneDepth = 0;

  for (const line of lines) {
    const property = parseProperty(line);
    if (!property) continue;

    if (property.name === "BEGIN") {
      if (property.value === "VTIMEZONE" || timezoneDepth > 0) {
        timezoneDepth += 1;
      } else if (property.value === "VEVENT") {
        current = [];
      }
      continue;
    }

    if (property.name === "END") {
      if (timezoneDepth > 0) {
        timezoneDepth -= 1;
      } else if (property.value === "VEVENT" && current) {
        const built = buildEvent(current, fallbackZone, horizon);
        if ("reason" in built) skipped.push(built);
        else events.push(...built.events);
        current = null;
      }
      continue;
    }

    if (timezoneDepth > 0) continue;

    if (current) {
      current.push(property);
      continue;
    }
    if (property.name === "X-WR-CALNAME") calendarName = unescapeText(property.value);
    if (property.name === "X-WR-TIMEZONE") fallbackZone = property.value.trim();
  }

  events.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return { events, calendarName, skipped };
}

function buildEvent(
  properties: Property[],
  fallbackZone: string,
  horizon: Date,
): { events: IcsEvent[] } | { summary: string; reason: string } {
  const find = (name: string) => properties.find((p) => p.name === name);

  const summaryProperty = find("SUMMARY");
  const title = summaryProperty ? unescapeText(summaryProperty.value) : "(untitled)";

  if (find("STATUS")?.value.toUpperCase() === "CANCELLED") {
    return { summary: title, reason: "cancelled" };
  }

  const startProperty = find("DTSTART");
  if (!startProperty) return { summary: title, reason: "no start time" };

  const start = parseDateValue(startProperty.value);
  if (!start) return { summary: title, reason: "unreadable start time" };

  const timeZone = startProperty.params.TZID || fallbackZone;
  const isAllDay = start.dateOnly || startProperty.params.VALUE === "DATE";

  const endProperty = find("DTEND");
  const end = endProperty ? parseDateValue(endProperty.value) : null;

  const startInstant = toInstant(start, timeZone, fallbackZone);
  const endInstant = end
    ? toInstant(end, endProperty?.params.TZID || timeZone, fallbackZone)
    : new Date(startInstant.getTime() + (isAllDay ? 86_400_000 : 3_600_000));

  const durationMs = Math.max(0, endInstant.getTime() - startInstant.getTime());

  const uid = find("UID")?.value.trim() || `${stamp(start.fields)}-${title}`;
  const locationProperty = find("LOCATION");
  const location = locationProperty ? unescapeText(locationProperty.value) : null;

  // EXDATE removes specific occurrences -- a cancelled lecture in an
  // otherwise weekly series. Matched on the local stamp, as written.
  const excluded = new Set<string>();
  for (const property of properties) {
    if (property.name !== "EXDATE") continue;
    for (const value of property.value.split(",")) {
      const parsed = parseDateValue(value);
      if (parsed) excluded.add(stamp(parsed.fields));
    }
  }

  const rruleProperty = find("RRULE");
  const starts: LocalFields[] = [];

  if (!rruleProperty) {
    starts.push(start.fields);
  } else {
    const rule = parseRrule(rruleProperty.value);
    if (rule.freq === "WEEKLY") {
      starts.push(...expandWeekly(start.fields, rule, horizon, timeZone));
    } else {
      // Daily/monthly/yearly rules are rare in a timetable. Keep the first
      // occurrence rather than dropping the event entirely, and say so.
      starts.push(start.fields);
      if (rule.freq) {
        return {
          events: [
            makeEvent(uid, title, start.fields, durationMs, isAllDay, location, timeZone, start.utc),
          ],
        };
      }
    }
  }

  const events = starts
    .filter((fields) => !excluded.has(stamp(fields)))
    .map((fields) =>
      makeEvent(uid, title, fields, durationMs, isAllDay, location, timeZone, start.utc),
    );

  return { events };
}

function makeEvent(
  uid: string,
  title: string,
  fields: LocalFields,
  durationMs: number,
  isAllDay: boolean,
  location: string | null,
  timeZone: string,
  isUtc: boolean,
): IcsEvent {
  const startInstant = isUtc
    ? new Date(
        Date.UTC(
          fields.year,
          fields.month - 1,
          fields.day,
          fields.hour,
          fields.minute,
          fields.second,
        ),
      )
    : zonedTimeToUtc(fields, timeZone);

  return {
    uid: occurrenceId(uid, fields),
    title,
    startAt: startInstant.toISOString(),
    endAt: new Date(startInstant.getTime() + durationMs).toISOString(),
    isAllDay,
    location,
  };
}

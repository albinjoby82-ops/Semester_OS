/**
 * Calendar reasoning.
 *
 * Google Calendar is the source of truth for WHEN (brief section 15). The app
 * mirrors the minimum it needs to answer two questions: how much time is
 * actually free this week, and how long until the next thing starts.
 *
 * Pure functions only — the fetching and token handling live in the server
 * route, so all of this is testable without credentials.
 */

export interface CalendarEventLike {
  id: string;
  title: string;
  /** ISO instants. */
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  moduleId: string | null;
  areaId: string | null;
}

export interface Interval {
  start: Date;
  end: Date;
}

const MS_PER_HOUR = 3_600_000;

/**
 * Merge overlapping intervals.
 *
 * Double-booked calendar entries are normal — a lecture and a reminder on the
 * same slot must not consume two hours of capacity between them.
 */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const valid = intervals
    .filter((i) => i.end.getTime() > i.start.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Interval[] = [];
  for (const interval of valid) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end.getTime() > last.end.getTime()) last.end = interval.end;
    } else {
      merged.push({ start: new Date(interval.start), end: new Date(interval.end) });
    }
  }
  return merged;
}

/** Clip an interval to a window, or null when it falls entirely outside. */
export function clipToWindow(
  interval: Interval,
  window: Interval,
): Interval | null {
  const start = new Date(
    Math.max(interval.start.getTime(), window.start.getTime()),
  );
  const end = new Date(Math.min(interval.end.getTime(), window.end.getTime()));
  return end.getTime() > start.getTime() ? { start, end } : null;
}

/**
 * Hours genuinely occupied by calendar events inside a window.
 *
 * All-day events are excluded: an all-day "Reading week" or a birthday does
 * not consume 24 hours of working capacity, and treating it as though it did
 * would zero out the week.
 */
export function busyHoursInWindow(
  events: readonly CalendarEventLike[],
  window: Interval,
  options: { includeAllDay?: boolean } = {},
): number {
  const intervals: Interval[] = [];

  for (const event of events) {
    if (event.isAllDay && !options.includeAllDay) continue;
    const clipped = clipToWindow(
      { start: new Date(event.startAt), end: new Date(event.endAt) },
      window,
    );
    if (clipped) intervals.push(clipped);
  }

  return mergeIntervals(intervals).reduce(
    (total, i) => total + (i.end.getTime() - i.start.getTime()) / MS_PER_HOUR,
    0,
  );
}

/** Events overlapping a window, soonest first. */
export function eventsInWindow(
  events: readonly CalendarEventLike[],
  window: Interval,
): CalendarEventLike[] {
  return events
    .filter((event) =>
      clipToWindow(
        { start: new Date(event.startAt), end: new Date(event.endAt) },
        window,
      ),
    )
    .sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    );
}

/**
 * Minutes until the next event starts.
 *
 * Returns 0 while inside an event (there is no gap right now) and null when
 * nothing is scheduled ahead, which the ranking treats as "no constraint"
 * rather than "no time".
 */
export function minutesUntilNextEvent(
  events: readonly CalendarEventLike[],
  now: Date = new Date(),
  options: { withinHours?: number } = {},
): number | null {
  const horizon = (options.withinHours ?? 24) * MS_PER_HOUR;
  const limit = now.getTime() + horizon;
  let soonest: number | null = null;

  for (const event of events) {
    if (event.isAllDay) continue;
    const start = new Date(event.startAt).getTime();
    const end = new Date(event.endAt).getTime();

    if (now.getTime() >= start && now.getTime() < end) return 0;
    if (start <= now.getTime() || start > limit) continue;

    const minutes = Math.round((start - now.getTime()) / 60_000);
    if (soonest == null || minutes < soonest) soonest = minutes;
  }

  return soonest;
}

export interface MatchableModule {
  id: string;
  code: string;
  name: string;
}

/**
 * Guess which module a calendar event belongs to.
 *
 * Deliberately conservative: a module code is unambiguous, a full module name
 * is nearly so, and anything vaguer is left unmatched. A wrong association
 * would silently attribute hours to the wrong module and corrupt both the
 * neglect signal and the drift breakdown, which is worse than no association.
 */
export function matchModule(
  text: string,
  modules: readonly MatchableModule[],
): string | null {
  const haystack = text.toLowerCase();

  for (const module of modules) {
    if (haystack.includes(module.code.toLowerCase())) return module.id;
  }

  for (const module of modules) {
    const name = module.name.toLowerCase();
    if (name.length >= 8 && haystack.includes(name)) return module.id;
  }

  return null;
}

/** Google's event shape, narrowed to what is mirrored. */
export interface GoogleEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

export interface NormalisedEvent {
  googleEventId: string;
  title: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  moduleId: string | null;
}

/**
 * Convert a Google event to the mirrored shape.
 *
 * Returns null for anything unusable — cancelled events, or entries missing
 * either endpoint — rather than inventing times for them.
 */
export function normaliseEvent(
  event: GoogleEvent,
  modules: readonly MatchableModule[],
): NormalisedEvent | null {
  if (!event.id) return null;
  if (event.status === "cancelled") return null;

  const startRaw = event.start?.dateTime ?? event.start?.date;
  const endRaw = event.end?.dateTime ?? event.end?.date;
  if (!startRaw || !endRaw) return null;

  const isAllDay = !event.start?.dateTime;
  const start = new Date(startRaw);
  const end = new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (end.getTime() <= start.getTime() && !isAllDay) return null;

  const title = event.summary?.trim() || "(untitled)";
  const searchable = [title, event.description, event.location]
    .filter(Boolean)
    .join(" ");

  return {
    googleEventId: event.id,
    title,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    isAllDay,
    moduleId: matchModule(searchable, modules),
  };
}

/**
 * How old an .ics import may be before a launch refresh re-fetches it.
 *
 * Six hours means a timetable change published overnight is picked up the
 * first time the app is opened the next morning, while opening it repeatedly
 * through a working day costs at most one fetch.
 */
export const REFRESH_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Whether a subscribed calendar is due a re-fetch.
 *
 * Separated from the fetching so the decision is testable without a network
 * or a database, and so the launch path and the cron can share one rule.
 *
 * A missing timestamp means nothing has ever been imported, which counts as
 * due: that is the case where the user has a URL saved but no events, and
 * refusing to refresh would leave them staring at an empty timetable.
 */
export function isRefreshDue(
  lastSyncedAt: string | null | undefined,
  now: number,
  maxAgeMs: number = REFRESH_MAX_AGE_MS,
): boolean {
  if (!lastSyncedAt) return true;
  const synced = Date.parse(lastSyncedAt);
  // An unparseable timestamp is treated as due rather than never-due, so bad
  // data fails towards a working timetable instead of a silently frozen one.
  if (Number.isNaN(synced)) return true;
  // A clock skew that puts the last sync in the future must not park the
  // refresh forever, so compare on absolute distance.
  return Math.abs(now - synced) >= maxAgeMs;
}

import { calendarEvents, modules } from "../../../db/schema";
import type { AppContext } from "../index";
import { normaliseEvent, type GoogleEvent } from "../../shared/calendar";
import { recordSync } from "./google-auth";

type Db = AppContext["Variables"]["db"];

export type CalendarSyncResult = {
  imported: number;
  skipped: number;
  timeMin: string;
  timeMax: string;
};

/**
 * Mirror the useful window of a connected Google Calendar.
 *
 * This lives outside the HTTP route so the same safe, read-only operation can
 * run after a user clicks Sync and on the Worker’s nightly schedule.
 */
export async function syncGoogleCalendar(
  db: Db,
  token: string,
  options: { daysBack?: number; daysAhead?: number } = {},
): Promise<CalendarSyncResult> {
  const daysBack = options.daysBack ?? 14;
  const daysAhead = options.daysAhead ?? 120;
  const timeMin = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const timeMax = new Date(Date.now() + daysAhead * 86_400_000).toISOString();

  const moduleRows = await db.select().from(modules);
  const matchable = moduleRows.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
  }));

  let pageToken: string | undefined;
  let imported = 0;
  let skipped = 0;

  // Bound paging so a pathological calendar cannot turn a cron into a long
  // running Worker invocation.
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    if (!response.ok) {
      throw new Error(`Calendar request failed (${response.status})`);
    }

    const payload = (await response.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };

    for (const item of payload.items ?? []) {
      const normalised = normaliseEvent(item, matchable);
      if (!normalised) {
        skipped += 1;
        continue;
      }

      await db
        .insert(calendarEvents)
        .values({
          id: crypto.randomUUID(),
          googleEventId: normalised.googleEventId,
          title: normalised.title,
          startAt: normalised.startAt,
          endAt: normalised.endAt,
          isAllDay: normalised.isAllDay,
          moduleId: normalised.moduleId,
          areaId: normalised.moduleId ? "university" : null,
          syncedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: calendarEvents.googleEventId,
          set: {
            title: normalised.title,
            startAt: normalised.startAt,
            endAt: normalised.endAt,
            isAllDay: normalised.isAllDay,
            moduleId: normalised.moduleId,
            areaId: normalised.moduleId ? "university" : null,
            syncedAt: new Date().toISOString(),
          },
        });
      imported += 1;
    }

    pageToken = payload.nextPageToken;
    if (!pageToken) break;
  }

  await recordSync(db);
  return { imported, skipped, timeMin, timeMax };
}

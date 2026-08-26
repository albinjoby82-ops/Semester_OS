import { Hono } from "hono";
import { desc, eq, like } from "drizzle-orm";
import { calendarEvents, modules, settings } from "../../../db/schema";
import type { AppContext } from "../index";
import { isRefreshDue, matchModule } from "../../shared/calendar";
import { parseIcs } from "../../shared/ics";

/**
 * Calendar import from an .ics file.
 *
 * The offline route to the same place as the Google connection: a student
 * exports their timetable, or pastes a subscription URL, and the app gets the
 * same events without an OAuth client. This matters because a university
 * Workspace can refuse third-party app access entirely, leaving the Google
 * path permanently blocked through no fault of the user's.
 */
export const calendarRoute = new Hono<AppContext>();

/** Imported rows are tagged so a re-import replaces exactly its own events. */
const IMPORT_PREFIX = "ics:";

/** Generous enough for a full year of timetable, small enough to bound work. */
const MAX_BYTES = 2_000_000;

/** Where a subscription URL is remembered so the cron can re-read it. */
export const SUBSCRIPTION_KEY = "calendar.icsUrl";

type Db = AppContext["Variables"]["db"];

interface ImportSummary {
  imported: number;
  matched: number;
  skipped: { summary: string; reason: string }[];
  calendarName: string | null;
  firstEvent: string | null;
  lastEvent: string | null;
}

/**
 * Rows per INSERT statement.
 *
 * D1 allows at most 100 bound parameters per query and these rows bind nine
 * columns each, so ten rows sits just inside the limit -- an all-rows insert
 * fails outright on any realistic timetable. Chunking keeps every statement
 * legal while leaving the whole import in one batch, and therefore atomic.
 */
const ROWS_PER_INSERT = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function importIcs(db: Db, text: string): Promise<ImportSummary> {
  const { events, calendarName, skipped } = parseIcs(text, {
    defaultTimeZone: "Europe/Dublin",
  });

  const moduleRows = await db.select().from(modules);
  const matchable = moduleRows.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
  }));

  const syncedAt = new Date().toISOString();
  let matched = 0;

  const rows = events.map((event) => {
    const moduleId = matchModule(
      [event.title, event.location].filter(Boolean).join(" "),
      matchable,
    );
    if (moduleId) matched += 1;

    return {
      id: crypto.randomUUID(),
      googleEventId: event.uid,
      title: event.title,
      startAt: event.startAt,
      endAt: event.endAt,
      isAllDay: event.isAllDay,
      moduleId,
      areaId: moduleId ? "university" : null,
      syncedAt,
    };
  });

  // Replace the previous import wholesale. Occurrence ids are stable, so an
  // upsert alone would leave orphans behind whenever a lecture is cancelled
  // or a room changes -- and a stale event silently eats capacity.
  //
  // Delete and re-insert go in one batch because D1 runs a batch as a single
  // transaction. Issued separately they are not atomic, and a reader arriving
  // mid-import sees a timetable that is empty or half-populated -- which since
  // the refresh started running on app launch is no longer a hypothetical
  // window between a user's click and their next page load, but a race against
  // the very page load that triggered it.
  const inserts = chunk(rows, ROWS_PER_INSERT).map((batchRows) =>
    db.insert(calendarEvents).values(batchRows),
  );
  await db.batch([
    db
      .delete(calendarEvents)
      .where(like(calendarEvents.googleEventId, `${IMPORT_PREFIX}%`)),
    ...inserts,
  ]);

  return {
    imported: events.length,
    matched,
    skipped,
    calendarName,
    firstEvent: events[0]?.startAt ?? null,
    lastEvent: events.at(-1)?.startAt ?? null,
  };
}

/**
 * Fetch and import a calendar URL. Shared by the route and the nightly cron,
 * so a subscription refreshes identically whether or not anyone opens the app.
 */
export async function importIcsFromUrl(
  db: Db,
  rawUrl: string,
): Promise<ImportSummary> {
  // webcal:// is what Google and Outlook hand out; it is https in disguise.
  const url = new URL(rawUrl.trim().replace(/^webcal:\/\//i, "https://"));
  if (url.protocol !== "https:") throw new Error("Calendar URLs must be https.");

  const response = await fetch(url.toString(), {
    headers: { Accept: "text/calendar" },
  });
  if (!response.ok) {
    throw new Error(`Could not fetch that calendar (${response.status}).`);
  }

  const text = await response.text();
  if (!text.includes("BEGIN:VCALENDAR")) {
    throw new Error("That URL did not return a calendar.");
  }
  return importIcs(db, text);
}

/** The remembered subscription URL, if the user set one. */
export async function readSubscriptionUrl(db: Db): Promise<string | null> {
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, SUBSCRIPTION_KEY))
    .limit(1);
  return row?.value ?? null;
}

/** When the subscribed calendar was last imported, if it ever was. */
async function lastImportedAt(db: Db): Promise<string | null> {
  const [row] = await db
    .select({ syncedAt: calendarEvents.syncedAt })
    .from(calendarEvents)
    .where(like(calendarEvents.googleEventId, `${IMPORT_PREFIX}%`))
    .orderBy(desc(calendarEvents.syncedAt))
    .limit(1);
  return row?.syncedAt ?? null;
}

/**
 * Re-read the subscribed calendar if it has gone stale.
 *
 * This is what replaces the nightly cron when the app runs locally, where no
 * scheduled trigger fires: opening the app is the only reliable moment we get,
 * so a timetable change is picked up then rather than never.
 *
 * Never throws. A refresh failing is not a reason for the request that
 * triggered it to fail -- the previously imported events are still on screen
 * and still correct, just older than we would like.
 */
export async function refreshSubscriptionIfDue(
  db: Db,
): Promise<"skipped" | "fresh" | "refreshed" | "failed"> {
  const url = await readSubscriptionUrl(db);
  if (!url) return "skipped";

  if (!isRefreshDue(await lastImportedAt(db), Date.now())) return "fresh";

  try {
    const result = await importIcsFromUrl(db, url);
    console.log("launch ics refresh complete", {
      imported: result.imported,
      matched: result.matched,
    });
    return "refreshed";
  } catch (cause) {
    console.error("launch ics refresh failed", cause);
    return "failed";
  }
}

/**
 * Import a calendar file uploaded from the browser.
 *
 * Accepts the raw file body rather than multipart: there is exactly one file
 * and no other fields, so a form envelope would add parsing for no gain.
 */
calendarRoute.post("/import", async (c) => {
  const text = await c.req.text();

  if (text.length > MAX_BYTES) {
    return c.json({ error: "That file is too large to import." }, 413);
  }
  if (!text.includes("BEGIN:VCALENDAR")) {
    return c.json(
      { error: "That does not look like a calendar file (.ics)." },
      400,
    );
  }

  const summary = await importIcs(c.get("db"), text);
  if (summary.imported === 0) {
    return c.json(
      { error: "No usable events found in that file.", ...summary },
      400,
    );
  }
  return c.json(summary);
});

/**
 * Import from a calendar URL.
 *
 * This is the version that keeps working: Google's "secret address in iCal
 * format" is a stable link, so the nightly cron can re-fetch it and pick up
 * timetable changes without the student doing anything.
 */
calendarRoute.post("/subscribe", async (c) => {
  const body = await c.req
    .json<{ url?: string }>()
    .catch(() => ({ url: undefined }));
  const url = body.url?.trim();
  if (!url) return c.json({ error: "No calendar URL provided." }, 400);

  let summary: ImportSummary;
  try {
    summary = await importIcsFromUrl(c.get("db"), url);
  } catch (cause) {
    return c.json(
      { error: cause instanceof Error ? cause.message : "Import failed." },
      502,
    );
  }

  // Only remembered once it has actually worked, so the cron never inherits
  // a URL that was never able to return a calendar.
  await c
    .get("db")
    .insert(settings)
    .values({
      key: SUBSCRIPTION_KEY,
      value: url,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: url, updatedAt: new Date().toISOString() },
    });

  return c.json(summary);
});

/** Stop refreshing from a URL. Imported events are left in place. */
calendarRoute.delete("/subscribe", async (c) => {
  await c.get("db").delete(settings).where(eq(settings.key, SUBSCRIPTION_KEY));
  return c.json({ ok: true });
});

export { importIcs, IMPORT_PREFIX };
export type { ImportSummary };

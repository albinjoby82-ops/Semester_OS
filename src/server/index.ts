import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { asc } from "drizzle-orm";
import * as schema from "../../db/schema";
import { areas } from "../../db/schema";
import { modulesRoute } from "./routes/modules";
import { tasksRoute } from "./routes/tasks";
import { weekRoute } from "./routes/week";
import { sessionsRoute } from "./routes/sessions";
import { assignmentsRoute } from "./routes/assignments";
import { nextRoute } from "./routes/next";
import { googleRoute } from "./routes/google";
import {
  calendarRoute,
  importIcsFromUrl,
  readSubscriptionUrl,
  refreshSubscriptionIfDue,
} from "./routes/calendar";
import { whatsappRoute } from "./routes/whatsapp";
import { getAccessToken, readConfig } from "./services/google-auth";
import { syncGoogleCalendar } from "./services/google-calendar";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Google OAuth. Set via `wrangler secret put`; never committed. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  /** WhatsApp Cloud API capture. Also set via `wrangler secret put`. */
  WHATSAPP_VERIFY_TOKEN?: string;
  /** Meta app secret: validates that incoming webhooks are genuinely from Meta. */
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_TOKEN?: string;
  WHATSAPP_PHONE_ID?: string;
  /** Comma-separated msisdns permitted to create tasks. */
  WHATSAPP_ALLOWED_FROM?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: { db: ReturnType<typeof drizzle<typeof schema>> };
};

const app = new Hono<AppContext>();

app.use("/api/*", async (c, next) => {
  const db = drizzle(c.env.DB, { schema });
  c.set("db", db);
  scheduleLaunchRefresh(db, c.executionCtx);
  await next();
});

/**
 * Refresh the subscribed calendar when the app is opened.
 *
 * Locally there is no cron trigger, so without this a subscription only ever
 * updates when someone remembers to press Fetch -- the exact manual step that
 * subscribing was meant to remove.
 *
 * Three things bound the cost. An in-flight promise collapses the fan-out of a
 * single page load into one attempt. A cooldown stops a failing calendar
 * server from being retried on every subsequent request, which the staleness
 * check alone would not prevent: a failed import leaves the data stale, so
 * every following request would look due. And the staleness check inside
 * bounds how often a healthy isolate reaches the network at all.
 *
 * Clearing the promise once it settles is deliberate. A worker isolate can
 * live for hours -- a local dev server, for days -- so pinning the attempt to
 * the isolate's lifetime would mean a machine left running never refreshes
 * again. The cooldown, not the promise, is what limits the rate.
 */
const REFRESH_RETRY_COOLDOWN_MS = 10 * 60 * 1000;

let refreshInFlight: Promise<unknown> | null = null;
let refreshAttemptedAt = 0;

function scheduleLaunchRefresh(
  db: AppContext["Variables"]["db"],
  executionCtx: { waitUntil: (promise: Promise<unknown>) => void },
) {
  const now = Date.now();
  if (refreshInFlight) return;
  if (
    refreshAttemptedAt &&
    now - refreshAttemptedAt < REFRESH_RETRY_COOLDOWN_MS
  ) {
    return;
  }
  refreshAttemptedAt = now;

  refreshInFlight = refreshSubscriptionIfDue(db).finally(() => {
    refreshInFlight = null;
  });

  // Nothing waits on the refresh: a slow or unreachable calendar server must
  // not hold up the first paint.
  executionCtx.waitUntil(refreshInFlight);
}

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/areas", async (c) =>
  c.json(await c.get("db").select().from(areas).orderBy(asc(areas.sortOrder))),
);

app.route("/api/modules", modulesRoute);
app.route("/api/tasks", tasksRoute);
app.route("/api/week", weekRoute);
app.route("/api/sessions", sessionsRoute);
app.route("/api/assignments", assignmentsRoute);
app.route("/api/next", nextRoute);
app.route("/api/google", googleRoute);
app.route("/api/calendar", calendarRoute);
app.route("/api/whatsapp", whatsappRoute);

app.onError((err, c) => {
  console.error("Unhandled API error", err);
  return c.json({ error: "Internal error" }, 500);
});

/**
 * SPA fallback.
 *
 * `assets.not_found_handling` only applies when there is NO Worker script.
 * Because this Worker exists, an asset miss falls through to Hono instead,
 * which would 404 every client route -- so deep links and refreshes break in
 * production while working perfectly under the dev server.
 *
 * Serving the shell here fixes that. API paths are excluded so a mistyped
 * endpoint still returns an honest 404 rather than a page of HTML.
 */
app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/")) {
    return c.json({ error: "Not found" }, 404);
  }
  const url = new URL(c.req.url);
  return c.env.ASSETS.fetch(new Request(new URL("/index.html", url.origin)));
});

export default {
  fetch: app.fetch,

  /**
   * Capacity and debt are derived live, so there is no stale aggregate to
   * recompute. The scheduled work is keeping the optional Calendar mirror
   * fresh, which keeps availability accurate even when the app is unopened.
   */
  async scheduled(event: ScheduledController, env: Env) {
    const db = drizzle(env.DB, { schema });

    // A subscribed .ics URL refreshes independently of Google being connected
    // -- for anyone whose university blocks OAuth, this is the only sync there
    // is, so it must not sit behind the Google checks below.
    const subscription = await readSubscriptionUrl(db);
    if (subscription) {
      try {
        const result = await importIcsFromUrl(db, subscription);
        console.log("scheduled ics refresh complete", {
          cron: event.cron,
          imported: result.imported,
          matched: result.matched,
        });
      } catch (cause) {
        console.error("scheduled ics refresh failed", cause);
      }
    }

    const config = readConfig(env);
    if (!config) {
      console.log("scheduled run skipped: Google is not configured", event.cron);
      return;
    }

    const token = await getAccessToken(db, config);
    if (!token) {
      console.log("scheduled run skipped: Google is not connected", event.cron);
      return;
    }

    try {
      const result = await syncGoogleCalendar(db, token);
      console.log("scheduled calendar sync complete", { cron: event.cron, ...result });
    } catch (cause) {
      console.error("scheduled calendar sync failed", cause);
    }
  },
} satisfies ExportedHandler<Env>;

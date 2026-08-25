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
import { whatsappRoute } from "./routes/whatsapp";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Google OAuth. Set via `wrangler secret put`; never committed. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  /** WhatsApp Cloud API capture. Also set via `wrangler secret put`. */
  WHATSAPP_VERIFY_TOKEN?: string;
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
  c.set("db", drizzle(c.env.DB, { schema }));
  await next();
});

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
   * Cron entrypoint. Nightly recompute keeps debt and capacity current without
   * the user maintaining anything; the Sunday run generates Plan Week.
   */
  async scheduled(event: ScheduledController, env: Env) {
    const db = drizzle(env.DB, { schema });
    // Wired up in Step 4 (debt/capacity) and the Plan Week flow.
    console.log("scheduled run", event.cron, { hasDb: Boolean(db) });
  },
} satisfies ExportedHandler<Env>;

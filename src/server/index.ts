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

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
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

app.onError((err, c) => {
  console.error("Unhandled API error", err);
  return c.json({ error: "Internal error" }, 500);
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

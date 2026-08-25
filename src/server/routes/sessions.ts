import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import { tasks, timeSessions } from "../../../db/schema";
import type { AppContext } from "../index";
import { CURRENT_TERM } from "../../shared/term-config";
import { teachingWeekForDate } from "../../shared/term-week";
import { computeCalibration, sessionMinutes } from "../../shared/calibration";

export const sessionsRoute = new Hono<AppContext>();

const newId = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();

/** Close any session left open, returning the minutes recorded against each. */
async function closeOpenSessions(
  db: AppContext["Variables"]["db"],
  endedAt: string,
): Promise<{ taskId: string | null; minutes: number }[]> {
  const open = await db
    .select()
    .from(timeSessions)
    .where(isNull(timeSessions.endedAt));

  const closed: { taskId: string | null; minutes: number }[] = [];

  for (const session of open) {
    const minutes = sessionMinutes(session.startedAt, endedAt);
    await db
      .update(timeSessions)
      .set({ endedAt })
      .where(eq(timeSessions.id, session.id));

    if (session.taskId && minutes > 0) {
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, session.taskId))
        .limit(1);
      if (task) {
        // Accumulate: a task worked across several sittings should total them.
        await db
          .update(tasks)
          .set({ actualMinutes: (task.actualMinutes ?? 0) + minutes })
          .where(eq(tasks.id, session.taskId));
      }
    }
    closed.push({ taskId: session.taskId, minutes });
  }

  return closed;
}

/** The session currently running, with its task. Null when nothing is active. */
sessionsRoute.get("/active", async (c) => {
  const db = c.get("db");
  const [session] = await db
    .select()
    .from(timeSessions)
    .where(isNull(timeSessions.endedAt))
    .limit(1);

  if (!session) return c.json(null);

  const [task] = session.taskId
    ? await db.select().from(tasks).where(eq(tasks.id, session.taskId)).limit(1)
    : [];

  return c.json({ session, task: task ?? null });
});

/**
 * Start focusing on a task.
 *
 * Only one session runs at a time: starting a new one closes whatever was
 * open, so a forgotten timer cannot poison later calibration.
 */
sessionsRoute.post("/start", async (c) => {
  const db = c.get("db");
  const body = await c.req.json<{ taskId?: string }>();
  if (!body.taskId) return c.json({ error: "taskId is required" }, 400);

  const [task] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, body.taskId))
    .limit(1);
  if (!task) return c.json({ error: "Task not found" }, 404);

  const startedAt = nowISO();
  await closeOpenSessions(db, startedAt);

  const session = {
    id: newId(),
    taskId: task.id,
    areaId: task.areaId,
    moduleId: task.moduleId,
    startedAt,
    endedAt: null,
    weekNumber:
      task.weekNumber ?? teachingWeekForDate(new Date(), CURRENT_TERM),
  };
  await db.insert(timeSessions).values(session);

  // Starting work is what makes a task in progress -- no separate step.
  await db
    .update(tasks)
    .set({ status: task.status === "todo" ? "in_progress" : task.status })
    .where(eq(tasks.id, task.id));

  return c.json({ session, task }, 201);
});

/**
 * Stop the running session.
 *
 * `complete` finishes the work as well. For assessed work that still means
 * `done`, never `submitted` -- submission stays a separate, deliberate act.
 */
sessionsRoute.post("/stop", async (c) => {
  const db = c.get("db");
  const body = await c.req
    .json<{ complete?: boolean }>()
    .catch(() => ({ complete: false }));

  const endedAt = nowISO();
  const closed = await closeOpenSessions(db, endedAt);
  if (closed.length === 0) {
    return c.json({ error: "No session is running" }, 404);
  }

  const taskId = closed[0]?.taskId ?? null;
  if (body.complete && taskId) {
    await db
      .update(tasks)
      .set({ status: "done", completedAt: endedAt })
      .where(eq(tasks.id, taskId));
  }

  const [task] = taskId
    ? await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
    : [];

  return c.json({ minutes: closed[0]?.minutes ?? 0, task: task ?? null });
});

/** How wrong your estimates are, derived from tracked sessions. */
sessionsRoute.get("/calibration", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.status, "done"),
        isNull(tasks.deferredAt),
      ),
    );

  const submitted = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "submitted"));

  return c.json(
    computeCalibration(
      [...rows, ...submitted].map((t) => ({
        estimatedMinutes: t.estimatedMinutes,
        actualMinutes: t.actualMinutes,
      })),
    ),
  );
});

/** Recent sessions, for the estimated-versus-actual view. */
sessionsRoute.get("/", async (c) => {
  const db = c.get("db");
  return c.json(await db.select().from(timeSessions));
});

import { Hono } from "hono";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { captureInbox, tasks, type TaskStatus } from "../../../db/schema";
import type { AppContext } from "../index";
import { CURRENT_TERM } from "../../shared/term-config";
import { teachingWeekForDate } from "../../shared/term-week";

export const tasksRoute = new Hono<AppContext>();

const OPEN_STATUSES: TaskStatus[] = ["todo", "in_progress"];

const newId = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();

/**
 * Open tasks: anything not finished, due today or earlier (or undated).
 * Overdue work is never hidden -- it stays in this list until it is done,
 * rescheduled, or deferred with a reason.
 */
tasksRoute.get("/", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        or(eq(tasks.status, "todo"), eq(tasks.status, "in_progress")),
        isNull(tasks.deferredAt),
      ),
    )
    .orderBy(asc(tasks.dueAt), asc(tasks.createdAt));

  return c.json(rows);
});

/**
 * Quick capture. Title is the ONLY required field -- forcing category, date or
 * priority before saving is what makes capture slow enough to skip.
 *
 * The raw text is written to the inbox first so a parsing failure can never
 * lose the capture.
 */
tasksRoute.post("/", async (c) => {
  const db = c.get("db");
  const body = await c.req.json<{
    id?: string;
    title?: string;
    areaId?: string;
    moduleId?: string | null;
    dueAt?: string | null;
    estimatedMinutes?: number | null;
    source?: string;
  }>();

  const title = body.title?.trim();
  if (!title) return c.json({ error: "A title is required" }, 400);

  // Client-generated ids let offline capture sync without collisions.
  const id = body.id ?? newId();
  const source = (body.source ?? "manual") as never;
  const createdAt = nowISO();

  // Save the raw text FIRST and unlinked, so nothing downstream can lose the
  // capture. It cannot reference the task yet -- that row does not exist, and
  // the foreign key would reject it. The link is set after the task lands.
  const inboxId = newId();
  await db.insert(captureInbox).values({
    id: inboxId,
    rawText: title,
    source,
    receivedAt: createdAt,
  });

  const dueAt = body.dueAt ?? null;
  const weekNumber = dueAt
    ? teachingWeekForDate(new Date(dueAt), CURRENT_TERM)
    : teachingWeekForDate(new Date(), CURRENT_TERM);

  const row = {
    id,
    title,
    areaId: body.areaId ?? "university",
    moduleId: body.moduleId ?? null,
    dueAt,
    weekNumber,
    estimatedMinutes: body.estimatedMinutes ?? null,
    source,
    createdAt,
  };

  // Idempotent on id so a retried offline sync does not duplicate.
  await db.insert(tasks).values(row).onConflictDoNothing();

  await db
    .update(captureInbox)
    .set({ resolvedTaskId: id, resolvedAt: nowISO() })
    .where(eq(captureInbox.id, inboxId));

  const [saved] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return c.json(saved ?? row, 201);
});

/**
 * Update a task. Assessed work is the important case: marking it `done` must
 * NOT close it -- it stays open until separately marked `submitted`.
 */
tasksRoute.patch("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json<{
    title?: string;
    status?: TaskStatus;
    dueAt?: string | null;
    estimatedMinutes?: number | null;
    moduleId?: string | null;
    areaId?: string;
    scheduledStartAt?: string | null;
    scheduledEndAt?: string | null;
    deferredReason?: string;
  }>();

  const [existing] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "Task not found" }, 404);

  const patch: Partial<typeof tasks.$inferInsert> = {};

  if (body.title !== undefined) patch.title = body.title.trim();
  if (body.dueAt !== undefined) {
    patch.dueAt = body.dueAt;
    // Recompute the teaching week whenever the date moves. Without this a
    // rescheduled task keeps its old week and silently drops out of capacity
    // and debt for the week it actually lands in.
    patch.weekNumber = body.dueAt
      ? teachingWeekForDate(new Date(body.dueAt), CURRENT_TERM)
      : null;
  }
  if (body.estimatedMinutes !== undefined)
    patch.estimatedMinutes = body.estimatedMinutes;
  if (body.moduleId !== undefined) patch.moduleId = body.moduleId;
  if (body.areaId !== undefined) patch.areaId = body.areaId;
  if (body.scheduledStartAt !== undefined)
    patch.scheduledStartAt = body.scheduledStartAt;
  if (body.scheduledEndAt !== undefined)
    patch.scheduledEndAt = body.scheduledEndAt;

  if (body.status !== undefined) {
    patch.status = body.status;
    patch.completedAt =
      body.status === "done" || body.status === "submitted" ? nowISO() : null;
  }

  // Debt may only be dismissed with a stated reason, so the count stays honest.
  if (body.deferredReason !== undefined) {
    const reason = body.deferredReason.trim();
    if (!reason) {
      return c.json({ error: "Deferring requires a reason" }, 400);
    }
    patch.deferredReason = reason;
    patch.deferredAt = nowISO();
  }

  await db.update(tasks).set(patch).where(eq(tasks.id, id));

  const [updated] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  return c.json(updated);
});

/** Academic debt: required weekly work from this week or earlier, still open. */
tasksRoute.get("/debt", async (c) => {
  const db = c.get("db");
  const currentWeek = teachingWeekForDate(new Date(), CURRENT_TERM);
  if (currentWeek == null) return c.json([]);

  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        or(eq(tasks.status, "todo"), eq(tasks.status, "in_progress")),
        isNull(tasks.deferredAt),
        lte(tasks.weekNumber, currentWeek),
      ),
    )
    .orderBy(asc(tasks.weekNumber));

  return c.json(rows);
});

export { OPEN_STATUSES };

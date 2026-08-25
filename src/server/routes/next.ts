import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import {
  assignments,
  modules,
  tasks,
  timeSessions,
} from "../../../db/schema";
import type { AppContext } from "../index";
import { CURRENT_TERM } from "../../shared/term-config";
import { assessModule, type RiskAssessment } from "../../shared/risk";
import {
  rankTasks,
  type Candidate,
  type ScoringContext,
} from "../../shared/next-action";

export const nextRoute = new Hono<AppContext>();

const toRisk = (a: typeof assignments.$inferSelect): RiskAssessment => ({
  id: a.id,
  title: a.title,
  weightPercent: a.weightPercent,
  dueWeek: a.dueWeek,
  dueWeekEnd: a.dueWeekEnd,
  dueAt: a.dueAt,
  isExam: a.isExam,
  isSubmitted: a.isSubmitted,
  startedAt: a.startedAt,
  mainWorkDoneAt: a.mainWorkDoneAt,
  estimatedMinutes: a.estimatedMinutes,
});

/**
 * The ranked next actions.
 *
 * `minutesAvailable` is supplied BY THE CLIENT rather than derived here.
 * Fixed commitments are stored as local minutes-of-day, and the Worker runs
 * in UTC with no knowledge of the user's timezone -- computing the gap
 * server-side would silently be wrong by the UTC offset. The browser knows
 * local time, so it does that one calculation and passes the answer in.
 */
nextRoute.get("/", async (c) => {
  const db = c.get("db");

  const availableParam = c.req.query("available");
  const minutesAvailable =
    availableParam == null || availableParam === ""
      ? null
      : Number(availableParam);

  if (minutesAvailable != null && !Number.isFinite(minutesAvailable)) {
    return c.json({ error: "available must be a number of minutes" }, 400);
  }

  const [taskRows, assignmentRows, moduleRows, sessionRows] = await Promise.all([
    db.select().from(tasks),
    db.select().from(assignments),
    db.select().from(modules),
    db.select().from(timeSessions).orderBy(desc(timeSessions.endedAt)),
  ]);

  const assignmentById = new Map(assignmentRows.map((a) => [a.id, a]));
  const moduleCode = new Map(moduleRows.map((m) => [m.id, m.code]));

  // Weight-at-risk per module, reusing the same model the module pages show
  // so the ranking and the module cards can never disagree.
  const moduleRisk = new Map<string, number>();
  for (const module of moduleRows) {
    const own = assignmentRows
      .filter((a) => a.moduleId === module.id)
      .map(toRisk);
    moduleRisk.set(
      module.id,
      assessModule(own, { term: CURRENT_TERM }).percentAtRisk,
    );
  }

  // taskId -> weight of the assessment it belongs to.
  const assessmentWeight = new Map<string, number>();
  for (const task of taskRows) {
    if (!task.assignmentId) continue;
    const assignment = assignmentById.get(task.assignmentId);
    if (assignment) assessmentWeight.set(task.id, assignment.weightPercent);
  }

  // Most recent finished session per module, for the neglect factor.
  const lastWorked = new Map<string, Date>();
  for (const session of sessionRows) {
    if (!session.moduleId || !session.endedAt) continue;
    if (lastWorked.has(session.moduleId)) continue; // rows are newest-first
    lastWorked.set(session.moduleId, new Date(session.endedAt));
  }

  const universityAtRisk = [...moduleRisk.values()].some((risk) => risk > 0);

  const candidates: Candidate[] = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    areaId: t.areaId,
    moduleId: t.moduleId,
    assignmentId: t.assignmentId,
    status: t.status,
    dueAt: t.dueAt,
    estimatedMinutes: t.estimatedMinutes,
    isRequiredWeekly: t.isRequiredWeekly,
    priorityOverride: t.priorityOverride,
    deferredAt: t.deferredAt,
  }));

  const context: ScoringContext = {
    term: CURRENT_TERM,
    moduleRisk,
    moduleCode,
    assessmentWeight,
    lastWorked,
    minutesAvailable,
    universityAtRisk,
  };

  const ranked = rankTasks(candidates, context);

  return c.json({
    recommended: ranked[0] ?? null,
    ranked: ranked.slice(0, 10),
    minutesAvailable,
    universityAtRisk,
  });
});

/** Mark a task as a priority, or clear the override. */
nextRoute.post("/override", async (c) => {
  const db = c.get("db");
  const body = await c.req.json<{ taskId?: string; points?: number | null }>();
  if (!body.taskId) return c.json({ error: "taskId is required" }, 400);

  const points = body.points ?? null;
  if (points != null && (!Number.isFinite(points) || points < 0 || points > 50)) {
    return c.json({ error: "points must be between 0 and 50" }, 400);
  }

  await db
    .update(tasks)
    .set({ priorityOverride: points })
    .where(eq(tasks.id, body.taskId));

  const [updated] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.id, body.taskId))
    .limit(1);
  return c.json(updated);
});

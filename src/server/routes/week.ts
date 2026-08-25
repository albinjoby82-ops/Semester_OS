import { Hono } from "hono";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import {
  assignments,
  calendarEvents,
  fixedCommitments,
  modules,
  overrides,
  settings,
  tasks,
  timeSessions,
  weekAllocations,
} from "../../../db/schema";
import type { AppContext } from "../index";
import { CURRENT_TERM } from "../../shared/term-config";
import { teachingWeekForDate } from "../../shared/term-week";
import {
  buildHorizon,
  capacityForWeek,
  DEFAULT_CAPACITY,
  effortBudget,
  overloadedWeeks,
  type AssessmentWindow,
  type CapacityConfig,
  type FixedBlock,
  type WorkItem,
} from "../../shared/capacity";
import { computeDrift, trailingRatio, type ActualHours } from "../../shared/drift";
import { busyHoursInWindow, type CalendarEventLike } from "../../shared/calendar";
import { dateRangeForWeek } from "../../shared/term-week";

export const weekRoute = new Hono<AppContext>();

const newId = () => crypto.randomUUID();
const OPEN = ["todo", "in_progress"];

async function loadCapacityConfig(
  db: AppContext["Variables"]["db"],
): Promise<CapacityConfig> {
  const rows = await db.select().from(settings);
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const hours = Number(map.get("realisticWeeklyHours"));
  return {
    ...DEFAULT_CAPACITY,
    realisticWeeklyHours: Number.isFinite(hours) && hours > 0
      ? hours
      : DEFAULT_CAPACITY.realisticWeeklyHours,
  };
}

/**
 * Hours actually spent per area in a week.
 *
 * Prefers real tracked sessions. Until Focus mode exists there usually are
 * none, so it falls back to the estimates on work completed that week. The
 * response says which source was used -- an estimate must never be presented
 * as a measurement.
 */
async function actualHoursForWeek(
  db: AppContext["Variables"]["db"],
  week: number,
): Promise<{ actuals: ActualHours[]; source: "tracked" | "estimated" }> {
  const sessions = await db
    .select()
    .from(timeSessions)
    .where(eq(timeSessions.weekNumber, week));

  const byArea = new Map<string, number>();

  const tracked = sessions.filter((s) => s.endedAt);
  if (tracked.length > 0) {
    for (const session of tracked) {
      const ms =
        new Date(session.endedAt!).getTime() -
        new Date(session.startedAt).getTime();
      if (ms <= 0) continue;
      byArea.set(
        session.areaId,
        (byArea.get(session.areaId) ?? 0) + ms / 3_600_000,
      );
    }
    return {
      actuals: [...byArea].map(([areaId, hours]) => ({ areaId, hours })),
      source: "tracked",
    };
  }

  const done = await db
    .select()
    .from(tasks)
    .where(eq(tasks.weekNumber, week));

  for (const task of done) {
    if (task.status !== "done" && task.status !== "submitted") continue;
    const minutes = task.actualMinutes ?? task.estimatedMinutes ?? 0;
    if (minutes <= 0) continue;
    byArea.set(task.areaId, (byArea.get(task.areaId) ?? 0) + minutes / 60);
  }

  return {
    actuals: [...byArea].map(([areaId, hours]) => ({ areaId, hours })),
    source: "estimated",
  };
}

/** Everything Today needs about the current week, in one round trip. */
weekRoute.get("/", async (c) => {
  const db = c.get("db");
  const now = new Date();
  const currentWeek = teachingWeekForDate(now, CURRENT_TERM);
  const config = await loadCapacityConfig(db);

  const [blockRows, taskRows, assignmentRows, moduleRows, allocationRows, eventRows] =
    await Promise.all([
      db.select().from(fixedCommitments),
      db.select().from(tasks),
      db.select().from(assignments),
      db.select().from(modules),
      db.select().from(weekAllocations),
      db.select().from(calendarEvents),
    ]);

  const moduleCodeById = new Map(moduleRows.map((m) => [m.id, m.code]));

  const blocks: FixedBlock[] = blockRows.map((b) => ({
    areaId: b.areaId,
    dayOfWeek: b.dayOfWeek,
    startMinute: b.startMinute,
    endMinute: b.endMinute,
    fromWeek: b.fromWeek,
    toWeek: b.toWeek,
    active: b.active,
  }));

  // Derive the week from the due date rather than trusting the stored column,
  // which can be stale for rows written before a term-config change.
  const items: WorkItem[] = taskRows
    .filter((t) => !t.deferredAt)
    .map((t) => ({
      areaId: t.areaId,
      weekNumber: t.dueAt
        ? teachingWeekForDate(new Date(t.dueAt), CURRENT_TERM)
        : t.weekNumber,
      estimatedMinutes: t.estimatedMinutes,
      status: t.status,
    }));

  const assessmentWindows: AssessmentWindow[] = assignmentRows.map((a) => ({
    moduleCode: moduleCodeById.get(a.moduleId) ?? "",
    title: a.title,
    weightPercent: a.weightPercent,
    dueWeek: a.dueWeek,
    dueWeekEnd: a.dueWeekEnd,
    isSubmitted: a.isSubmitted,
  }));

  /**
   * Google Calendar is the source of truth for WHEN once connected, so real
   * events replace the hand-entered timetable rather than being added to it
   * -- counting both would double-book every lecture.
   */
  const events: CalendarEventLike[] = eventRows.map((e) => ({
    id: e.id,
    title: e.title,
    startAt: e.startAt,
    endAt: e.endAt,
    isAllDay: e.isAllDay,
    moduleId: e.moduleId,
    areaId: e.areaId,
  }));
  const calendarConnected = events.length > 0;

  const fixedHoursFor = (week: number): number | undefined => {
    if (!calendarConnected) return undefined;
    const range = dateRangeForWeek(week, CURRENT_TERM);
    return busyHoursInWindow(events, range);
  };

  const horizon = buildHorizon(CURRENT_TERM, {
    blocks,
    items,
    assessments: assessmentWindows,
    config,
    fixedHoursFor,
  });

  const thisWeek =
    currentWeek == null
      ? null
      : capacityForWeek(currentWeek, {
          blocks,
          items,
          assessments: assessmentWindows,
          config,
          fixedHoursOverride: fixedHoursFor(currentWeek),
        });

  // Drift, measured against the allocation set in Plan Week.
  const allocations =
    currentWeek == null
      ? []
      : allocationRows
          .filter(
            (a) => a.weekNumber === currentWeek && a.termId === CURRENT_TERM.id,
          )
          .map((a) => ({ areaId: a.areaId, plannedHours: a.plannedHours }));

  const { actuals, source } =
    currentWeek == null
      ? { actuals: [], source: "estimated" as const }
      : await actualHoursForWeek(db, currentWeek);

  const drift = computeDrift(allocations, actuals, { now });

  // Trailing window, for drift the weekly view cannot see.
  const history = [];
  if (currentWeek != null) {
    for (let week = Math.max(1, currentWeek - 2); week <= currentWeek; week++) {
      const past = await actualHoursForWeek(db, week);
      history.push({ weekNumber: week, actuals: past.actuals });
    }
  }
  const trailing = trailingRatio(history);

  const totalStatedHours = moduleRows.reduce(
    (sum, m) => sum + (m.studentEffortHours ?? 0),
    0,
  );

  return c.json({
    currentWeek,
    term: { id: CURRENT_TERM.id, label: CURRENT_TERM.label, teachingWeeks: CURRENT_TERM.teachingWeeks },
    capacity: thisWeek,
    horizon,
    overloaded: overloadedWeeks(horizon),
    drift,
    trailing,
    actualsSource: source,
    capacitySource: calendarConnected
      ? ("calendar" as const)
      : ("manual" as const),
    allocations,
    effort: effortBudget(totalStatedHours, CURRENT_TERM, config),
    config,
  });
});

/**
 * Academic debt: university work from this week or earlier that should
 * already be done.
 *
 * University-scoped by definition -- an unfinished GaelForce task is a
 * backlog item, not academic debt, and counting it here would make the number
 * meaningless. Grouped by module so it reads the way the brief shows it.
 */
weekRoute.get("/debt", async (c) => {
  const db = c.get("db");
  const currentWeek = teachingWeekForDate(new Date(), CURRENT_TERM);
  if (currentWeek == null) {
    return c.json({ currentWeek: null, items: [], count: 0, byModule: [] });
  }

  const [rows, moduleRows] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(
        and(
          or(eq(tasks.status, "todo"), eq(tasks.status, "in_progress")),
          isNull(tasks.deferredAt),
          eq(tasks.areaId, "university"),
          lte(tasks.weekNumber, currentWeek),
        ),
      ),
    db.select().from(modules),
  ]);

  const codeById = new Map(moduleRows.map((m) => [m.id, m.code]));
  const byModule = new Map<string, { code: string; titles: string[] }>();

  for (const task of rows) {
    const key = task.moduleId ?? "unassigned";
    const entry = byModule.get(key) ?? {
      code: task.moduleId ? (codeById.get(task.moduleId) ?? key) : "Unassigned",
      titles: [],
    };
    entry.titles.push(task.title);
    byModule.set(key, entry);
  }

  return c.json({
    currentWeek,
    items: rows,
    count: rows.length,
    byModule: [...byModule.values()].sort((a, b) => a.code.localeCompare(b.code)),
  });
});

/** Set this week's allocation. This is the number all drift is measured against. */
weekRoute.put("/allocations", async (c) => {
  const db = c.get("db");
  const body = await c.req.json<{
    weekNumber?: number;
    allocations?: { areaId: string; plannedHours: number }[];
  }>();

  const week = body.weekNumber ?? teachingWeekForDate(new Date(), CURRENT_TERM);
  if (week == null) {
    return c.json({ error: "Outside teaching weeks" }, 400);
  }
  if (!Array.isArray(body.allocations)) {
    return c.json({ error: "allocations must be an array" }, 400);
  }

  for (const allocation of body.allocations) {
    if (!Number.isFinite(allocation.plannedHours) || allocation.plannedHours < 0) {
      return c.json({ error: "plannedHours must be zero or more" }, 400);
    }
    await db
      .insert(weekAllocations)
      .values({
        id: newId(),
        termId: CURRENT_TERM.id,
        weekNumber: week,
        areaId: allocation.areaId,
        plannedHours: allocation.plannedHours,
      })
      .onConflictDoUpdate({
        target: [
          weekAllocations.termId,
          weekAllocations.weekNumber,
          weekAllocations.areaId,
        ],
        set: { plannedHours: allocation.plannedHours },
      });
  }

  const rows = await db
    .select()
    .from(weekAllocations)
    .where(
      and(
        eq(weekAllocations.termId, CURRENT_TERM.id),
        eq(weekAllocations.weekNumber, week),
      ),
    );

  return c.json(rows);
});

/**
 * Log an override. Called when work is added beyond a self-set allocation.
 *
 * This never blocks the work -- it records that the choice was made, so the
 * pattern is visible in Plan Week rather than disappearing.
 */
weekRoute.post("/overrides", async (c) => {
  const db = c.get("db");
  const body = await c.req.json<{
    areaId?: string;
    reason?: string;
    overageHours?: number;
    weekNumber?: number;
  }>();

  const reason = body.reason?.trim();
  if (!reason) return c.json({ error: "An override needs a reason" }, 400);
  if (!body.areaId) return c.json({ error: "areaId is required" }, 400);

  const week = body.weekNumber ?? teachingWeekForDate(new Date(), CURRENT_TERM);
  if (week == null) return c.json({ error: "Outside teaching weeks" }, 400);

  const row = {
    id: newId(),
    termId: CURRENT_TERM.id,
    weekNumber: week,
    areaId: body.areaId,
    reason,
    overageHours: body.overageHours ?? null,
  };
  await db.insert(overrides).values(row);
  return c.json(row, 201);
});

/** Override history, so Plan Week can report a repeated pattern. */
weekRoute.get("/overrides", async (c) => {
  const db = c.get("db");
  const rows = await db
    .select()
    .from(overrides)
    .where(eq(overrides.termId, CURRENT_TERM.id));
  return c.json(rows);
});

/** Fixed commitments: the timetable capacity is computed against. */
weekRoute.get("/commitments", async (c) =>
  c.json(await c.get("db").select().from(fixedCommitments)),
);

weekRoute.post("/commitments", async (c) => {
  const db = c.get("db");
  const body = await c.req.json<{
    title?: string;
    areaId?: string;
    moduleId?: string | null;
    dayOfWeek?: number;
    startMinute?: number;
    endMinute?: number;
    fromWeek?: number | null;
    toWeek?: number | null;
  }>();

  if (!body.title?.trim()) return c.json({ error: "A title is required" }, 400);
  if (
    body.dayOfWeek == null ||
    body.startMinute == null ||
    body.endMinute == null
  ) {
    return c.json({ error: "dayOfWeek, startMinute and endMinute are required" }, 400);
  }
  if (body.endMinute <= body.startMinute) {
    return c.json({ error: "endMinute must be after startMinute" }, 400);
  }

  const row = {
    id: newId(),
    title: body.title.trim(),
    areaId: body.areaId ?? "university",
    moduleId: body.moduleId ?? null,
    dayOfWeek: body.dayOfWeek,
    startMinute: body.startMinute,
    endMinute: body.endMinute,
    fromWeek: body.fromWeek ?? null,
    toWeek: body.toWeek ?? null,
    active: true,
  };
  await db.insert(fixedCommitments).values(row);
  return c.json(row, 201);
});

weekRoute.delete("/commitments/:id", async (c) => {
  const db = c.get("db");
  await db
    .delete(fixedCommitments)
    .where(eq(fixedCommitments.id, c.req.param("id")));
  return c.json({ ok: true });
});

import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { assignments, grades, modules } from "../../../db/schema";
import type { AppContext } from "../index";
import { summariseGrades } from "../../shared/grades";

export const modulesRoute = new Hono<AppContext>();

/** All modules with their assessments and grade position. */
modulesRoute.get("/", async (c) => {
  const db = c.get("db");

  const [moduleRows, assignmentRows, gradeRows] = await Promise.all([
    db.select().from(modules).orderBy(asc(modules.code)),
    db.select().from(assignments).orderBy(asc(assignments.dueWeek)),
    db.select().from(grades),
  ]);

  const gradeByAssignment = new Map(gradeRows.map((g) => [g.assignmentId, g]));

  const payload = moduleRows.map((module) => {
    const own = assignmentRows.filter((a) => a.moduleId === module.id);
    return {
      ...module,
      assessments: own.map((a) => ({
        ...a,
        grade: gradeByAssignment.get(a.id) ?? null,
      })),
      gradeSummary: summariseGrades(own, gradeByAssignment),
    };
  });

  return c.json(payload);
});

/** One module by code, e.g. /api/modules/EEEN20070. */
modulesRoute.get("/:code", async (c) => {
  const db = c.get("db");
  const code = c.req.param("code").toUpperCase();

  const [module] = await db
    .select()
    .from(modules)
    .where(eq(modules.code, code))
    .limit(1);

  if (!module) return c.json({ error: "Module not found" }, 404);

  const own = await db
    .select()
    .from(assignments)
    .where(eq(assignments.moduleId, module.id))
    .orderBy(asc(assignments.dueWeek));

  const gradeRows = await db.select().from(grades);
  const gradeByAssignment = new Map(gradeRows.map((g) => [g.assignmentId, g]));

  return c.json({
    ...module,
    assessments: own.map((a) => ({
      ...a,
      grade: gradeByAssignment.get(a.id) ?? null,
    })),
    gradeSummary: summariseGrades(own, gradeByAssignment),
  });
});

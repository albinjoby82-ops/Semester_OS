import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { assignments, grades, modules } from "../../../db/schema";
import type { AppContext } from "../index";
import { CURRENT_TERM } from "../../shared/term-config";
import { buildRadar, type RadarModule } from "../../shared/radar";
import type { RiskAssessment } from "../../shared/risk";

export const assignmentsRoute = new Hono<AppContext>();

const newId = () => crypto.randomUUID();
const nowISO = () => new Date().toISOString();

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

/** The assessment radar. */
assignmentsRoute.get("/radar", async (c) => {
  const db = c.get("db");
  const days = Number(c.req.query("days") ?? 14);
  const includeUndated = c.req.query("includeUndated") === "true";

  const [moduleRows, assignmentRows] = await Promise.all([
    db.select().from(modules).orderBy(asc(modules.code)),
    db.select().from(assignments),
  ]);

  const radarModules: RadarModule[] = moduleRows.map((m) => ({
    code: m.code,
    name: m.name,
    colorToken: m.colorToken,
    assessments: assignmentRows
      .filter((a) => a.moduleId === m.id)
      .map(toRisk),
  }));

  return c.json(
    buildRadar(radarModules, {
      term: CURRENT_TERM,
      days: Number.isFinite(days) ? days : 14,
      includeUndated,
    }),
  );
});

/**
 * Update an assessment: checklist stages, a pinned real deadline, or an
 * effort estimate.
 *
 * Any field edited here is recorded in userEditedFields so the UCD importer
 * can never silently overwrite it later.
 */
assignmentsRoute.patch("/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json<{
    readBrief?: boolean;
    started?: boolean;
    mainWorkDone?: boolean;
    checked?: boolean;
    submitted?: boolean;
    submissionVerified?: boolean;
    dueAt?: string | null;
    estimatedMinutes?: number | null;
    userConfirmed?: boolean;
  }>();

  const [existing] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "Assessment not found" }, 404);

  const patch: Partial<typeof assignments.$inferInsert> = {};
  const edited = new Set<string>(
    existing.userEditedFields ? JSON.parse(existing.userEditedFields) : [],
  );

  const stamp = (value: boolean | undefined): string | null | undefined =>
    value === undefined ? undefined : value ? nowISO() : null;

  const readBrief = stamp(body.readBrief);
  if (readBrief !== undefined) patch.readBriefAt = readBrief;
  const started = stamp(body.started);
  if (started !== undefined) patch.startedAt = started;
  const mainWorkDone = stamp(body.mainWorkDone);
  if (mainWorkDone !== undefined) patch.mainWorkDoneAt = mainWorkDone;
  const checked = stamp(body.checked);
  if (checked !== undefined) patch.checkedAt = checked;

  if (body.submitted !== undefined) {
    patch.isSubmitted = body.submitted;
    patch.submittedAt = body.submitted ? nowISO() : null;
    // Un-submitting must also clear verification, or the row claims a
    // verified submission that no longer exists.
    if (!body.submitted) patch.submissionVerifiedAt = null;
  }

  if (body.submissionVerified !== undefined) {
    // Verification is meaningless without submission, so it cannot be set
    // unless the assessment is (or is being) marked submitted.
    const willBeSubmitted = body.submitted ?? existing.isSubmitted;
    if (body.submissionVerified && !willBeSubmitted) {
      return c.json(
        { error: "Mark it submitted before verifying the submission" },
        400,
      );
    }
    patch.submissionVerifiedAt = body.submissionVerified ? nowISO() : null;
  }

  if (body.dueAt !== undefined) {
    patch.dueAt = body.dueAt;
    edited.add("dueAt");
  }
  if (body.estimatedMinutes !== undefined) {
    patch.estimatedMinutes = body.estimatedMinutes;
    edited.add("estimatedMinutes");
  }
  if (body.userConfirmed !== undefined) patch.userConfirmed = body.userConfirmed;

  patch.userEditedFields = edited.size > 0 ? JSON.stringify([...edited]) : null;

  await db.update(assignments).set(patch).where(eq(assignments.id, id));

  const [updated] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, id))
    .limit(1);
  return c.json(updated);
});

/** Record a returned mark. */
assignmentsRoute.put("/:id/grade", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const body = await c.req.json<{
    marksAwarded?: number;
    marksPossible?: number;
    feedbackNote?: string | null;
  }>();

  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, id))
    .limit(1);
  if (!assignment) return c.json({ error: "Assessment not found" }, 404);

  const marksAwarded = body.marksAwarded;
  const marksPossible = body.marksPossible ?? 100;

  if (!Number.isFinite(marksAwarded) || marksAwarded == null) {
    return c.json({ error: "marksAwarded is required" }, 400);
  }
  if (!Number.isFinite(marksPossible) || marksPossible <= 0) {
    return c.json({ error: "marksPossible must be greater than zero" }, 400);
  }
  if (marksAwarded < 0 || marksAwarded > marksPossible) {
    return c.json(
      { error: "marksAwarded must be between zero and marksPossible" },
      400,
    );
  }

  await db
    .insert(grades)
    .values({
      id: newId(),
      assignmentId: id,
      marksAwarded,
      marksPossible,
      receivedAt: nowISO(),
      feedbackNote: body.feedbackNote ?? null,
    })
    .onConflictDoUpdate({
      target: grades.assignmentId,
      set: {
        marksAwarded,
        marksPossible,
        feedbackNote: body.feedbackNote ?? null,
        receivedAt: nowISO(),
      },
    });

  // A returned mark means it was submitted, whatever the checklist says.
  if (!assignment.isSubmitted) {
    await db
      .update(assignments)
      .set({ isSubmitted: true, submittedAt: assignment.submittedAt ?? nowISO() })
      .where(eq(assignments.id, id));
  }

  const [grade] = await db
    .select()
    .from(grades)
    .where(eq(grades.assignmentId, id))
    .limit(1);
  return c.json(grade);
});

/** Remove a recorded mark, e.g. entered against the wrong assessment. */
assignmentsRoute.delete("/:id/grade", async (c) => {
  const db = c.get("db");
  await db.delete(grades).where(eq(grades.assignmentId, c.req.param("id")));
  return c.json({ ok: true });
});

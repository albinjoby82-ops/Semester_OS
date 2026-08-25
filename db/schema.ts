import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Semester OS schema (D1 / SQLite).
 *
 * Conventions:
 * - ids are text (nanoid-style) so the client can generate them offline and
 *   sync later without collision. This is what makes offline capture work.
 * - timestamps are ISO-8601 UTC strings, for readable rows and easy sorting.
 * - durations are minutes; grades are marks, not percentages.
 */

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

// ---------------------------------------------------------------------------
// Areas
// ---------------------------------------------------------------------------

/** university | gaelforce | accio | personal */
export const areas = sqliteTable("areas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** University is the protected floor; extracurricular areas are capped. */
  isUniversity: integer("is_university", { mode: "boolean" })
    .notNull()
    .default(false),
  /** Display colour token, resolved to a theme value on the client. */
  colorToken: text("color_token").notNull().default("neutral"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

/**
 * Drives how health is computed. The six modules are genuinely different
 * shapes -- MATH20290 is 85% one exam, EEEN20010 has no final at all -- so a
 * single health formula would be wrong for most of them.
 */
export type AssessmentProfile = "exam_heavy" | "continuous" | "portfolio";

export const modules = sqliteTable("modules", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  credits: integer("credits"),
  trimester: text("trimester").notNull(),
  coordinator: text("coordinator"),
  ucdUrl: text("ucd_url"),
  syllabusSummary: text("syllabus_summary"),
  /** UCD's stated total student effort, in hours. */
  studentEffortHours: integer("student_effort_hours"),
  assessmentProfile: text("assessment_profile")
    .$type<AssessmentProfile>()
    .notNull()
    .default("continuous"),
  /** Lecture attendance is mandatory for some modules (e.g. SCI20020). */
  attendanceMandatory: integer("attendance_mandatory", { mode: "boolean" })
    .notNull()
    .default(false),
  colorToken: text("color_token").notNull().default("neutral"),
  /** Google Drive folder this module maps to. Files stay in Drive. */
  driveFolderId: text("drive_folder_id"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(now),
});

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

export type AssessmentType =
  | "exam"
  | "midterm"
  | "lab_report"
  | "homework"
  | "quiz"
  | "project"
  | "portfolio"
  | "other";

export const assignments = sqliteTable(
  "assignments",
  {
    id: text("id").primaryKey(),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    assessmentType: text("assessment_type")
      .$type<AssessmentType>()
      .notNull()
      .default("other"),
    weightPercent: real("weight_percent").notNull(),

    /**
     * UCD publishes windows ("Weeks 7-9"), not dates. Keep the window until a
     * lecturer announces a real deadline, which lands in dueAt.
     */
    dueWeek: integer("due_week"),
    dueWeekEnd: integer("due_week_end"),
    dueAt: text("due_at"),
    isExam: integer("is_exam", { mode: "boolean" }).notNull().default(false),
    examMinutes: integer("exam_minutes"),

    /** Progress checklist. Complete != submitted -- the brief's key rule. */
    readBriefAt: text("read_brief_at"),
    startedAt: text("started_at"),
    mainWorkDoneAt: text("main_work_done_at"),
    checkedAt: text("checked_at"),
    isSubmitted: integer("is_submitted", { mode: "boolean" })
      .notNull()
      .default(false),
    submittedAt: text("submitted_at"),
    /** Deliberate second act: kills "I thought I'd submitted it". */
    submissionVerifiedAt: text("submission_verified_at"),

    estimatedMinutes: integer("estimated_minutes"),

    sourceUrl: text("source_url"),
    sourceLastCheckedAt: text("source_last_checked_at"),
    /** True once the user has confirmed the imported values are still right. */
    userConfirmed: integer("user_confirmed", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Set when the user edits a field, so the importer never overwrites it. */
    userEditedFields: text("user_edited_fields"),

    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("assignments_module_idx").on(t.moduleId),
    index("assignments_due_idx").on(t.dueAt),
  ],
);

// ---------------------------------------------------------------------------
// Grades
// ---------------------------------------------------------------------------

export const grades = sqliteTable(
  "grades",
  {
    id: text("id").primaryKey(),
    assignmentId: text("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    marksAwarded: real("marks_awarded").notNull(),
    marksPossible: real("marks_possible").notNull().default(100),
    receivedAt: text("received_at").notNull().default(now),
    feedbackNote: text("feedback_note"),
  },
  (t) => [uniqueIndex("grades_assignment_idx").on(t.assignmentId)],
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskStatus = "todo" | "in_progress" | "done" | "submitted";
export type TaskSource =
  | "manual"
  | "template"
  | "share"
  | "whatsapp"
  | "review"
  | "system";

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    areaId: text("area_id")
      .notNull()
      .references(() => areas.id),
    moduleId: text("module_id").references(() => modules.id, {
      onDelete: "set null",
    }),
    assignmentId: text("assignment_id").references(() => assignments.id, {
      onDelete: "set null",
    }),
    status: text("status").$type<TaskStatus>().notNull().default("todo"),

    dueAt: text("due_at"),
    weekNumber: integer("week_number"),
    estimatedMinutes: integer("estimated_minutes"),
    actualMinutes: integer("actual_minutes"),
    priorityOverride: integer("priority_override"),

    /** Implementation intention: the concrete slot this is booked into. */
    scheduledStartAt: text("scheduled_start_at"),
    scheduledEndAt: text("scheduled_end_at"),

    /** Weekly work that must not silently vanish if missed. */
    isRequiredWeekly: integer("is_required_weekly", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Debt may only be dismissed with a stated reason, keeping counts honest. */
    deferredReason: text("deferred_reason"),
    deferredAt: text("deferred_at"),

    source: text("source").$type<TaskSource>().notNull().default("manual"),
    createdAt: text("created_at").notNull().default(now),
    completedAt: text("completed_at"),
  },
  (t) => [
    index("tasks_status_idx").on(t.status),
    index("tasks_due_idx").on(t.dueAt),
    index("tasks_week_idx").on(t.weekNumber),
    index("tasks_module_idx").on(t.moduleId),
  ],
);

// ---------------------------------------------------------------------------
// Weekly templates
// ---------------------------------------------------------------------------

export const weeklyTemplates = sqliteTable("weekly_templates", {
  id: text("id").primaryKey(),
  moduleId: text("module_id")
    .notNull()
    .references(() => modules.id, { onDelete: "cascade" }),
  taskTitle: text("task_title").notNull(),
  defaultEstimatedMinutes: integer("default_estimated_minutes"),
  /** 1 = Monday .. 7 = Sunday. */
  defaultDay: integer("default_day"),
  required: integer("required", { mode: "boolean" }).notNull().default(true),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

// ---------------------------------------------------------------------------
// Topics and spaced review
// ---------------------------------------------------------------------------

/**
 * Powers revision debt. Exam-heavy modules look green on task completion right
 * up until they aren't; unreviewed topics make that risk present-tense.
 */
export const moduleTopics = sqliteTable(
  "module_topics",
  {
    id: text("id").primaryKey(),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    weekNumber: integer("week_number").notNull(),
    title: text("title").notNull(),
    firstReviewedAt: text("first_reviewed_at"),
    lastReviewedAt: text("last_reviewed_at"),
    nextReviewAt: text("next_review_at"),
    reviewCount: integer("review_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    index("topics_module_idx").on(t.moduleId),
    index("topics_next_review_idx").on(t.nextReviewAt),
  ],
);

// ---------------------------------------------------------------------------
// Time and capacity
// ---------------------------------------------------------------------------

/** Where the hours actually went. Source of truth for drift and calibration. */
export const timeSessions = sqliteTable(
  "time_sessions",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    areaId: text("area_id")
      .notNull()
      .references(() => areas.id),
    moduleId: text("module_id").references(() => modules.id, {
      onDelete: "set null",
    }),
    startedAt: text("started_at").notNull(),
    endedAt: text("ended_at"),
    weekNumber: integer("week_number"),
  },
  (t) => [
    index("sessions_week_idx").on(t.weekNumber),
    index("sessions_area_idx").on(t.areaId),
  ],
);

/**
 * Hand-entered recurring commitments (lectures, labs, meetings). Google
 * Calendar replaces this as the capacity source in Phase 2; keeping the same
 * shape means capacity maths is real from day one and the swap is clean.
 */
export const fixedCommitments = sqliteTable("fixed_commitments", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  areaId: text("area_id")
    .notNull()
    .references(() => areas.id),
  moduleId: text("module_id").references(() => modules.id, {
    onDelete: "cascade",
  }),
  /** 1 = Monday .. 7 = Sunday. */
  dayOfWeek: integer("day_of_week").notNull(),
  /** Minutes from local midnight, so it survives DST without shifting. */
  startMinute: integer("start_minute").notNull(),
  endMinute: integer("end_minute").notNull(),
  /** Null means every teaching week. */
  fromWeek: integer("from_week"),
  toWeek: integer("to_week"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

/** Mirror of Google Calendar. Phase 2. */
export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: text("id").primaryKey(),
    googleEventId: text("google_event_id").unique(),
    title: text("title").notNull(),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    isAllDay: integer("is_all_day", { mode: "boolean" })
      .notNull()
      .default(false),
    areaId: text("area_id").references(() => areas.id),
    moduleId: text("module_id").references(() => modules.id, {
      onDelete: "set null",
    }),
    syncedAt: text("synced_at").notNull().default(now),
  },
  (t) => [index("events_start_idx").on(t.startAt)],
);

// ---------------------------------------------------------------------------
// Anti-drift
// ---------------------------------------------------------------------------

/**
 * Your own stated intention for the week, set in Plan Week. All drift is
 * measured against this rather than a rule the app invented -- much harder to
 * argue with, and not patronising.
 */
export const weekAllocations = sqliteTable(
  "week_allocations",
  {
    id: text("id").primaryKey(),
    termId: text("term_id").notNull(),
    weekNumber: integer("week_number").notNull(),
    areaId: text("area_id")
      .notNull()
      .references(() => areas.id),
    plannedHours: real("planned_hours").notNull(),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("allocations_week_area_idx").on(
      t.termId,
      t.weekNumber,
      t.areaId,
    ),
  ],
);

/** Logged when you exceed your own allocation, so the pattern is visible. */
export const overrides = sqliteTable(
  "overrides",
  {
    id: text("id").primaryKey(),
    termId: text("term_id").notNull(),
    weekNumber: integer("week_number").notNull(),
    areaId: text("area_id")
      .notNull()
      .references(() => areas.id),
    reason: text("reason").notNull(),
    overageHours: real("overage_hours"),
    createdAt: text("created_at").notNull().default(now),
  },
  (t) => [index("overrides_week_idx").on(t.termId, t.weekNumber)],
);

// ---------------------------------------------------------------------------
// Capture and resources
// ---------------------------------------------------------------------------

/**
 * Raw inbound capture. An unparsed line here is a success, not an error --
 * capture must never fail, so parsing is applied after the row is safely saved.
 */
export const captureInbox = sqliteTable(
  "capture_inbox",
  {
    id: text("id").primaryKey(),
    rawText: text("raw_text").notNull(),
    source: text("source").$type<TaskSource>().notNull().default("manual"),
    receivedAt: text("received_at").notNull().default(now),
    resolvedTaskId: text("resolved_task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    resolvedAt: text("resolved_at"),
  },
  (t) => [index("inbox_unresolved_idx").on(t.resolvedAt)],
);

export type ResourceType =
  | "slide"
  | "notes"
  | "lab"
  | "assignment"
  | "formula_sheet"
  | "reading"
  | "other";

export const resources = sqliteTable(
  "resources",
  {
    id: text("id").primaryKey(),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    type: text("type").$type<ResourceType>().notNull().default("other"),
    googleDriveFileId: text("google_drive_file_id"),
    weekNumber: integer("week_number"),
    source: text("source").notNull().default("drive"),
    url: text("url"),
  },
  (t) => [index("resources_module_idx").on(t.moduleId)],
);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** Single-row key/value settings (term id, weekly capacity, area caps). */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(now),
});

export type Module = typeof modules.$inferSelect;
export type Assignment = typeof assignments.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Area = typeof areas.$inferSelect;
export type Grade = typeof grades.$inferSelect;
export type ModuleTopic = typeof moduleTopics.$inferSelect;
export type TimeSession = typeof timeSessions.$inferSelect;
export type FixedCommitment = typeof fixedCommitments.$inferSelect;
export type WeekAllocation = typeof weekAllocations.$inferSelect;

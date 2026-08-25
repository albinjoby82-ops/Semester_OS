import type { GradeSummary } from "../../shared/grades";
import type { ModuleRisk } from "../../shared/risk";
import type { WeekCapacity, OverloadWarning } from "../../shared/capacity";
import type { DriftReport, TrailingRatio } from "../../shared/drift";
import type { Calibration } from "../../shared/calibration";

export interface Assessment {
  id: string;
  moduleId: string;
  title: string;
  assessmentType: string;
  weightPercent: number;
  dueWeek: number | null;
  dueWeekEnd: number | null;
  dueAt: string | null;
  isExam: boolean;
  isSubmitted: boolean;
  submittedAt: string | null;
}

export interface ModuleView {
  id: string;
  code: string;
  name: string;
  coordinator: string | null;
  studentEffortHours: number | null;
  assessmentProfile: "exam_heavy" | "continuous" | "portfolio";
  attendanceMandatory: boolean;
  colorToken: string;
  ucdUrl: string | null;
  assessments: Assessment[];
  gradeSummary: GradeSummary;
  risk: ModuleRisk;
}

export interface Task {
  id: string;
  title: string;
  areaId: string;
  moduleId: string | null;
  assignmentId: string | null;
  status: "todo" | "in_progress" | "done" | "submitted";
  dueAt: string | null;
  weekNumber: number | null;
  estimatedMinutes: number | null;
  isRequiredWeekly: boolean;
  deferredReason: string | null;
  createdAt: string;
}

export interface Area {
  id: string;
  name: string;
  isUniversity: boolean;
  colorToken: string;
  sortOrder: number;
}

export interface WeekView {
  currentWeek: number | null;
  term: { id: string; label: string; teachingWeeks: number };
  capacity: WeekCapacity | null;
  horizon: WeekCapacity[];
  overloaded: OverloadWarning[];
  drift: DriftReport;
  trailing: TrailingRatio;
  /** "tracked" once Focus mode logs real sessions; "estimated" until then. */
  actualsSource: "tracked" | "estimated";
  allocations: { areaId: string; plannedHours: number }[];
  effort: {
    statedPerWeek: number;
    realisticHours: number;
    gapPerWeek: number;
    feasible: boolean;
  };
}

export interface TimeSession {
  id: string;
  taskId: string | null;
  areaId: string;
  moduleId: string | null;
  startedAt: string;
  endedAt: string | null;
  weekNumber: number | null;
}

export interface ActiveSession {
  session: TimeSession;
  task: Task | null;
}

export interface DebtView {
  currentWeek: number | null;
  items: Task[];
  count: number;
  byModule: { code: string; titles: string[] }[];
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  modules: () => json<ModuleView[]>("/api/modules"),
  areas: () => json<Area[]>("/api/areas"),
  tasks: () => json<Task[]>("/api/tasks"),
  week: () => json<WeekView>("/api/week"),
  activeSession: () => json<ActiveSession | null>("/api/sessions/active"),
  calibration: () => json<Calibration>("/api/sessions/calibration"),

  startSession: (taskId: string) =>
    json<ActiveSession>("/api/sessions/start", {
      method: "POST",
      body: JSON.stringify({ taskId }),
    }),

  stopSession: (complete: boolean) =>
    json<{ minutes: number; task: Task | null }>("/api/sessions/stop", {
      method: "POST",
      body: JSON.stringify({ complete }),
    }),
  debt: () => json<DebtView>("/api/week/debt"),

  setAllocations: (
    allocations: { areaId: string; plannedHours: number }[],
    weekNumber?: number,
  ) =>
    json<unknown>("/api/week/allocations", {
      method: "PUT",
      body: JSON.stringify({ allocations, weekNumber }),
    }),

  logOverride: (input: {
    areaId: string;
    reason: string;
    overageHours?: number;
  }) =>
    json<unknown>("/api/week/overrides", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  createTask: (input: Partial<Task> & { title: string }) =>
    json<Task>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),

  updateTask: (id: string, patch: Partial<Task> & { deferredReason?: string }) =>
    json<Task>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

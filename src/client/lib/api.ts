import type { GradeSummary } from "../../shared/grades";

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

  createTask: (input: Partial<Task> & { title: string }) =>
    json<Task>("/api/tasks", { method: "POST", body: JSON.stringify(input) }),

  updateTask: (id: string, patch: Partial<Task> & { deferredReason?: string }) =>
    json<Task>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
};

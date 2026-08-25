import { useCallback, useEffect, useMemo, useState } from "react";
import { CURRENT_TERM, TERM_DATES_UNCONFIRMED } from "../shared/term-config";
import { teachingWeekForDate } from "../shared/term-week";
import { parseCapture } from "../shared/parse-capture";
import {
  api,
  type Area,
  type DebtView,
  type ModuleView,
  type Task,
  type WeekView,
} from "./lib/api";
import { daysBetween, formatMinutes } from "./lib/format";
import { QuickCapture } from "./components/QuickCapture";
import { TaskRow } from "./components/TaskRow";
import { OverloadHorizon } from "./components/OverloadHorizon";
import { WeekPanel } from "./components/WeekPanel";
import { ModuleCard } from "./components/ModuleCard";

export function App() {
  const [modules, setModules] = useState<ModuleView[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [week, setWeek] = useState<WeekView | null>(null);
  const [debt, setDebt] = useState<DebtView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [m, a, t, w, d] = await Promise.all([
        api.modules(),
        api.areas(),
        api.tasks(),
        api.week(),
        api.debt(),
      ]);
      setModules(m);
      setAreas(a);
      setTasks(t);
      setWeek(w);
      setDebt(d);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Q from anywhere. Capture has to be faster than opening anything else.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        setCapturing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const moduleById = useMemo(
    () => new Map(modules.map((m) => [m.id, m])),
    [modules],
  );
  const moduleByCode = useMemo(
    () => new Map(modules.map((m) => [m.code, m])),
    [modules],
  );
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const capture = async (raw: string) => {
    const parsed = parseCapture(raw);
    const module = parsed.moduleCode
      ? moduleByCode.get(parsed.moduleCode)
      : undefined;

    const optimistic: Task = {
      id: crypto.randomUUID(),
      title: parsed.title,
      areaId: parsed.areaId ?? "university",
      moduleId: module?.id ?? null,
      assignmentId: null,
      status: "todo",
      dueAt: parsed.dueAt,
      weekNumber: null,
      estimatedMinutes: parsed.estimatedMinutes,
      isRequiredWeekly: false,
      deferredReason: null,
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [optimistic, ...prev]);
    setCapturing(false);

    try {
      await api.createTask({
        id: optimistic.id,
        title: optimistic.title,
        areaId: optimistic.areaId,
        moduleId: optimistic.moduleId,
        dueAt: optimistic.dueAt,
        estimatedMinutes: optimistic.estimatedMinutes,
      });
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to save");
    }
  };

  const patch = async (id: string, changes: Parameters<typeof api.updateTask>[1]) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...changes } as Task : t)),
    );
    try {
      await api.updateTask(id, changes);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed");
      void load();
    }
  };

  const isAssessed = (task: Task) => Boolean(task.assignmentId);

  const handlers = {
    onToggleDone: (task: Task) =>
      patch(task.id, {
        status: task.status === "todo" || task.status === "in_progress"
          ? "done"
          : "todo",
      }),
    onSubmit: (task: Task) => patch(task.id, { status: "submitted" }),
    onDefer: (task: Task, reason: string) =>
      patch(task.id, { deferredReason: reason }),
  };

  const now = new Date();
  // Debt is rendered in its own section; excluding those ids here keeps a task
  // from appearing twice on the same screen.
  const debtIds = useMemo(
    () => new Set((debt?.items ?? []).map((t) => t.id)),
    [debt],
  );

  const groups = useMemo(() => {
    const overdue: Task[] = [];
    const today: Task[] = [];
    const upcoming: Task[] = [];
    const undated: Task[] = [];

    for (const task of tasks) {
      if (debtIds.has(task.id)) continue;
      if (!task.dueAt) {
        undated.push(task);
        continue;
      }
      const days = daysBetween(now, new Date(task.dueAt));
      if (days < 0) overdue.push(task);
      else if (days === 0) today.push(task);
      else upcoming.push(task);
    }
    return { overdue, today, upcoming, undated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, debtIds]);

  const currentWeek = teachingWeekForDate(now, CURRENT_TERM);
  const totalEffort = modules.reduce(
    (sum, m) => sum + (m.studentEffortHours ?? 0),
    0,
  );
  const committedMinutes = tasks.reduce(
    (sum, t) => sum + (t.estimatedMinutes ?? 0),
    0,
  );

  const renderTasks = (list: Task[]) => (
    <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      {list.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          module={task.moduleId ? moduleById.get(task.moduleId) : undefined}
          area={areaById.get(task.areaId)}
          isAssessed={isAssessed(task)}
          {...handlers}
        />
      ))}
    </ul>
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            Semester OS
          </h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">
            {CURRENT_TERM.label}
            {currentWeek
              ? ` · Week ${currentWeek} of ${CURRENT_TERM.teachingWeeks}`
              : " · outside teaching weeks"}
          </p>
        </div>
        <button
          onClick={() => setCapturing(true)}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm hover:border-[var(--color-accent)]"
        >
          + Quick task{" "}
          <kbd className="ml-1 rounded bg-[var(--color-bg)] px-1 text-[10px] text-[var(--color-muted)]">
            Q
          </kbd>
        </button>
      </header>

      {TERM_DATES_UNCONFIRMED && (
        <p className="mb-5 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
          <strong>Term dates unconfirmed.</strong> Week numbers are provisional
          until the real UCD Autumn 2026 start date and study week are set in{" "}
          <code>src/shared/term-config.ts</code>.
        </p>
      )}

      {week && (
        <OverloadHorizon horizon={week.horizon} currentWeek={week.currentWeek} />
      )}

      {error && (
        <p className="my-4 rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="my-10 text-sm text-[var(--color-muted)]">Loading…</p>
      ) : (
        <>
          {week && (
            <WeekPanel
              week={week}
              areas={areas}
              onSaveAllocations={async (allocations) => {
                await api.setAllocations(allocations);
                void load();
              }}
            />
          )}

          {/* Academic debt: expected work that should already be done. */}
          {debt && debt.count > 0 && (
            <Section
              title={`Academic debt: ${debt.count}`}
              tone="danger"
              note="University work from this week or earlier that should already be complete. It carries forward until done, rescheduled, or dismissed with a reason."
            >
              <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted)]">
                {debt.byModule.map((entry) => (
                  <span key={entry.code}>
                    <strong className="text-[var(--color-fg)]">
                      {entry.code}
                    </strong>{" "}
                    {entry.titles.length}
                  </span>
                ))}
              </p>
              {renderTasks(debt.items)}
            </Section>
          )}

          {/* Overdue first, always. Never hide overdue work. */}
          {groups.overdue.length > 0 && (
            <Section
              title={`Overdue (${groups.overdue.length})`}
              tone="danger"
              note="Carried forward until done, rescheduled, or dismissed with a reason."
            >
              {renderTasks(groups.overdue)}
            </Section>
          )}

          <Section title={`Today (${groups.today.length})`}>
            {groups.today.length > 0 ? (
              renderTasks(groups.today)
            ) : (
              <Empty>Nothing due today.</Empty>
            )}
          </Section>

          {groups.upcoming.length > 0 && (
            <Section title={`Upcoming (${groups.upcoming.length})`}>
              {renderTasks(groups.upcoming)}
            </Section>
          )}

          {groups.undated.length > 0 && (
            <Section
              title={`No date (${groups.undated.length})`}
              note="Captured but not yet placed. Give these a day to make them real."
            >
              {renderTasks(groups.undated)}
            </Section>
          )}

          {tasks.length === 0 && (
            <Empty>
              Nothing captured yet. Press <Kbd>Q</Kbd> and type something like{" "}
              <code>digital lab friday 1h</code>.
            </Empty>
          )}

          <Section title="Modules">
            <div className="grid gap-3 sm:grid-cols-2">
              {modules.map((module) => (
                <ModuleCard key={module.id} module={module} />
              ))}
            </div>

            {totalEffort > 0 && week && (
              <p className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-muted)]">
                <strong className="text-[var(--color-fg)]">
                  The honest effort budget.
                </strong>{" "}
                UCD states {totalEffort}h of total effort across these six
                modules — about{" "}
                <strong className="text-[var(--color-fg)]">
                  {week.effort.statedPerWeek.toFixed(1)}h a week
                </strong>{" "}
                of university work alone, against{" "}
                {week.effort.realisticHours}h of realistically allocatable time,
                before GaelForce and Accio.
                {!week.effort.feasible && (
                  <>
                    {" "}
                    That is{" "}
                    <strong className="text-rose-300">
                      {week.effort.gapPerWeek.toFixed(1)}h a week more than fits
                    </strong>
                    . Something has to give, and it is better to choose than to
                    discover it.
                  </>
                )}
                {committedMinutes > 0 && (
                  <>
                    {" "}
                    You currently have{" "}
                    <strong className="text-[var(--color-fg)]">
                      {formatMinutes(committedMinutes)}
                    </strong>{" "}
                    of estimated work captured.
                  </>
                )}
              </p>
            )}
          </Section>
        </>
      )}

      <QuickCapture
        open={capturing}
        modules={modules}
        onClose={() => setCapturing(false)}
        onSave={(raw) => void capture(raw)}
      />
    </div>
  );
}

function Section({
  title,
  note,
  tone,
  children,
}: {
  title: string;
  note?: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <section className="my-7">
      <h2
        className="mb-2 text-xs font-semibold uppercase tracking-widest"
        style={{
          color: tone === "danger" ? "#fb7185" : "var(--color-muted)",
        }}
      >
        {title}
      </h2>
      {note && (
        <p className="mb-2 text-xs text-[var(--color-muted)]">{note}</p>
      )}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">
      {children}
    </p>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 text-[11px]">
      {children}
    </kbd>
  );
}

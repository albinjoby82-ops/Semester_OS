import { useCallback, useEffect, useRef, useState } from "react";
import { CURRENT_TERM, TERM_DATES_UNCONFIRMED } from "../shared/term-config";
import {
  allTeachingWeeks,
  dateRangeForWeek,
  formatRange,
  teachingWeekForDate,
} from "../shared/term-week";
import type { GradeSummary } from "../shared/grades";

interface Assessment {
  id: string;
  title: string;
  weightPercent: number;
  dueWeek: number | null;
  dueWeekEnd: number | null;
  isExam: boolean;
  isSubmitted: boolean;
}

interface ModuleView {
  id: string;
  code: string;
  name: string;
  coordinator: string | null;
  studentEffortHours: number | null;
  assessmentProfile: "exam_heavy" | "continuous" | "portfolio";
  colorToken: string;
  assessments: Assessment[];
  gradeSummary: GradeSummary;
}

interface Task {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  estimatedMinutes: number | null;
}

/** Module colours. Never the only signal -- always paired with text. */
const MODULE_COLOR: Record<string, string> = {
  amber: "#d97706",
  emerald: "#059669",
  sky: "#0284c7",
  rose: "#e11d48",
  violet: "#7c3aed",
  teal: "#0d9488",
  neutral: "#64748b",
};

const PROFILE_LABEL: Record<ModuleView["assessmentProfile"], string> = {
  exam_heavy: "Exam-heavy",
  continuous: "Continuous",
  portfolio: "Portfolio",
};

export function App() {
  const [modules, setModules] = useState<ModuleView[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const captureRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([
        fetch("/api/modules").then((r) => r.json()),
        fetch("/api/tasks").then((r) => r.json()),
      ]);
      setModules(Array.isArray(m) ? m : []);
      setTasks(Array.isArray(t) ? t : []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Press Q anywhere to capture. Under five seconds, or it will not get used.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA";
      if (event.key.toLowerCase() === "q" && !typing && !event.metaKey) {
        event.preventDefault();
        setCapturing(true);
      }
      if (event.key === "Escape") setCapturing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (capturing) captureRef.current?.focus();
  }, [capturing]);

  const capture = async (title: string) => {
    if (!title.trim()) return;
    // Optimistic: the row appears immediately, sync follows.
    const optimistic: Task = {
      id: crypto.randomUUID(),
      title: title.trim(),
      status: "todo",
      dueAt: null,
      estimatedMinutes: null,
    };
    setTasks((prev) => [optimistic, ...prev]);
    setCapturing(false);

    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: optimistic.id, title: optimistic.title }),
    });
    void load();
  };

  const currentWeek = teachingWeekForDate(new Date(), CURRENT_TERM);
  const totalEffort = modules.reduce(
    (sum, m) => sum + (m.studentEffortHours ?? 0),
    0,
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <header className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Semester OS</h1>
          <p className="text-sm text-[var(--color-muted)]">
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
          + Quick task <kbd className="ml-1 text-[var(--color-muted)]">Q</kbd>
        </button>
      </header>

      {TERM_DATES_UNCONFIRMED && (
        <p className="mb-6 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          <strong>Term dates unconfirmed.</strong> Week numbers are provisional
          until the real UCD Autumn 2026 start date and study week are set in{" "}
          <code>src/shared/term-config.ts</code>.
        </p>
      )}

      <TrimesterStrip currentWeek={currentWeek} modules={modules} />

      {capturing && (
        <form
          className="my-6"
          onSubmit={(event) => {
            event.preventDefault();
            const input = captureRef.current;
            if (input) void capture(input.value);
            if (input) input.value = "";
          }}
        >
          <input
            ref={captureRef}
            placeholder="What needs doing?  (Enter to save, Esc to cancel)"
            className="w-full rounded-md border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 outline-none"
            onBlur={() => setCapturing(false)}
          />
        </form>
      )}

      {error && (
        <p className="my-4 rounded-md border border-rose-800 bg-rose-950/40 px-3 py-2 text-sm text-rose-200">
          {error}
        </p>
      )}

      <section className="my-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          Open tasks ({tasks.length})
        </h2>
        {tasks.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            Nothing captured yet. Press <kbd>Q</kbd>.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--color-border)] rounded-md border border-[var(--color-border)]">
            {tasks.map((task) => (
              <li key={task.id} className="px-4 py-2.5 text-sm">
                {task.title}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="my-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          Modules
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {modules.map((module) => (
            <ModuleCard key={module.id} module={module} />
          ))}
        </div>
        {totalEffort > 0 && (
          <p className="mt-4 text-sm text-[var(--color-muted)]">
            UCD states <strong>{totalEffort}h</strong> of total effort across
            these modules — about{" "}
            <strong>
              {Math.round(totalEffort / CURRENT_TERM.teachingWeeks)}h/week
            </strong>{" "}
            of university work alone, before GaelForce and Accio.
          </p>
        )}
      </section>
    </div>
  );
}

function TrimesterStrip({
  currentWeek,
  modules,
}: {
  currentWeek: number | null;
  modules: ModuleView[];
}) {
  const weeks = allTeachingWeeks(CURRENT_TERM);
  const loadByWeek = new Map<number, number>();
  for (const module of modules) {
    for (const a of module.assessments) {
      if (a.dueWeek == null) continue;
      for (let w = a.dueWeek; w <= (a.dueWeekEnd ?? a.dueWeek); w += 1) {
        loadByWeek.set(w, (loadByWeek.get(w) ?? 0) + a.weightPercent);
      }
    }
  }
  const peak = Math.max(1, ...loadByWeek.values());

  return (
    <div className="flex gap-1">
      {weeks.map((week) => {
        const load = loadByWeek.get(week) ?? 0;
        const isNow = week === currentWeek;
        return (
          <div
            key={week}
            title={`Week ${week} · ${formatRange(dateRangeForWeek(week, CURRENT_TERM))} · ${Math.round(load)}% of assessment weight due`}
            className="flex-1"
          >
            <div
              className="h-10 rounded-sm border"
              style={{
                borderColor: isNow ? "var(--color-accent)" : "var(--color-border)",
                background: `color-mix(in srgb, var(--color-accent) ${Math.round((load / peak) * 45)}%, var(--color-surface))`,
              }}
            />
            <div
              className={`mt-1 text-center text-[10px] ${isNow ? "font-bold text-[var(--color-accent)]" : "text-[var(--color-muted)]"}`}
            >
              {week}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModuleCard({ module }: { module: ModuleView }) {
  const color = MODULE_COLOR[module.colorToken] ?? MODULE_COLOR.neutral;
  const { gradeSummary: g } = module;

  return (
    <article className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-sm font-semibold" style={{ color }}>
          {module.code}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          {PROFILE_LABEL[module.assessmentProfile]}
        </span>
      </div>
      <p className="mt-0.5 text-sm">{module.name}</p>

      {/* Grade banked vs at stake. Progress only where progress is earned. */}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg)]">
        <div
          className="h-full"
          style={{ width: `${g.bankedWeight}%`, background: color }}
        />
      </div>
      <p className="mt-1.5 text-xs text-[var(--color-muted)]">
        {g.gradedCount === 0
          ? `No results yet · ${module.assessments.length} assessments · 100% at stake`
          : `${g.bankedPoints.toFixed(1)}% banked of ${g.bankedWeight}% assessed · ${g.atStakeWeight}% still at stake`}
      </p>
    </article>
  );
}

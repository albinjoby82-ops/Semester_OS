import { useState } from "react";
import type { Area, ModuleView, Task } from "../lib/api";
import {
  colorFor,
  describeDue,
  formatMinutes,
  URGENCY_COLOR,
} from "../lib/format";

interface Props {
  task: Task;
  module: ModuleView | undefined;
  area: Area | undefined;
  /** True when this task is tied to assessed work. */
  isAssessed: boolean;
  onToggleDone: (task: Task) => void;
  onSubmit: (task: Task) => void;
  onDefer: (task: Task, reason: string) => void;
  onStart: (task: Task) => void;
}

export function TaskRow({
  task,
  module,
  area,
  isAssessed,
  onToggleDone,
  onSubmit,
  onDefer,
  onStart,
}: Props) {
  const [deferring, setDeferring] = useState(false);
  const due = describeDue(task.dueAt);
  const duration = formatMinutes(task.estimatedMinutes);
  const isDone = task.status === "done" || task.status === "submitted";

  return (
    <li className="task-row group flex flex-wrap items-center gap-x-3 gap-y-1 sm:px-4">
      <button
        onClick={() => onToggleDone(task)}
        aria-label={isDone ? `Reopen ${task.title}` : `Complete ${task.title}`}
        aria-pressed={isDone}
        className="flex size-[18px] shrink-0 items-center justify-center rounded border border-[var(--color-border)] text-[11px] hover:border-[var(--color-accent)]"
        style={
          isDone
            ? { background: "var(--color-accent)", borderColor: "var(--color-accent)" }
            : undefined
        }
      >
        {isDone ? "✓" : ""}
      </button>

      <span
        className={`min-w-0 flex-1 text-sm ${isDone ? "text-[var(--color-muted)] line-through" : ""}`}
      >
        {task.title}
      </span>

      {module && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
          style={{
            color: colorFor(module.colorToken),
            background: `color-mix(in srgb, ${colorFor(module.colorToken)} 14%, transparent)`,
          }}
        >
          {module.code}
        </span>
      )}

      {!module && area && !area.isUniversity && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
          style={{
            color: colorFor(area.colorToken),
            background: `color-mix(in srgb, ${colorFor(area.colorToken)} 14%, transparent)`,
          }}
        >
          {area.name}
        </span>
      )}

      {duration && (
        <span className="shrink-0 text-xs text-[var(--color-muted)]">
          {duration}
        </span>
      )}

      {due && (
        <span
          className="shrink-0 text-xs"
          style={{ color: URGENCY_COLOR[due.urgency] }}
        >
          {due.label}
        </span>
      )}

      {/*
        Complete != submitted. Assessed work stays visibly open after the work
        is done, until submission is separately confirmed.
      */}
      {isAssessed && task.status === "done" && (
        <button
          onClick={() => onSubmit(task)}
          className="shrink-0 rounded border border-amber-600/60 bg-amber-950/40 px-2 py-0.5 text-[11px] text-amber-200 hover:border-amber-500"
        >
          Not submitted — mark submitted
        </button>
      )}

      {isAssessed && task.status === "submitted" && (
        <span className="shrink-0 text-[11px] text-emerald-400">Submitted</span>
      )}

      {!isDone && (
        <button
          onClick={() => onStart(task)}
          className="shrink-0 rounded border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]"
          title="Focus on this task and track the time"
        >
          Start
        </button>
      )}

      {!isDone &&
        (deferring ? (
          <form
            className="flex w-full gap-2 pl-[30px] sm:w-auto sm:pl-0"
            onSubmit={(event) => {
              event.preventDefault();
              const input = new FormData(event.currentTarget).get("reason");
              const reason = String(input ?? "").trim();
              if (!reason) return;
              onDefer(task, reason);
              setDeferring(false);
            }}
          >
            <input
              name="reason"
              autoFocus
              placeholder="Why is this being dropped?"
              className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-xs outline-none focus:border-[var(--color-accent)] sm:w-56"
            />
            <button className="rounded border border-[var(--color-border)] px-2 py-1 text-xs">
              Save
            </button>
          </form>
        ) : (
          <button
            onClick={() => setDeferring(true)}
            className="shrink-0 text-xs text-[var(--color-muted)] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            title="Dismiss with a reason"
          >
            Dismiss
          </button>
        ))}
    </li>
  );
}

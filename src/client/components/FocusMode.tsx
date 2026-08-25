import { useEffect, useState } from "react";
import type { ModuleView, Task } from "../lib/api";
import { colorFor, formatMinutes } from "../lib/format";

/**
 * Focus mode: the UI collapses to a single task and a timer.
 *
 * No dashboard, no lists, no counts. The point is that nothing else is
 * visible while working -- which is also why the exit is deliberate rather
 * than a stray click.
 */
export function FocusMode({
  task,
  module,
  startedAt,
  onFinish,
  onPause,
}: {
  task: Task;
  module: ModuleView | undefined;
  startedAt: string;
  onFinish: () => void;
  onPause: () => void;
}) {
  const [elapsed, setElapsed] = useState(() => elapsedSeconds(startedAt));

  useEffect(() => {
    setElapsed(elapsedSeconds(startedAt));
    const timer = setInterval(() => setElapsed(elapsedSeconds(startedAt)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  // Esc pauses rather than finishes: a stray key must not close out work.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onPause();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPause]);

  const estimate = task.estimatedMinutes;
  const elapsedMinutes = Math.floor(elapsed / 60);
  const overEstimate = estimate != null && elapsedMinutes > estimate;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[var(--color-bg)] px-6 text-center">
      {module && (
        <p
          className="font-mono text-xs tracking-widest"
          style={{ color: colorFor(module.colorToken) }}
        >
          {module.code} · {module.name.toUpperCase()}
        </p>
      )}

      <h1 className="mt-3 max-w-2xl text-2xl font-semibold sm:text-3xl">
        {task.title}
      </h1>

      <p
        className="mt-8 font-mono text-5xl tabular-nums sm:text-6xl"
        aria-live="off"
      >
        {formatClock(elapsed)}
      </p>

      <p className="mt-3 text-sm text-[var(--color-muted)]">
        {estimate != null ? (
          <>
            Estimated {formatMinutes(estimate)}
            {overEstimate && (
              <span className="text-amber-300">
                {" "}
                · {formatMinutes(elapsedMinutes - estimate)} over
              </span>
            )}
          </>
        ) : (
          "No estimate — this session will still be tracked."
        )}
      </p>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={onFinish}
          className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/15 px-6 py-2.5 text-sm font-medium"
        >
          Finish
        </button>
        <button
          onClick={onPause}
          className="rounded-md border border-[var(--color-border)] px-5 py-2.5 text-sm text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          Stop without completing
        </button>
      </div>

      <p className="mt-6 text-[11px] text-[var(--color-muted)]">
        Time is recorded either way — stopping only leaves the task open.
      </p>
    </div>
  );
}

function elapsedSeconds(startedAt: string): number {
  const seconds = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return seconds > 0 ? seconds : 0;
}

function formatClock(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

import { useState } from "react";
import type { ModuleView } from "../lib/api";
import type { WireScoredTask } from "../lib/wire";
import { colorFor, formatMinutes } from "../lib/format";

/**
 * "What should I do next?"
 *
 * The reason is always shown, and the full score breakdown is one click
 * away. Never make the recommendation feel mysterious (brief section 8) --
 * an opaque suggestion is one the user overrides once and then ignores.
 */
export function NextAction({
  recommended,
  minutesAvailable,
  module,
  onStart,
}: {
  recommended: WireScoredTask | null;
  minutesAvailable: number | null;
  module: ModuleView | undefined;
  onStart: (taskId: string) => void;
}) {
  const [showWorking, setShowWorking] = useState(false);

  if (!recommended) {
    return (
      <section className="my-7 rounded-md border border-dashed border-[var(--color-border)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">
        Nothing open. Press <kbd>Q</kbd> to capture something.
      </section>
    );
  }

  const { task } = recommended;
  const color = module ? colorFor(module.colorToken) : "var(--color-accent)";

  return (
    <section className="my-7 rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          What should I do?
        </h2>
        {minutesAvailable != null && (
          <span className="text-[11px] text-[var(--color-muted)]">
            {minutesAvailable === 0
              ? "You are in a scheduled commitment now"
              : `${formatMinutes(minutesAvailable)} before your next commitment`}
          </span>
        )}
      </div>

      <p className="mt-2 flex flex-wrap items-center gap-2 text-lg font-semibold">
        {module && (
          <span className="font-mono text-xs" style={{ color }}>
            {module.code}
          </span>
        )}
        {task.title}
      </p>

      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
        {task.estimatedMinutes && (
          <span>{formatMinutes(task.estimatedMinutes)}</span>
        )}
        {!recommended.fits && (
          <span className="text-amber-300">longer than the gap you have</span>
        )}
      </p>

      <p className="mt-2 text-sm leading-relaxed">{recommended.reason}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => onStart(task.id)}
          className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/15 px-5 py-2 text-sm font-medium"
        >
          Start
        </button>
        <button
          onClick={() => setShowWorking((value) => !value)}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          {showWorking ? "Hide working" : "Show working"}
        </button>
      </div>

      {/* The full breakdown: same numbers that produced the ranking. */}
      {showWorking && (
        <div className="mt-3 border-t border-[var(--color-border)] pt-3">
          <table className="w-full text-[11px]">
            <tbody>
              {recommended.components.map((component) => (
                <tr key={component.key}>
                  <td className="py-0.5 text-[var(--color-muted)]">
                    {component.label}
                  </td>
                  <td className="py-0.5 text-right font-mono">
                    +{component.points.toFixed(1)}
                  </td>
                </tr>
              ))}
              {recommended.adjustments.map((adjustment) => (
                <tr key={adjustment.key}>
                  <td className="py-0.5 text-amber-300/80">
                    {adjustment.label}
                  </td>
                  <td className="py-0.5 text-right font-mono text-amber-300/80">
                    {adjustment.points.toFixed(1)}
                  </td>
                </tr>
              ))}
              <tr className="border-t border-[var(--color-border)]">
                <td className="pt-1 font-medium">Score</td>
                <td className="pt-1 text-right font-mono font-medium">
                  {recommended.score.toFixed(1)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

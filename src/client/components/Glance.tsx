import type { DebtView, ModuleView, WeekView } from "../lib/api";
import type { WireNextView } from "../lib/wire";
import { colorFor, formatHours, formatMinutes } from "../lib/format";

/**
 * The phone Glance.
 *
 * Deliberately tiny. The brief is explicit that this must never become a
 * miniature desktop dashboard, so it answers exactly five questions and
 * offers exactly two actions.
 */
export function Glance({
  week,
  debt,
  modules,
  next,
  onCapture,
  onStart,
}: {
  week: WeekView | null;
  debt: DebtView | null;
  modules: ModuleView[];
  next: WireNextView | null;
  onCapture: () => void;
  onStart: (taskId: string) => void;
}) {
  const capacity = week?.capacity;
  const onTrack = healthPercent(modules);

  return (
    <div className="mx-auto max-w-sm">
      <p className="font-mono text-xs tracking-widest text-[var(--color-muted)]">
        {week?.currentWeek
          ? `WEEK ${week.currentWeek} · ${onTrack}% ON TRACK`
          : "OUTSIDE TEACHING WEEKS"}
      </p>

      <ul className="mt-4 space-y-1.5">
        {modules.map((module) => {
          const atRisk = Math.round(module.risk.percentAtRisk);
          return (
            <li
              key={module.id}
              className="flex items-center gap-2 text-sm"
            >
              <span
                aria-hidden
                className="inline-block size-2 shrink-0 rounded-full"
                style={{
                  background:
                    atRisk > 0
                      ? "#e11d48"
                      : module.risk.watchWeight > 0
                        ? "#d97706"
                        : "#059669",
                }}
              />
              <span
                className="w-24 shrink-0 truncate font-mono text-xs"
                style={{ color: colorFor(module.colorToken) }}
              >
                {module.code}
              </span>
              {/* Never colour alone: the state is always spelled out. */}
              <span className="text-xs text-[var(--color-muted)]">
                {atRisk > 0
                  ? `${atRisk}% behind`
                  : module.risk.watchWeight > 0
                    ? "watch"
                    : "on track"}
              </span>
            </li>
          );
        })}
      </ul>

      {debt && debt.count > 0 && (
        <p className="mt-4 text-sm">
          <span className="text-[var(--color-muted)]">ACADEMIC DEBT</span>{" "}
          <strong className="text-rose-300">{debt.count}</strong>
        </p>
      )}

      <section className="mt-5">
        <p className="font-mono text-[11px] tracking-widest text-[var(--color-muted)]">
          NEXT
        </p>
        {next?.recommended ? (
          <>
            <p className="mt-1 text-base font-semibold">
              {next.recommended.task.title}
            </p>
            <p className="text-xs text-[var(--color-muted)]">
              {[
                next.recommended.task.estimatedMinutes
                  ? formatMinutes(next.recommended.task.estimatedMinutes)
                  : null,
                next.recommended.reason.replace(/^Recommended because /, ""),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Nothing open.
          </p>
        )}
      </section>

      {capacity && (
        <section className="mt-5">
          <p className="font-mono text-[11px] tracking-widest text-[var(--color-muted)]">
            CAPACITY
          </p>
          <p className="mt-1 text-sm">
            {formatHours(capacity.committedHours)} /{" "}
            {formatHours(capacity.freeHours)} committed
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--color-surface)]">
            <div
              className="h-full"
              style={{
                width: `${Math.min(100, capacity.utilisation * 100)}%`,
                background: capacity.overloaded ? "#e11d48" : "var(--color-accent)",
              }}
            />
          </div>
        </section>
      )}

      <div className="mt-7 grid grid-cols-2 gap-2">
        <button
          onClick={onCapture}
          className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3 text-sm"
        >
          + Quick task
        </button>
        <button
          onClick={() =>
            next?.recommended && onStart(next.recommended.task.id)
          }
          disabled={!next?.recommended}
          className="rounded-md border border-[var(--color-accent)] bg-[var(--color-accent)]/15 px-3 py-3 text-sm disabled:opacity-40"
        >
          Start next
        </button>
      </div>
    </div>
  );
}

/**
 * A single headline number.
 *
 * Derived from weight-at-risk across all modules, so it means "the share of
 * your assessed work that is on schedule" rather than a vague vibe.
 */
function healthPercent(modules: ModuleView[]): number {
  if (modules.length === 0) return 100;
  const totalRisk = modules.reduce((sum, m) => sum + m.risk.percentAtRisk, 0);
  return Math.max(0, Math.round(100 - totalRisk / modules.length));
}

import type { WeekCapacity } from "../../shared/capacity";
import { CURRENT_TERM } from "../../shared/term-config";
import { dateRangeForWeek, formatRange } from "../../shared/term-week";

/**
 * The 12-week overload horizon.
 *
 * Two signals stacked in one strip: bar height is assessment weight landing
 * that week, and the outline marks weeks where committed work exceeds free
 * time. Seeing week 12 from week 4 is the whole argument for this app.
 */
export function OverloadHorizon({
  horizon,
  currentWeek,
}: {
  horizon: WeekCapacity[];
  currentWeek: number | null;
}) {
  const peak = Math.max(1, ...horizon.map((w) => w.assessmentWeight));

  return (
    <div>
      <div className="flex items-end gap-[3px]">
        {horizon.map((week) => {
          const isNow = week.week === currentWeek;
          const share = week.assessmentWeight / peak;
          const height = Math.max(4, Math.round(share * 56));

          const tooltip = [
            `Week ${week.week} · ${formatRange(dateRangeForWeek(week.week, CURRENT_TERM))}`,
            week.assessments.length
              ? `${Math.round(week.assessmentWeight)}% of assessment weight due:\n· ${week.assessments.join("\n· ")}`
              : "No assessments due",
            `Free time: ${week.freeHours.toFixed(0)}h · committed work: ${week.committedHours.toFixed(1)}h`,
          ].join("\n");

          return (
            <div
              key={week.week}
              className="flex flex-1 flex-col items-center justify-end"
              title={tooltip}
            >
              <div className="flex h-[56px] w-full items-end">
                <div
                  className="w-full rounded-sm"
                  style={{
                    height,
                    background: week.overloaded
                      ? "#e11d48"
                      : `color-mix(in srgb, var(--color-accent) ${Math.round(25 + share * 65)}%, var(--color-surface))`,
                    outline: isNow ? "2px solid var(--color-accent)" : "none",
                    outlineOffset: 1,
                  }}
                />
              </div>
              <div
                className={`mt-1.5 text-[10px] ${
                  isNow
                    ? "font-bold text-[var(--color-accent)]"
                    : "text-[var(--color-muted)]"
                }`}
              >
                {week.week}
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        Assessment weight by teaching week — taller means more of your grade
        lands there. Hover a week for what is due.
      </p>

      {/* Name the crunch weeks in words, not just as taller bars. */}
      <CrunchSummary horizon={horizon} currentWeek={currentWeek} />
    </div>
  );
}

function CrunchSummary({
  horizon,
  currentWeek,
}: {
  horizon: WeekCapacity[];
  currentWeek: number | null;
}) {
  const ahead = horizon.filter(
    (w) => currentWeek == null || w.week >= currentWeek,
  );
  const worst = [...ahead]
    .sort((a, b) => b.assessmentWeight - a.assessmentWeight)
    .slice(0, 2)
    .filter((w) => w.assessmentWeight > 0);

  if (worst.length === 0) return null;

  return (
    <ul className="mt-2 space-y-1">
      {worst.map((week) => (
        <li
          key={week.week}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[11px] leading-relaxed"
        >
          <strong className="text-[var(--color-fg)]">
            Week {week.week} — {Math.round(week.assessmentWeight)}% of
            assessment weight
          </strong>
          <span className="text-[var(--color-muted)]">
            {" "}
            · {week.assessments.join(" · ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

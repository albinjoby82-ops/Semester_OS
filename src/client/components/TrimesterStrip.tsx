import { CURRENT_TERM } from "../../shared/term-config";
import {
  allTeachingWeeks,
  dateRangeForWeek,
  formatRange,
} from "../../shared/term-week";
import type { ModuleView } from "../lib/api";

/**
 * The 12-week trimester strip: where you are, and where the crunch is.
 *
 * Height encodes how much assessment weight falls in each week, so the pile-up
 * in the back half is visible from week one rather than discovered in week ten.
 */
export function TrimesterStrip({
  currentWeek,
  modules,
}: {
  currentWeek: number | null;
  modules: ModuleView[];
}) {
  const weeks = allTeachingWeeks(CURRENT_TERM);

  const loadByWeek = new Map<number, number>();
  const itemsByWeek = new Map<number, string[]>();

  for (const module of modules) {
    for (const assessment of module.assessments) {
      if (assessment.dueWeek == null) continue;
      const last = assessment.dueWeekEnd ?? assessment.dueWeek;
      const span = last - assessment.dueWeek + 1;
      // Spread a window's weight across the weeks it covers rather than
      // spiking the first one -- "Weeks 3-5" is not all due in week 3.
      const perWeek = assessment.weightPercent / span;
      for (let week = assessment.dueWeek; week <= last; week += 1) {
        loadByWeek.set(week, (loadByWeek.get(week) ?? 0) + perWeek);
        itemsByWeek.set(week, [
          ...(itemsByWeek.get(week) ?? []),
          `${module.code} ${assessment.title} (${assessment.weightPercent}%)`,
        ]);
      }
    }
  }

  const peak = Math.max(1, ...loadByWeek.values());

  return (
    <div>
      <div className="flex items-end gap-[3px]">
        {weeks.map((week) => {
          const load = loadByWeek.get(week) ?? 0;
          const items = itemsByWeek.get(week) ?? [];
          const isNow = week === currentWeek;
          const intensity = load / peak;

          return (
            <div key={week} className="flex flex-1 flex-col items-center">
              <div
                className="w-full rounded-sm border transition-colors"
                style={{
                  height: 44,
                  borderColor: isNow
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                  borderWidth: isNow ? 2 : 1,
                  background: `color-mix(in srgb, var(--color-accent) ${Math.round(intensity * 55)}%, var(--color-surface))`,
                }}
                title={
                  `Week ${week} · ${formatRange(dateRangeForWeek(week, CURRENT_TERM))}` +
                  (items.length
                    ? `\n${Math.round(load)}% of assessment weight due:\n· ${items.join("\n· ")}`
                    : "\nNo assessments due")
                }
              />
              <div
                className={`mt-1 text-[10px] ${
                  isNow
                    ? "font-bold text-[var(--color-accent)]"
                    : "text-[var(--color-muted)]"
                }`}
              >
                {week}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-[var(--color-muted)]">
        Assessment weight by teaching week — darker means more of your grade
        lands there. Hover a week for what is due.
      </p>
    </div>
  );
}

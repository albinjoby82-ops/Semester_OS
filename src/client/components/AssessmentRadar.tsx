import type { WireRadarItem } from "../lib/wire";
import { colorFor } from "../lib/format";

/**
 * The assessment radar.
 *
 * Overdue work stays at the top rather than falling off the front of the
 * list — assessed work must be impossible to forget.
 */
export function AssessmentRadar({
  items,
  compact,
  onOpenModule,
}: {
  items: WireRadarItem[];
  compact?: boolean;
  onOpenModule: (code: string) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--color-border)] px-4 py-5 text-center text-sm text-[var(--color-muted)]">
        Nothing assessed due in this window.
      </p>
    );
  }

  const shown = compact ? items.slice(0, 5) : items;

  return (
    <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      {shown.map((item) => (
        <li
          key={item.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5"
        >
          <span className="w-16 shrink-0 text-xs text-[var(--color-muted)]">
            {formatWhen(item)}
          </span>

          <button
            onClick={() => onOpenModule(item.moduleCode)}
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]"
            style={{
              color: colorFor(item.colorToken),
              background: `color-mix(in srgb, ${colorFor(item.colorToken)} 14%, transparent)`,
            }}
          >
            {item.moduleCode}
          </button>

          <span className="min-w-0 flex-1 text-sm">{item.title}</span>

          <span className="shrink-0 font-mono text-xs">
            {item.weightPercent}%
          </span>

          {item.isWindowOnly && (
            <span
              className="shrink-0 text-[10px] text-[var(--color-muted)]"
              title="UCD publishes a week window, not a date. Pin the real deadline on the module page."
            >
              window
            </span>
          )}

          {item.risk.level !== "none" && (
            <span
              className="shrink-0 text-xs"
              style={{
                color: item.risk.level === "at-risk" ? "#fb7185" : "#fcd34d",
              }}
              title={item.risk.reason}
            >
              {item.risk.level === "at-risk" ? "▲ at risk" : "● watch"}
            </span>
          )}
        </li>
      ))}

      {compact && items.length > shown.length && (
        <li className="px-4 py-2 text-xs text-[var(--color-muted)]">
          + {items.length - shown.length} more
        </li>
      )}
    </ul>
  );
}

function formatWhen(item: WireRadarItem): string {
  if (!item.due) return "End term";
  if (item.daysAway == null) return "";
  if (item.daysAway < 0) return `${Math.abs(item.daysAway)}d late`;
  if (item.daysAway === 0) return "Today";
  if (item.daysAway === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
  }).format(new Date(item.due));
}

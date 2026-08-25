import { useState } from "react";
import type { Area, WeekView } from "../lib/api";
import { colorFor, formatHours } from "../lib/format";

/**
 * This week's capacity and drift.
 *
 * The allocation is the user's own, set here. Everything below it is measured
 * against that number rather than a rule the app invented, which is what keeps
 * this factual instead of preachy.
 */
export function WeekPanel({
  week,
  areas,
  onSaveAllocations,
}: {
  week: WeekView;
  areas: Area[];
  onSaveAllocations: (
    allocations: { areaId: string; plannedHours: number }[],
  ) => void;
}) {
  const [editing, setEditing] = useState(false);
  const { capacity, drift, trailing } = week;

  const plannedFor = (areaId: string) =>
    week.allocations.find((a) => a.areaId === areaId)?.plannedHours ?? 0;

  const hasAllocation = week.allocations.some((a) => a.plannedHours > 0);

  return (
    <section className="my-7 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          This week
          {week.currentWeek ? ` · Week ${week.currentWeek}` : ""}
        </h2>
        <button
          onClick={() => setEditing((value) => !value)}
          className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          {editing ? "Cancel" : hasAllocation ? "Edit allocation" : "Plan week"}
        </button>
      </div>

      {capacity ? (
        <>
          <p className="text-sm">
            <strong>{formatHours(capacity.committedHours)}</strong> of committed
            work against{" "}
            <strong>{formatHours(capacity.freeHours)}</strong> free — after{" "}
            {formatHours(capacity.fixedHours)} of timetabled commitments.
          </p>

          <CapacityBar week={week} areas={areas} />

          {capacity.overloaded && (
            <p className="mt-2 rounded border border-rose-800/60 bg-rose-950/30 px-2.5 py-1.5 text-xs text-rose-200">
              This week is at ~{Math.round(capacity.utilisation * 100)}% of
              realistic capacity. Not blocked — but something will have to give.
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-[var(--color-muted)]">
          Outside teaching weeks — capacity resumes when term starts.
        </p>
      )}

      {/* Drift, stated as facts with no lecture attached. */}
      {drift.message && (
        <p className="mt-3 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 text-xs leading-relaxed">
          {drift.message}
          {week.actualsSource === "estimated" && (
            <span className="text-[var(--color-muted)]">
              {" "}
              (from estimates on completed work — real figures once Focus mode
              tracks sessions)
            </span>
          )}
        </p>
      )}

      {trailing.message && (
        <p className="mt-2 rounded border border-amber-800/50 bg-amber-950/25 px-2.5 py-2 text-xs leading-relaxed text-amber-200">
          {trailing.message}
        </p>
      )}

      {editing && (
        <AllocationEditor
          areas={areas}
          plannedFor={plannedFor}
          onSave={(allocations) => {
            onSaveAllocations(allocations);
            setEditing(false);
          }}
        />
      )}

      {!hasAllocation && !editing && (
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          No allocation set for this week. Plan one and drift gets measured
          against your own numbers.
        </p>
      )}
    </section>
  );
}

function CapacityBar({ week, areas }: { week: WeekView; areas: Area[] }) {
  const capacity = week.capacity;
  if (!capacity || capacity.freeHours <= 0) return null;

  const areaById = new Map(areas.map((a) => [a.id, a]));

  return (
    <div className="mt-3">
      <div className="flex h-3 overflow-hidden rounded bg-[var(--color-bg)]">
        {capacity.byArea.map((entry) => {
          const area = areaById.get(entry.areaId);
          const share = Math.min(1, entry.hours / capacity.freeHours) * 100;
          return (
            <div
              key={entry.areaId}
              title={`${area?.name ?? entry.areaId}: ${formatHours(entry.hours)}`}
              style={{
                width: `${share}%`,
                background: colorFor(area?.colorToken),
              }}
            />
          );
        })}
      </div>

      {/* Legend carries the numbers, so the bar is never the only signal. */}
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--color-muted)]">
        {capacity.byArea.map((entry) => {
          const area = areaById.get(entry.areaId);
          const drift = week.drift.byArea.find((a) => a.areaId === entry.areaId);
          return (
            <li key={entry.areaId} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2 rounded-full"
                style={{ background: colorFor(area?.colorToken) }}
              />
              {area?.name ?? entry.areaId} {formatHours(entry.hours)}
              {drift && drift.plannedHours > 0 && (
                <span>/ {formatHours(drift.plannedHours)} planned</span>
              )}
            </li>
          );
        })}
        {capacity.byArea.length === 0 && (
          <li>No estimated work scheduled this week yet.</li>
        )}
      </ul>
    </div>
  );
}

function AllocationEditor({
  areas,
  plannedFor,
  onSave,
}: {
  areas: Area[];
  plannedFor: (areaId: string) => number;
  onSave: (allocations: { areaId: string; plannedHours: number }[]) => void;
}) {
  return (
    <form
      className="mt-4 border-t border-[var(--color-border)] pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSave(
          areas.map((area) => ({
            areaId: area.id,
            plannedHours: Number(data.get(area.id) ?? 0),
          })),
        );
      }}
    >
      <p className="mb-2 text-xs text-[var(--color-muted)]">
        How many hours do you intend to give each area this week? Drift is
        measured against these, not against anything the app decides.
      </p>
      <div className="flex flex-wrap gap-3">
        {areas.map((area) => (
          <label key={area.id} className="text-xs">
            <span className="mr-1.5" style={{ color: colorFor(area.colorToken) }}>
              {area.name}
            </span>
            <input
              name={area.id}
              type="number"
              min={0}
              step={0.5}
              defaultValue={plannedFor(area.id)}
              className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
            />
            <span className="ml-1 text-[var(--color-muted)]">h</span>
          </label>
        ))}
      </div>
      <button className="mt-3 rounded border border-[var(--color-accent)] px-3 py-1 text-xs">
        Save allocation
      </button>
    </form>
  );
}

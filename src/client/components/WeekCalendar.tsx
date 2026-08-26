import { useMemo, useState } from "react";
import {
  DEFAULT_GRID,
  buildWeekPlan,
  formatMinuteOfDay,
  formatMinutes,
  weekTotals,
  type FreeSlot,
  type GridBlock,
} from "../../shared/week-grid";
import type { CalendarEventRow, ModuleView, Task } from "../lib/api";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The Monday of the week containing `date`, at local midnight.
 *
 * Monday-first because the teaching week is, and a grid that disagreed with
 * the week numbers everywhere else would be its own bug.
 */
export function startOfWeek(date: Date): Date {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  // getDay() is Sunday-first; shift so Monday is 0.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

/**
 * Place an instant on the grid, in the viewer's own timezone.
 *
 * Everything is stored as UTC ISO. Reading the local day and minute here --
 * in the browser -- is what keeps a 09:00 lecture at 09:00 rather than an
 * hour off through the summer.
 */
function toGridPosition(
  iso: string,
  weekStart: Date,
): { dayIndex: number; minute: number } | null {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;

  const midnight = new Date(when);
  midnight.setHours(0, 0, 0, 0);

  const dayIndex = Math.round(
    (midnight.getTime() - weekStart.getTime()) / 86_400_000,
  );
  return {
    dayIndex,
    minute: when.getHours() * 60 + when.getMinutes(),
  };
}

/** An instant from a day of this week and a local minute of that day. */
function toIso(weekStart: Date, dayIndex: number, minute: number): string {
  const when = new Date(weekStart);
  when.setDate(when.getDate() + dayIndex);
  when.setHours(0, minute, 0, 0);
  return when.toISOString();
}

function buildBlocks(
  events: CalendarEventRow[],
  tasks: Task[],
  weekStart: Date,
  moduleCodeById: Map<string, string>,
): GridBlock[] {
  const blocks: GridBlock[] = [];

  for (const event of events) {
    // All-day events describe a date, not a span of the day. Drawing one as a
    // fourteen-hour block would swallow the entire column and report the day
    // as full when it is not.
    if (event.isAllDay) continue;

    const start = toGridPosition(event.startAt, weekStart);
    const end = toGridPosition(event.endAt, weekStart);
    if (!start || !end) continue;
    if (start.dayIndex < 0 || start.dayIndex > 6) continue;

    blocks.push({
      id: event.id,
      dayIndex: start.dayIndex,
      startMinute: start.minute,
      // An event running past midnight is clipped to its first day rather
      // than wrapping into the next column.
      endMinute:
        end.dayIndex === start.dayIndex ? end.minute : DEFAULT_GRID.dayEndMinute,
      kind: "event",
      title: event.title,
      moduleCode: event.moduleId
        ? (moduleCodeById.get(event.moduleId) ?? null)
        : null,
    });
  }

  for (const task of tasks) {
    if (!task.scheduledStartAt || !task.scheduledEndAt) continue;

    const start = toGridPosition(task.scheduledStartAt, weekStart);
    const end = toGridPosition(task.scheduledEndAt, weekStart);
    if (!start || !end) continue;
    if (start.dayIndex < 0 || start.dayIndex > 6) continue;

    blocks.push({
      id: task.id,
      dayIndex: start.dayIndex,
      startMinute: start.minute,
      endMinute:
        end.dayIndex === start.dayIndex ? end.minute : DEFAULT_GRID.dayEndMinute,
      kind: "task",
      title: task.title,
      moduleCode: task.moduleId
        ? (moduleCodeById.get(task.moduleId) ?? null)
        : null,
    });
  }

  return blocks;
}

/** Default length for a task carrying no estimate. */
const DEFAULT_TASK_MINUTES = 60;

/**
 * The week at a glance, and somewhere to put the work.
 *
 * Capacity already says how many hours are free; this says where they are.
 * The two numbers are the same, but only one of them lets you decide that
 * Thursday morning is where the lab report goes.
 *
 * Booking a task writes a real start and end, so it becomes a commitment the
 * grid itself counts -- scheduling two things into one gap is not possible
 * because the first one closes it.
 */
export function WeekCalendar({
  events,
  tasks,
  modules,
  onSchedule,
  onUnschedule,
}: {
  events: CalendarEventRow[];
  tasks: Task[];
  modules: ModuleView[];
  onSchedule: (taskId: string, startAt: string, endAt: string) => void;
  onUnschedule: (taskId: string) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [picking, setPicking] = useState<FreeSlot | null>(null);

  const weekStart = useMemo(() => {
    const base = startOfWeek(new Date());
    base.setDate(base.getDate() + weekOffset * 7);
    return base;
  }, [weekOffset]);

  const moduleCodeById = useMemo(
    () => new Map(modules.map((m) => [m.id, m.code])),
    [modules],
  );

  const plan = useMemo(
    () => buildWeekPlan(buildBlocks(events, tasks, weekStart, moduleCodeById)),
    [events, tasks, weekStart, moduleCodeById],
  );

  const totals = useMemo(() => weekTotals(plan), [plan]);

  /** Unscheduled, still-open work — the only things worth offering a slot. */
  const schedulable = useMemo(
    () =>
      tasks.filter(
        (t) =>
          !t.scheduledStartAt &&
          (t.status === "todo" || t.status === "in_progress"),
      ),
    [tasks],
  );

  const { dayStartMinute, dayEndMinute } = DEFAULT_GRID;
  const windowMinutes = dayEndMinute - dayStartMinute;
  const offsetPercent = (minute: number) =>
    ((Math.max(minute, dayStartMinute) - dayStartMinute) / windowMinutes) * 100;
  const heightPercent = (start: number, end: number) =>
    ((Math.min(end, dayEndMinute) - Math.max(start, dayStartMinute)) /
      windowMinutes) *
    100;

  const today = new Date();
  const todayIndex =
    startOfWeek(today).getTime() === weekStart.getTime()
      ? (today.getDay() + 6) % 7
      : -1;

  const dayDate = (dayIndex: number) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + dayIndex);
    return d;
  };

  const hourMarks: number[] = [];
  for (let m = dayStartMinute; m <= dayEndMinute; m += 120) hourMarks.push(m);

  const scheduleInto = (slot: FreeSlot, task: Task) => {
    const minutes = Math.min(
      task.estimatedMinutes ?? DEFAULT_TASK_MINUTES,
      slot.minutes,
    );
    onSchedule(
      task.id,
      toIso(weekStart, slot.dayIndex, slot.startMinute),
      toIso(weekStart, slot.dayIndex, slot.startMinute + minutes),
    );
    setPicking(null);
  };

  return (
    <section className="week-calendar">
      <div className="wc-head">
        <div>
          <p className="wc-kicker">Your week</p>
          <h2>
            {weekOffset === 0
              ? "This week"
              : weekOffset === 1
                ? "Next week"
                : weekOffset === -1
                  ? "Last week"
                  : dayDate(0).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                    })}
          </h2>
        </div>
        <div className="wc-nav">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label="Previous week"
          >
            ‹
          </button>
          {weekOffset !== 0 && (
            <button type="button" onClick={() => setWeekOffset(0)}>
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label="Next week"
          >
            ›
          </button>
        </div>
      </div>

      <p className="wc-summary">
        <strong>{formatMinutes(totals.busyMinutes)}</strong> committed across{" "}
        {totals.daysWithCommitments} day
        {totals.daysWithCommitments === 1 ? "" : "s"} ·{" "}
        <strong>{formatMinutes(totals.freeMinutes)}</strong> open between{" "}
        {formatMinuteOfDay(dayStartMinute)} and{" "}
        {formatMinuteOfDay(dayEndMinute)}. Open time is only counted in gaps of{" "}
        {DEFAULT_GRID.minSlotMinutes} minutes or more.
      </p>

      <div className="wc-scroll">
        <div className="wc-grid">
          <div className="wc-hours" aria-hidden="true">
            {hourMarks.map((m) => (
              <span key={m} style={{ top: `${offsetPercent(m)}%` }}>
                {formatMinuteOfDay(m)}
              </span>
            ))}
          </div>

          {plan.map((day) => (
            <div
              key={day.dayIndex}
              className={`wc-day${day.dayIndex === todayIndex ? " is-today" : ""}`}
            >
              <div className="wc-day-head">
                <span className="wc-day-name">{DAY_NAMES[day.dayIndex]}</span>
                <span className="wc-day-num">{dayDate(day.dayIndex).getDate()}</span>
                <span className="wc-day-busy">
                  {day.busyMinutes > 0 ? formatMinutes(day.busyMinutes) : "free"}
                </span>
              </div>

              <div className="wc-column">
                {hourMarks.map((m) => (
                  <div
                    key={m}
                    className="wc-rule"
                    style={{ top: `${offsetPercent(m)}%` }}
                    aria-hidden="true"
                  />
                ))}

                {day.free.map((slot) => (
                  <button
                    key={`free-${slot.startMinute}`}
                    type="button"
                    className="wc-slot"
                    style={{
                      top: `${offsetPercent(slot.startMinute)}%`,
                      height: `${heightPercent(slot.startMinute, slot.endMinute)}%`,
                    }}
                    onClick={() => setPicking(slot)}
                    disabled={schedulable.length === 0}
                    title={
                      schedulable.length === 0
                        ? "Nothing unscheduled to slot in"
                        : `Free ${formatMinuteOfDay(slot.startMinute)}–${formatMinuteOfDay(slot.endMinute)}`
                    }
                  >
                    <span className="wc-slot-label">
                      {formatMinutes(slot.minutes)} free
                    </span>
                  </button>
                ))}

                {day.blocks.map((block) => (
                  <div
                    key={`${block.kind}-${block.id}`}
                    className={`wc-block is-${block.kind}`}
                    style={{
                      top: `${offsetPercent(block.startMinute)}%`,
                      height: `${heightPercent(block.startMinute, block.endMinute)}%`,
                    }}
                  >
                    <span className="wc-block-time">
                      {formatMinuteOfDay(block.startMinute)}
                    </span>
                    <span className="wc-block-title">
                      {block.moduleCode ? `${block.moduleCode} · ` : ""}
                      {block.title}
                    </span>
                    {block.kind === "task" && (
                      <button
                        type="button"
                        className="wc-unbook"
                        onClick={() => onUnschedule(block.id)}
                        aria-label={`Unschedule ${block.title}`}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {picking && (
        <div className="wc-picker" role="dialog" aria-label="Slot in a task">
          <div className="wc-picker-head">
            <p>
              <strong>
                {DAY_NAMES[picking.dayIndex]}{" "}
                {formatMinuteOfDay(picking.startMinute)}–
                {formatMinuteOfDay(picking.endMinute)}
              </strong>{" "}
              · {formatMinutes(picking.minutes)} free
            </p>
            <button type="button" onClick={() => setPicking(null)}>
              Cancel
            </button>
          </div>

          <ul className="wc-picker-list">
            {schedulable.map((task) => {
              const needs = task.estimatedMinutes ?? DEFAULT_TASK_MINUTES;
              const tight = needs > picking.minutes;
              return (
                <li key={task.id}>
                  <button type="button" onClick={() => scheduleInto(picking, task)}>
                    <span className="wc-pick-title">{task.title}</span>
                    <span className="wc-pick-meta">
                      {task.estimatedMinutes
                        ? formatMinutes(task.estimatedMinutes)
                        : "no estimate"}
                      {tight && (
                        <em>
                          {" "}
                          — only {formatMinutes(picking.minutes)} here, it will
                          be cut short
                        </em>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {events.length === 0 && (
        <p className="wc-empty">
          No timetable yet. Import a calendar in Settings and your week fills in
          here.
        </p>
      )}
    </section>
  );
}

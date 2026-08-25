/**
 * Display helpers.
 *
 * Rule: colour is never the only signal. Every status that uses colour also
 * returns a label or icon, so the UI survives a colour-blind check and a dark
 * room -- and so overdue work is never conveyed by a red dot alone.
 */

/** Module and area colours. */
export const COLOR: Record<string, string> = {
  amber: "#d97706",
  emerald: "#059669",
  sky: "#0284c7",
  rose: "#e11d48",
  violet: "#7c3aed",
  teal: "#0d9488",
  neutral: "#64748b",
};

export const colorFor = (token: string | null | undefined): string =>
  COLOR[token ?? "neutral"] ?? COLOR.neutral!;

export function formatMinutes(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/** Whole days between two dates, ignoring time of day. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  );
}

export type DueUrgency = "overdue" | "today" | "tomorrow" | "soon" | "later";

export interface DueInfo {
  urgency: DueUrgency;
  /** Always carries the meaning in words -- never colour alone. */
  label: string;
  daysAway: number;
}

export function describeDue(
  dueAt: string | null,
  now: Date = new Date(),
): DueInfo | null {
  if (!dueAt) return null;
  const days = daysBetween(now, new Date(dueAt));

  if (days < 0) {
    const overdueBy = Math.abs(days);
    return {
      urgency: "overdue",
      label: overdueBy === 1 ? "overdue 1 day" : `overdue ${overdueBy} days`,
      daysAway: days,
    };
  }
  if (days === 0) return { urgency: "today", label: "due today", daysAway: 0 };
  if (days === 1)
    return { urgency: "tomorrow", label: "due tomorrow", daysAway: 1 };
  if (days <= 7)
    return { urgency: "soon", label: `due in ${days} days`, daysAway: days };

  return {
    urgency: "later",
    label: new Intl.DateTimeFormat("en-IE", {
      day: "numeric",
      month: "short",
    }).format(new Date(dueAt)),
    daysAway: days,
  };
}

/** Colour paired with an always-present textual label. */
export const URGENCY_COLOR: Record<DueUrgency, string> = {
  overdue: "#e11d48",
  today: "#d97706",
  tomorrow: "#d97706",
  soon: "#8b98a9",
  later: "#8b98a9",
};

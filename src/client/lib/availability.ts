import type { FixedCommitment } from "./api";

/**
 * Minutes until the next fixed commitment starts.
 *
 * Deliberately computed in the browser: commitments are stored as local
 * minutes-of-day, and the Worker runs in UTC with no knowledge of the user's
 * timezone, so doing this server-side would be silently wrong by the offset.
 *
 * Returns null when nothing else is scheduled today, which the ranking treats
 * as "no constraint" rather than "no time".
 */
export function minutesUntilNextCommitment(
  commitments: readonly FixedCommitment[],
  currentWeek: number | null,
  now: Date = new Date(),
): number | null {
  // 1 = Monday .. 7 = Sunday, matching the stored dayOfWeek.
  const today = ((now.getDay() + 6) % 7) + 1;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();

  let soonest: number | null = null;

  for (const commitment of commitments) {
    if (!commitment.active) continue;
    if (commitment.dayOfWeek !== today) continue;
    if (currentWeek != null) {
      if (commitment.fromWeek != null && currentWeek < commitment.fromWeek) continue;
      if (commitment.toWeek != null && currentWeek > commitment.toWeek) continue;
    }

    // Already inside this commitment: there is no free gap right now.
    if (minuteOfDay >= commitment.startMinute && minuteOfDay < commitment.endMinute) {
      return 0;
    }
    if (commitment.startMinute <= minuteOfDay) continue;

    const gap = commitment.startMinute - minuteOfDay;
    if (soonest == null || gap < soonest) soonest = gap;
  }

  return soonest;
}

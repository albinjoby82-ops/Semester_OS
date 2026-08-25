/**
 * Lightweight parsing for quick capture: "digital lab friday 1h".
 *
 * This is a CONVENIENCE, never a dependency. Every code path returns a usable
 * title, and anything not confidently recognised is simply left in the title
 * rather than guessed at. Capture must never fail or block on parsing.
 */

export interface ParsedCapture {
  title: string;
  moduleCode: string | null;
  areaId: string | null;
  dueAt: string | null;
  estimatedMinutes: number | null;
  /** Which fragments were consumed, for showing the user what was inferred. */
  matched: string[];
}

/**
 * Module aliases. Keys are matched case-insensitively as whole words, longest
 * first, so "computer eng" wins over a bare "eng".
 */
const MODULE_ALIASES: Record<string, string[]> = {
  EEEN20020: ["eeen20020", "circuits", "circuit", "eec"],
  EEEN20050: ["eeen20050", "digital electronics", "digital"],
  EEEN20010: ["eeen20010", "computer engineering", "computer eng", "comp eng", "c programming"],
  EEEN20070: ["eeen20070", "solid state devices", "solid state", "ssd"],
  MATH20290: ["math20290", "multivariable calculus", "calculus", "maths", "math"],
  SCI20020: ["sci20020", "leadership"],
};

const AREA_ALIASES: Record<string, string[]> = {
  gaelforce: ["gaelforce", "gael force", "gf"],
  accio: ["accio"],
  personal: ["personal"],
};

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Match an alias as a whole phrase, so "math" does not fire inside "aftermath". */
const phrasePattern = (alias: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(alias)}(?![\\p{L}\\p{N}])`, "iu");

function findAlias(
  text: string,
  table: Record<string, string[]>,
): { key: string; alias: string } | null {
  const candidates = Object.entries(table)
    .flatMap(([key, aliases]) => aliases.map((alias) => ({ key, alias })))
    // Longest alias first so "solid state devices" beats "solid state".
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const candidate of candidates) {
    if (phrasePattern(candidate.alias).test(text)) return candidate;
  }
  return null;
}

/** "1h", "1.5h", "90m", "45 min", "2 hours" -> minutes. */
function findDuration(text: string): { minutes: number; match: string } | null {
  const hours = /(?<![\p{L}\p{N}])(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)(?![\p{L}])/iu.exec(text);
  if (hours?.[1]) {
    return { minutes: Math.round(Number(hours[1]) * 60), match: hours[0] };
  }
  const mins = /(?<![\p{L}\p{N}])(\d+)\s*(m|min|mins|minute|minutes)(?![\p{L}])/iu.exec(text);
  if (mins?.[1]) {
    return { minutes: Number(mins[1]), match: mins[0] };
  }
  return null;
}

const startOfDay = (date: Date): Date => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

/** Due dates are set to 23:59 local -- "Friday" means end of Friday. */
const endOfDay = (date: Date): Date => {
  const copy = startOfDay(date);
  copy.setHours(23, 59, 0, 0);
  return copy;
};

function findDate(text: string, now: Date): { date: Date; match: string } | null {
  if (phrasePattern("today").test(text)) {
    return { date: endOfDay(now), match: "today" };
  }
  if (phrasePattern("tomorrow").test(text)) {
    const d = startOfDay(now);
    d.setDate(d.getDate() + 1);
    return { date: endOfDay(d), match: "tomorrow" };
  }
  if (phrasePattern("tonight").test(text)) {
    return { date: endOfDay(now), match: "tonight" };
  }

  // "next friday" jumps a further week beyond the coming Friday.
  const nextDay = /(?<![\p{L}\p{N}])next\s+(\w+)(?![\p{L}\p{N}])/iu.exec(text);
  if (nextDay?.[1]) {
    const target = WEEKDAYS[nextDay[1].toLowerCase()];
    if (target) {
      return { date: endOfDay(nextWeekday(now, target, true)), match: nextDay[0] };
    }
  }

  for (const [name, dayNumber] of Object.entries(WEEKDAYS)) {
    if (phrasePattern(name).test(text)) {
      return { date: endOfDay(nextWeekday(now, dayNumber, false)), match: name };
    }
  }
  return null;
}

/**
 * The next occurrence of a weekday. Today counts as "this week's" occurrence
 * only when it is still today -- "friday" said on a Friday means today.
 */
function nextWeekday(now: Date, target: number, skipAWeek: boolean): Date {
  const current = ((now.getDay() + 6) % 7) + 1; // 1 = Monday
  let delta = (target - current + 7) % 7;
  if (skipAWeek) delta += 7;
  const result = startOfDay(now);
  result.setDate(result.getDate() + delta);
  return result;
}

export function parseCapture(
  raw: string,
  now: Date = new Date(),
): ParsedCapture {
  const input = raw.trim();
  const matched: string[] = [];
  let remaining = input;

  const consume = (fragment: string) => {
    matched.push(fragment);
    remaining = remaining.replace(phrasePattern(fragment), " ");
  };

  const moduleHit = findAlias(remaining, MODULE_ALIASES);
  if (moduleHit) consume(moduleHit.alias);

  // A module implies university, so only look for an area otherwise.
  const areaHit = moduleHit ? null : findAlias(remaining, AREA_ALIASES);
  if (areaHit) consume(areaHit.alias);

  const duration = findDuration(remaining);
  if (duration) {
    matched.push(duration.match);
    remaining = remaining.replace(duration.match, " ");
  }

  const date = findDate(remaining, now);
  if (date) consume(date.match);

  // Tidy leftover separators without touching the words themselves.
  const title = remaining
    .replace(/\s*(?:^|\s)(?:on|by|at|due)(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:-]+|[\s,;:-]+$/g, "")
    .trim();

  return {
    // Never return an empty title: fall back to what the user actually typed.
    title: title || input,
    moduleCode: moduleHit?.key ?? null,
    areaId: moduleHit ? "university" : (areaHit?.key ?? null),
    dueAt: date ? date.date.toISOString() : null,
    estimatedMinutes: duration?.minutes ?? null,
    matched,
  };
}

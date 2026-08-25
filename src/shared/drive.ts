/**
 * Google Drive reasoning.
 *
 * Drive is the source of truth for FILES (brief section 16). Nothing is
 * uploaded or duplicated into this app — module folders are mapped, their
 * contents indexed, and files opened in Drive.
 *
 * Pure classification only; fetching lives in the server route.
 */

export type ResourceType =
  | "slide"
  | "notes"
  | "lab"
  | "assignment"
  | "formula_sheet"
  | "reading"
  | "other";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  modifiedTime?: string;
  parents?: string[];
}

export interface IndexedResource {
  googleDriveFileId: string;
  title: string;
  type: ResourceType;
  weekNumber: number | null;
  url: string | null;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

/**
 * Type inferred from the folder path first, then the filename.
 *
 * The recommended folder layout (Slides/, Labs/, Assignments/, Notes/) is a
 * far stronger signal than a filename, so a file inside Labs/ is a lab even
 * if it is called "week3.pdf".
 */
const PATH_RULES: [RegExp, ResourceType][] = [
  [/\bslides?\b|\blectures?\b/i, "slide"],
  [/\blabs?\b|\bpractical/i, "lab"],
  [/\bassignments?\b|\bhomework\b|\bcoursework\b/i, "assignment"],
  [/\bnotes?\b/i, "notes"],
  [/\breadings?\b|\bpapers?\b|\btextbooks?\b/i, "reading"],
  [/\bformula\b|\bcheat.?sheet\b/i, "formula_sheet"],
];

const NAME_RULES: [RegExp, ResourceType][] = [
  [/\bformula\b|\bcheat.?sheet\b/i, "formula_sheet"],
  [/\blab\b|\bpractical\b/i, "lab"],
  [/\bassignment\b|\bhomework\b|\bhw\d|\bcoursework\b|\bproblem.?sheet\b/i, "assignment"],
  [/\bslides?\b|\blecture\b|\bdeck\b/i, "slide"],
  [/\bnotes?\b/i, "notes"],
  [/\breading\b|\bpaper\b|\bchapter\b/i, "reading"],
];

export function classifyResource(
  fileName: string,
  folderPath = "",
): ResourceType {
  for (const [pattern, type] of PATH_RULES) {
    if (pattern.test(folderPath)) return type;
  }
  for (const [pattern, type] of NAME_RULES) {
    if (pattern.test(fileName)) return type;
  }
  return "other";
}

/**
 * Week number from a filename or folder path.
 *
 * Matches "week 3", "wk3", "w03". Deliberately does NOT treat a bare number
 * as a week — "Lab 2" is lab two, not week two, and guessing would file it
 * against the wrong week.
 */
export function extractWeekNumber(text: string): number | null {
  const match = /\b(?:week|wk|w)\s*[-_ ]?0*(\d{1,2})\b/i.exec(text);
  if (!match?.[1]) return null;
  const week = Number(match[1]);
  return week >= 1 && week <= 52 ? week : null;
}

/** Index a Drive file into a resource row. */
export function indexFile(
  file: DriveFile,
  folderPath = "",
): IndexedResource | null {
  if (file.mimeType === FOLDER_MIME) return null;

  return {
    googleDriveFileId: file.id,
    title: file.name,
    type: classifyResource(file.name, folderPath),
    // Filename wins over folder: "Week 3 slides.pdf" inside a Slides/ folder
    // is about week 3, not about whatever week the folder is named for.
    weekNumber: extractWeekNumber(file.name) ?? extractWeekNumber(folderPath),
    url: file.webViewLink ?? null,
  };
}

/** Group indexed resources by type, in the brief's display order. */
export const TYPE_ORDER: ResourceType[] = [
  "slide",
  "notes",
  "lab",
  "assignment",
  "reading",
  "formula_sheet",
  "other",
];

export function groupByType(
  resources: readonly IndexedResource[],
): { type: ResourceType; items: IndexedResource[] }[] {
  const groups = new Map<ResourceType, IndexedResource[]>();
  for (const resource of resources) {
    groups.set(resource.type, [...(groups.get(resource.type) ?? []), resource]);
  }
  return TYPE_ORDER.filter((type) => groups.has(type)).map((type) => ({
    type,
    items: (groups.get(type) ?? []).sort((a, b) =>
      a.title.localeCompare(b.title),
    ),
  }));
}

/** Group by week, with undated files last. */
export function groupByWeek(
  resources: readonly IndexedResource[],
): { weekNumber: number | null; items: IndexedResource[] }[] {
  const groups = new Map<number | null, IndexedResource[]>();
  for (const resource of resources) {
    const key = resource.weekNumber;
    groups.set(key, [...(groups.get(key) ?? []), resource]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a == null) return 1;
      if (b == null) return -1;
      return a - b;
    })
    .map(([weekNumber, items]) => ({ weekNumber, items }));
}

/** Escape a value for a Drive API query string. */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

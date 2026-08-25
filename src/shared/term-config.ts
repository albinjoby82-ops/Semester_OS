import type { TermConfig } from "./term-week";

/**
 * UCD Autumn 2026 trimester.
 *
 * !! UNCONFIRMED -- these dates are placeholders. !!
 *
 * The term start date and the study/review week have NOT been verified against
 * UCD's published academic calendar. Every week number in the app derives from
 * them, so confirm both before relying on any debt, capacity or assessment-week
 * figure. Nothing else in the codebase hardcodes term dates: correcting this
 * single object corrects the whole app.
 */
export const AUTUMN_2026: TermConfig = {
  id: "autumn-2026",
  label: "Autumn 2026",
  startDate: "2026-09-07",
  teachingWeeks: 12,
  breakAfterWeeks: [],
};

/** The term the app is currently operating in. */
export const CURRENT_TERM = AUTUMN_2026;

/** True while the placeholder dates above are still unverified. */
export const TERM_DATES_UNCONFIRMED = true;

import type { StageKey } from "../../shared/radar";

/**
 * The database stores timestamps per stage; the API takes booleans. This is
 * the single place that mapping lives, so the two cannot drift apart.
 */
export const STAGE_FIELD: Record<StageKey, string> = {
  readBriefAt: "readBrief",
  startedAt: "started",
  mainWorkDoneAt: "mainWorkDone",
  checkedAt: "checked",
  isSubmitted: "submitted",
  submissionVerifiedAt: "submissionVerified",
};

import type { Assessment } from "../lib/api";
import { stageProgress, stageStates, type StageKey } from "../../shared/radar";

/**
 * The six-stage checklist.
 *
 * The rule this exists to enforce: an assessment is not closed until it is
 * submitted, and submission is a separate deliberate act from finishing the
 * work. Verification is a further step again, because "I thought I'd
 * submitted it" is the classic way marks disappear.
 */
export function SubmissionChecklist({
  assessment,
  onToggle,
}: {
  assessment: Assessment;
  onToggle: (key: StageKey, next: boolean) => void;
}) {
  const states = stageStates(assessment);
  const progress = stageProgress(states);
  const workDone = states[3]?.done ?? false;
  const submitted = assessment.isSubmitted;

  return (
    <div>
      <div
        className="mb-2 h-1 overflow-hidden rounded-full bg-[var(--color-bg)]"
        role="img"
        aria-label={`${states.filter((s) => s.done).length} of ${states.length} stages complete`}
      >
        <div
          className="h-full bg-[var(--color-accent)]"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      <ul className="flex flex-wrap gap-x-3 gap-y-1.5">
        {states.map((stage) => (
          <li key={stage.key}>
            <button
              onClick={() => onToggle(stage.key, !stage.done)}
              className="flex items-center gap-1.5 text-[11px]"
              aria-pressed={stage.done}
            >
              <span
                className="flex size-[14px] items-center justify-center rounded-[3px] border text-[9px] leading-none"
                style={{
                  borderColor: stage.done
                    ? "var(--color-accent)"
                    : "var(--color-border)",
                  background: stage.done ? "var(--color-accent)" : "transparent",
                }}
              >
                {stage.done ? "✓" : ""}
              </span>
              <span
                className={
                  stage.done
                    ? "text-[var(--color-fg)]"
                    : "text-[var(--color-muted)]"
                }
              >
                {stage.label}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* The one state that must never pass unnoticed. */}
      {workDone && !submitted && (
        <p className="mt-2 rounded border border-amber-700/60 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
          The work is finished but this has not been submitted. It stays open
          until it is.
        </p>
      )}

      {submitted && !assessment.submissionVerifiedAt && (
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">
          Marked submitted — verify it actually landed to close this out.
        </p>
      )}
    </div>
  );
}

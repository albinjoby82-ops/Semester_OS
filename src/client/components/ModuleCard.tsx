import {
  describeRequiredMark,
  requiredMarkForTarget,
} from "../../shared/grades";
import type { ModuleView } from "../lib/api";
import { colorFor } from "../lib/format";

const PROFILE_LABEL: Record<ModuleView["assessmentProfile"], string> = {
  exam_heavy: "Exam-heavy",
  continuous: "Continuous",
  portfolio: "Portfolio",
};

/** Default target used for the required-mark line until targets are editable. */
const TARGET = 60;

export function ModuleCard({ module }: { module: ModuleView }) {
  const color = colorFor(module.colorToken);
  const g = module.gradeSummary;

  // The single heaviest assessment: for MATH20290 that is 85% on one exam,
  // which is the risk the module page has to lead with.
  const heaviest = module.assessments.reduce<ModuleView["assessments"][number] | null>(
    (max, a) => (!max || a.weightPercent > max.weightPercent ? a : max),
    null,
  );

  const required =
    g.gradedCount > 0 ? requiredMarkForTarget(g, TARGET) : null;

  return (
    <article className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-mono text-sm font-semibold" style={{ color }}>
          {module.code}
        </h3>
        <span className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
          {PROFILE_LABEL[module.assessmentProfile]}
        </span>
      </div>

      <p className="mt-0.5 text-sm leading-snug">{module.name}</p>

      {/* Earned progress only: banked grade vs what is still at stake. */}
      <div
        className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-[var(--color-bg)]"
        role="img"
        aria-label={`${g.bankedPoints.toFixed(1)} percent of the final grade banked, ${g.atStakeWeight} percent still at stake`}
      >
        <div
          className="h-full"
          style={{ width: `${g.bankedPoints}%`, background: color }}
        />
        <div
          className="h-full"
          style={{
            width: `${g.bankedWeight - g.bankedPoints}%`,
            background: "color-mix(in srgb, #e11d48 55%, transparent)",
          }}
        />
      </div>

      <p className="mt-1.5 text-xs text-[var(--color-muted)]">
        {g.gradedCount === 0 ? (
          <>
            No results yet · {module.assessments.length} assessments · 100% at
            stake
          </>
        ) : (
          <>
            <strong className="text-[var(--color-fg)]">
              {g.bankedPoints.toFixed(1)}%
            </strong>{" "}
            banked of {g.bankedWeight}% assessed · {g.atStakeWeight}% at stake
          </>
        )}
      </p>

      {required && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          {describeRequiredMark(required, TARGET)}
        </p>
      )}

      {/*
        Weight-at-risk, not a health score. "30% of this module's grade is
        behind schedule" is actionable and comparable across modules.
      */}
      {module.risk.percentAtRisk > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-rose-300">
          <span aria-hidden>▲</span>
          <span>
            <strong>
              {Math.round(module.risk.percentAtRisk)}% of this module&apos;s
              grade is behind schedule.
            </strong>{" "}
            {module.risk.headline}
          </span>
        </p>
      )}

      {module.risk.percentAtRisk === 0 && module.risk.watchWeight > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-amber-300/90">
          <span aria-hidden>●</span>
          <span>{module.risk.headline}</span>
        </p>
      )}

      {heaviest && heaviest.weightPercent >= 50 && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--color-muted)]">
          {heaviest.weightPercent}% rests on {heaviest.title.toLowerCase()} —
          weekly task completion will not tell you if you are behind here.
        </p>
      )}

      {module.attendanceMandatory && (
        <p className="mt-2 text-[11px] text-[var(--color-muted)]">
          Lecture attendance is mandatory.
        </p>
      )}
    </article>
  );
}

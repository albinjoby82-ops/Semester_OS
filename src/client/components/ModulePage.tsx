import { useState } from "react";
import type { Assessment, ModuleView } from "../lib/api";
import type { StageKey } from "../../shared/radar";
import {
  describeRequiredMark,
  requiredMarkForTarget,
  scorePercent,
} from "../../shared/grades";
import { colorFor, describeDue, formatMinutes } from "../lib/format";
import { SubmissionChecklist } from "./SubmissionChecklist";
import { ModuleResources } from "./ModuleResources";

const TARGETS = [40, 50, 60, 70];

export function ModulePage({
  module,
  onToggleStage,
  onSaveGrade,
  onClearGrade,
  onPinDate,
  googleConnected,
}: {
  module: ModuleView;
  onToggleStage: (assessmentId: string, key: StageKey, next: boolean) => void;
  onSaveGrade: (
    assessmentId: string,
    marksAwarded: number,
    marksPossible: number,
  ) => void;
  onClearGrade: (assessmentId: string) => void;
  onPinDate: (assessmentId: string, dueAt: string | null) => void;
  googleConnected: boolean;
}) {
  const [target, setTarget] = useState(60);
  const color = colorFor(module.colorToken);
  const g = module.gradeSummary;
  const required = requiredMarkForTarget(g, target);

  return (
    <div>
      <header className="mb-5">
        <h1
          className="font-mono text-lg font-semibold tracking-tight"
          style={{ color }}
        >
          {module.code}
        </h1>
        <p className="text-xl font-semibold">{module.name}</p>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          {module.coordinator ? `${module.coordinator} · ` : ""}
          {module.studentEffortHours}h stated effort
          {module.attendanceMandatory && " · attendance mandatory"}
        </p>
      </header>

      {/* Eye on the Ball: structure, status and risk in one panel. */}
      <section className="mb-6 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
          Eye on the ball
        </h2>

        <GradePosition module={module} color={color} />

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--color-muted)]">Target</span>
          {TARGETS.map((value) => (
            <button
              key={value}
              onClick={() => setTarget(value)}
              className="rounded border px-2 py-0.5"
              style={{
                borderColor:
                  value === target ? "var(--color-accent)" : "var(--color-border)",
                color:
                  value === target ? "var(--color-fg)" : "var(--color-muted)",
              }}
            >
              {value}%
            </button>
          ))}
        </div>
        <p className="mt-2 text-sm">{describeRequiredMark(required, target)}</p>

        {module.risk.percentAtRisk > 0 ? (
          <p className="mt-3 rounded border border-rose-800/60 bg-rose-950/30 px-2.5 py-2 text-xs leading-relaxed text-rose-200">
            <strong>
              {Math.round(module.risk.percentAtRisk)}% of this module&apos;s
              grade is behind schedule.
            </strong>{" "}
            {module.risk.headline}
          </p>
        ) : module.risk.headline ? (
          <p className="mt-3 rounded border border-amber-800/50 bg-amber-950/25 px-2.5 py-2 text-xs leading-relaxed text-amber-200">
            {module.risk.headline}
          </p>
        ) : (
          <p className="mt-3 text-xs text-[var(--color-muted)]">
            Nothing behind schedule in this module.
          </p>
        )}

        {module.ucdUrl && (
          <p className="mt-3">
            <a
              href={module.ucdUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-[var(--color-accent)] underline underline-offset-2"
            >
              View official UCD page
            </a>
          </p>
        )}
      </section>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
        Assessment ({module.assessments.length})
      </h2>
      <ul className="space-y-2">
        {module.assessments.map((assessment) => (
          <AssessmentRow
            key={assessment.id}
            assessment={assessment}
            risk={module.risk.risks.find((r) => r.id === assessment.id)}
            color={color}
            onToggleStage={(key, next) =>
              onToggleStage(assessment.id, key, next)
            }
            onSaveGrade={(awarded, possible) =>
              onSaveGrade(assessment.id, awarded, possible)
            }
            onClearGrade={() => onClearGrade(assessment.id)}
            onPinDate={(dueAt) => onPinDate(assessment.id, dueAt)}
          />
        ))}
      </ul>

      <h2 className="mt-6 mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
        Material
      </h2>
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <ModuleResources
          code={module.code}
          driveFolderId={module.driveFolderId}
          googleConnected={googleConnected}
        />
      </div>
    </div>
  );
}

function GradePosition({
  module,
  color,
}: {
  module: ModuleView;
  color: string;
}) {
  const g = module.gradeSummary;
  return (
    <>
      <div className="flex h-2.5 overflow-hidden rounded bg-[var(--color-bg)]">
        <div
          style={{ width: `${g.bankedPoints}%`, background: color }}
          title={`${g.bankedPoints.toFixed(1)}% banked`}
        />
        <div
          style={{
            width: `${g.bankedWeight - g.bankedPoints}%`,
            background: "color-mix(in srgb, #e11d48 55%, transparent)",
          }}
          title="Lost from assessed work"
        />
      </div>
      <p className="mt-2 text-sm">
        {g.gradedCount === 0 ? (
          <>Nothing returned yet — all {g.atStakeWeight}% is still to play for.</>
        ) : (
          <>
            <strong>{g.bankedPoints.toFixed(1)}%</strong> banked from{" "}
            {g.bankedWeight}% assessed (averaging{" "}
            {g.averageSoFar?.toFixed(0)}%) · <strong>{g.atStakeWeight}%</strong>{" "}
            still at stake · finishing range {g.floor.toFixed(0)}–
            {g.ceiling.toFixed(0)}%
          </>
        )}
      </p>
    </>
  );
}

function AssessmentRow({
  assessment,
  risk,
  color,
  onToggleStage,
  onSaveGrade,
  onClearGrade,
  onPinDate,
}: {
  assessment: Assessment;
  risk: ModuleView["risk"]["risks"][number] | undefined;
  color: string;
  onToggleStage: (key: StageKey, next: boolean) => void;
  onSaveGrade: (marksAwarded: number, marksPossible: number) => void;
  onClearGrade: () => void;
  onPinDate: (dueAt: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const due = describeDue(assessment.dueAt ?? risk?.effectiveDue ?? null);
  const grade = assessment.grade;

  const window =
    assessment.dueWeek != null
      ? assessment.dueWeekEnd && assessment.dueWeekEnd !== assessment.dueWeek
        ? `Weeks ${assessment.dueWeek}–${assessment.dueWeekEnd}`
        : `Week ${assessment.dueWeek}`
      : "End of trimester";

  return (
    <li className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left"
      >
        <span
          className="w-11 shrink-0 font-mono text-sm font-semibold"
          style={{ color }}
        >
          {assessment.weightPercent}%
        </span>
        <span className="min-w-0 flex-1 text-sm">{assessment.title}</span>

        <span className="shrink-0 text-xs text-[var(--color-muted)]">
          {window}
        </span>

        {due && (
          <span className="shrink-0 text-xs text-[var(--color-muted)]">
            {due.label}
          </span>
        )}

        {grade ? (
          <span className="shrink-0 text-xs text-emerald-400">
            {scorePercent(grade).toFixed(0)}%
          </span>
        ) : assessment.isSubmitted ? (
          <span className="shrink-0 text-xs text-emerald-400">Submitted</span>
        ) : risk && risk.level !== "none" ? (
          <span
            className="shrink-0 text-xs"
            style={{ color: risk.level === "at-risk" ? "#fb7185" : "#fcd34d" }}
          >
            {risk.level === "at-risk" ? "▲ at risk" : "● watch"}
          </span>
        ) : null}
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-4 py-3">
          {risk && (
            <p className="mb-3 text-xs text-[var(--color-muted)]">
              {risk.reason}
              {risk.latestSafeStart && !assessment.isSubmitted && (
                <>
                  {" "}
                  Latest comfortable start:{" "}
                  <strong className="text-[var(--color-fg)]">
                    {new Date(risk.latestSafeStart).toLocaleDateString(
                      "en-IE",
                      { day: "numeric", month: "short" },
                    )}
                  </strong>
                  .
                </>
              )}
              {assessment.estimatedMinutes && (
                <> Estimated {formatMinutes(assessment.estimatedMinutes)}.</>
              )}
            </p>
          )}

          <SubmissionChecklist
            assessment={assessment}
            onToggle={onToggleStage}
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <GradeEntry
              grade={grade}
              onSave={onSaveGrade}
              onClear={onClearGrade}
            />
            <PinDate assessment={assessment} onPin={onPinDate} />
          </div>
        </div>
      )}
    </li>
  );
}

function GradeEntry({
  grade,
  onSave,
  onClear,
}: {
  grade: Assessment["grade"];
  onSave: (marksAwarded: number, marksPossible: number) => void;
  onClear: () => void;
}) {
  return (
    <form
      className="rounded border border-[var(--color-border)] p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const awarded = Number(data.get("awarded"));
        const possible = Number(data.get("possible")) || 100;
        if (!Number.isFinite(awarded)) return;
        onSave(awarded, possible);
      }}
    >
      <p className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Result
      </p>
      <div className="flex items-center gap-1.5 text-xs">
        <input
          name="awarded"
          type="number"
          step="0.5"
          min={0}
          defaultValue={grade?.marksAwarded ?? ""}
          placeholder="mark"
          className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
        />
        <span className="text-[var(--color-muted)]">out of</span>
        <input
          name="possible"
          type="number"
          step="0.5"
          min={1}
          defaultValue={grade?.marksPossible ?? 100}
          className="w-16 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
        />
        <button className="rounded border border-[var(--color-accent)] px-2 py-1">
          Save
        </button>
        {grade && (
          <button
            type="button"
            onClick={onClear}
            className="text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            Clear
          </button>
        )}
      </div>
      {grade && (
        <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
          {scorePercent(grade).toFixed(1)}% — recorded{" "}
          {new Date(grade.receivedAt).toLocaleDateString("en-IE")}
        </p>
      )}
    </form>
  );
}

function PinDate({
  assessment,
  onPin,
}: {
  assessment: Assessment;
  onPin: (dueAt: string | null) => void;
}) {
  return (
    <form
      className="rounded border border-[var(--color-border)] p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        const value = String(
          new FormData(event.currentTarget).get("due") ?? "",
        );
        onPin(value ? new Date(`${value}T23:59:00`).toISOString() : null);
      }}
    >
      <p className="mb-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
        Real deadline
      </p>
      <div className="flex items-center gap-1.5 text-xs">
        <input
          name="due"
          type="date"
          defaultValue={assessment.dueAt?.slice(0, 10) ?? ""}
          className="rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 outline-none focus:border-[var(--color-accent)]"
        />
        <button className="rounded border border-[var(--color-accent)] px-2 py-1">
          Pin
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
        UCD publishes a week window. Pin the date the lecturer announces — it
        will not be overwritten by a refresh.
      </p>
    </form>
  );
}

import { useEffect, useRef, useState } from "react";
import { parseCapture } from "../../shared/parse-capture";
import type { ModuleView } from "../lib/api";
import { colorFor, describeDue, formatMinutes } from "../lib/format";

interface Props {
  open: boolean;
  modules: ModuleView[];
  onClose: () => void;
  onSave: (raw: string) => void;
}

/**
 * Quick capture. Title is the only thing required, Enter saves, Esc cancels.
 *
 * Parsing runs live purely as feedback -- what it infers is shown beneath the
 * field so nothing is silently guessed, and a failure to parse still saves.
 */
export function QuickCapture({ open, modules, onClose, onSave }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) {
      setValue("");
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  const parsed = value.trim() ? parseCapture(value) : null;
  const module = parsed?.moduleCode
    ? modules.find((m) => m.code === parsed.moduleCode)
    : undefined;
  const due = parsed ? describeDue(parsed.dueAt) : null;
  const duration = parsed ? formatMinutes(parsed.estimatedMinutes) : null;

  return (
    <div
      className="quick-capture-overlay fixed inset-0 z-50 flex items-start justify-center px-4 pt-[18vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!value.trim()) return;
            onSave(value);
          }}
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
            }}
            placeholder="What needs doing?"
            className="quick-capture-input w-full rounded-lg border border-[var(--color-accent)] bg-[var(--color-surface)] px-5 py-4 text-base outline-none"
          />
        </form>

        <div className="mt-2 flex flex-wrap items-center gap-2 px-1 text-xs text-[var(--color-muted)]">
          {parsed && (module || due || duration) ? (
            <>
              <span>Saving as</span>
              <span className="text-[var(--color-fg)]">{parsed.title}</span>
              {module && (
                <span
                  className="rounded px-1.5 py-0.5 font-mono"
                  style={{
                    color: colorFor(module.colorToken),
                    background: `color-mix(in srgb, ${colorFor(module.colorToken)} 16%, transparent)`,
                  }}
                >
                  {module.code}
                </span>
              )}
              {duration && <span>· {duration}</span>}
              {due && <span>· {due.label}</span>}
            </>
          ) : (
            <span>
              Enter to save · Esc to cancel · try{" "}
              <code className="text-[var(--color-fg)]">
                digital lab friday 1h
              </code>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

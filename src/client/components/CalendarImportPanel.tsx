import { useRef, useState } from "react";
import { api, type CalendarImportSummary } from "../lib/api";

/**
 * Import a timetable without connecting Google.
 *
 * Deliberately the equal of the OAuth path rather than a hidden fallback: a
 * university Workspace can block third-party app access outright, and when it
 * does, this is the only route that works at all.
 */
export function CalendarImportPanel({ onImported }: { onImported: () => void }) {
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<CalendarImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (action: () => Promise<CalendarImportSummary>) => {
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const result = await action();
      setSummary(result);
      onImported();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="my-7 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
        Import timetable
      </h2>

      <p className="text-sm">
        Load your timetable from a calendar file or a subscription link. No
        Google account needed.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".ics,text/calendar"
          className="hidden"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            event.target.value = "";
            await run(() => api.importCalendarFile(text));
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {busy ? "Importing…" : "Choose .ics file"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="url"
          value={url}
          placeholder="or paste a calendar URL (iCal format)"
          onChange={(event) => setUrl(event.target.value)}
          className="min-w-[18rem] flex-1 rounded-md border border-[var(--color-border)] bg-transparent px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          disabled={busy || url.trim().length === 0}
          onClick={() => run(() => api.subscribeCalendar(url.trim()))}
          className="rounded-full border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Fetch
        </button>
      </div>

      <p className="mt-2 text-[11px] text-[var(--color-muted)]">
        A subscription URL keeps working: the nightly refresh re-reads it, so
        timetable changes appear on their own. Google Calendar → Settings → your
        calendar → Integrate calendar → secret address in iCal format.
      </p>

      {summary && (
        <p className="mt-3 text-sm">
          Imported {summary.imported} events
          {summary.calendarName ? ` from ${summary.calendarName}` : ""}.{" "}
          <span className="text-[var(--color-muted)]">
            {summary.matched} matched to a module
            {summary.firstEvent && summary.lastEvent
              ? `, ${new Date(summary.firstEvent).toLocaleDateString("en-IE")} to ${new Date(summary.lastEvent).toLocaleDateString("en-IE")}`
              : ""}
            .
          </span>
        </p>
      )}

      {summary && summary.matched < summary.imported && (
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">
          {summary.imported - summary.matched} events did not match a module
          code. They still count towards capacity.
        </p>
      )}

      {error && (
        <p className="mt-3 text-sm text-[var(--color-warning,#b45309)]">{error}</p>
      )}
    </section>
  );
}

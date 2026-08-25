import { useEffect, useState } from "react";
import { api, type DriveFolder, type ResourceRow } from "../lib/api";
import { groupByType, groupByWeek, type IndexedResource } from "../../shared/drive";

const TYPE_LABEL: Record<string, string> = {
  slide: "Slides",
  notes: "Notes",
  lab: "Labs",
  assignment: "Assignments",
  reading: "Reading",
  formula_sheet: "Formula sheets",
  other: "Other",
};

/**
 * Drive resources for a module.
 *
 * Files stay in Drive (brief section 16) -- this indexes and links, it never
 * copies. Grouping is by week when weeks are known, because "Review Digital
 * Week 3" should surface week 3's material directly.
 */
export function ModuleResources({
  code,
  driveFolderId,
  googleConnected,
}: {
  code: string;
  driveFolderId: string | null;
  googleConnected: boolean;
}) {
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<"week" | "type">("week");

  useEffect(() => {
    let cancelled = false;
    api
      .moduleResources(code)
      .then((rows) => {
        if (!cancelled) setResources(rows);
      })
      .catch(() => {
        if (!cancelled) setResources([]);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  const indexed: IndexedResource[] = resources.map((r) => ({
    googleDriveFileId: r.googleDriveFileId ?? r.id,
    title: r.title,
    type: r.type,
    weekNumber: r.weekNumber,
    url: r.url,
  }));

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setResources(await api.moduleResources(code));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Drive request failed");
    } finally {
      setBusy(false);
    }
  };

  if (!googleConnected) {
    return (
      <p className="text-xs text-[var(--color-muted)]">
        Connect Google to map this module to a Drive folder and index its
        material.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {driveFolderId ? (
          <>
            <button
              onClick={() => void run(() => api.indexDrive(code))}
              disabled={busy}
              className="rounded border border-[var(--color-accent)] px-2.5 py-1 text-xs disabled:opacity-50"
            >
              {busy ? "Indexing…" : "Re-index folder"}
            </button>
            <button
              onClick={() => void run(() => api.mapDrive(code, null))}
              disabled={busy}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              Unmap
            </button>
          </>
        ) : (
          <button
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setFolders(await api.driveFolders(code));
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "Drive request failed",
                );
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="rounded border border-[var(--color-border)] px-2.5 py-1 text-xs disabled:opacity-50"
          >
            {busy ? "Searching…" : `Find a Drive folder for ${code}`}
          </button>
        )}

        {resources.length > 0 && (
          <div className="ml-auto flex gap-1 text-[11px]">
            {(["week", "type"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setGroupMode(mode)}
                className="rounded border px-1.5 py-0.5"
                style={{
                  borderColor:
                    groupMode === mode
                      ? "var(--color-accent)"
                      : "var(--color-border)",
                  color:
                    groupMode === mode
                      ? "var(--color-fg)"
                      : "var(--color-muted)",
                }}
              >
                by {mode}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p className="mb-2 rounded border border-rose-800 bg-rose-950/30 px-2 py-1.5 text-xs text-rose-200">
          {error}
        </p>
      )}

      {folders.length > 0 && !driveFolderId && (
        <ul className="mb-3 divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
          {folders.map((folder) => (
            <li key={folder.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="flex-1 text-xs">{folder.name}</span>
              <button
                onClick={() =>
                  void run(async () => {
                    await api.mapDrive(code, folder.id);
                    await api.indexDrive(code);
                    setFolders([]);
                  })
                }
                className="rounded border border-[var(--color-accent)] px-2 py-0.5 text-[11px]"
              >
                Map
              </button>
            </li>
          ))}
        </ul>
      )}

      {indexed.length === 0 ? (
        <p className="text-xs text-[var(--color-muted)]">
          {driveFolderId
            ? "Folder mapped but nothing indexed yet."
            : "No Drive folder mapped."}
        </p>
      ) : groupMode === "week" ? (
        <ul className="space-y-3">
          {groupByWeek(indexed).map((group) => (
            <li key={group.weekNumber ?? "none"}>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                {group.weekNumber == null ? "No week" : `Week ${group.weekNumber}`}
              </p>
              <FileList items={group.items} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-3">
          {groupByType(indexed).map((group) => (
            <li key={group.type}>
              <p className="mb-1 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                {TYPE_LABEL[group.type] ?? group.type}
              </p>
              <FileList items={group.items} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileList({ items }: { items: IndexedResource[] }) {
  return (
    <ul className="divide-y divide-[var(--color-border)] rounded border border-[var(--color-border)]">
      {items.map((item) => (
        <li
          key={item.googleDriveFileId}
          className="flex items-center gap-2 px-3 py-1.5"
        >
          <span className="min-w-0 flex-1 truncate text-xs">{item.title}</span>
          <span className="shrink-0 text-[10px] text-[var(--color-muted)]">
            {TYPE_LABEL[item.type] ?? item.type}
          </span>
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[11px] text-[var(--color-accent)]"
            >
              Open in Drive
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

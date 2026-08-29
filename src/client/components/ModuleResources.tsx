import { useEffect, useState } from "react";
import { api, type DriveFolder, type ResourceRow } from "../lib/api";
import { groupByType, groupByWeek, type IndexedResource } from "../../shared/drive";
import { addStudyTime, listMaterials, saveMaterials, studySeconds, type LocalMaterial } from "../lib/local-materials";

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
  const [local, setLocal] = useState<LocalMaterial[]>([]);
  const [openLocal, setOpenLocal] = useState<LocalMaterial | null>(null);
  const [study, setStudy] = useState(0);
  const [localUrl, setLocalUrl] = useState<string | null>(null);

  useEffect(() => { void listMaterials(code).then(setLocal); void studySeconds(code).then(setStudy); }, [code]);
  useEffect(() => {
    if (!openLocal) { if (localUrl) URL.revokeObjectURL(localUrl); setLocalUrl(null); return; }
    const url = URL.createObjectURL(openLocal.blob); setLocalUrl(url);
    const started = Date.now();
    return () => { const seconds = Math.round((Date.now() - started) / 1000); if (seconds > 0) { void addStudyTime(code, seconds); setStudy((v) => v + seconds); } URL.revokeObjectURL(url); };
  }, [openLocal, code]);

  const addFolder = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])].filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    const now = new Date().toISOString();
    const items = files.map((file): LocalMaterial => { const path = file.webkitRelativePath || file.name; const parts = path.split("/"); return { id: `${code}:${path}`, moduleCode: code, folder: parts.length > 1 ? (parts[parts.length - 2] ?? "Added folder") : "Added folder", name: file.name.replace(/\.pdf$/i, ""), path, blob: file, addedAt: now, secondsViewed: 0 }; });
    await saveMaterials(items); setLocal(await listMaterials(code)); event.target.value = "";
  };

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
      <div className="mb-4 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
        <div className="flex flex-wrap items-center gap-2"><strong className="text-xs">Local material</strong><label className="rounded border border-[var(--color-accent)] px-2.5 py-1 text-xs cursor-pointer">Add folder<input type="file" hidden multiple accept="application/pdf,.pdf" {...({ webkitdirectory: "", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} onChange={(e) => void addFolder(e)} /></label><span className="text-[11px] text-[var(--color-muted)]">{local.length} PDFs · {Math.round(study / 60)} min studied</span></div>
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">Choose a folder inside this module’s folder. Files stay in this browser on this device.</p>
        {local.length > 0 && <div className="mt-2 grid gap-1">{local.map((item) => <button key={item.id} onClick={() => setOpenLocal(item)} className="text-left text-xs text-[var(--color-accent)] hover:underline">{item.folder} / {item.name}</button>)}</div>}
      </div>
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
      {openLocal && localUrl && <div className="reader-overlay"><div className="reader-shell"><header><strong>{openLocal.name}</strong><button onClick={() => setOpenLocal(null)}>Close</button></header><main className="reader-local"><iframe title={openLocal.name} src={localUrl} /></main></div></div>}
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

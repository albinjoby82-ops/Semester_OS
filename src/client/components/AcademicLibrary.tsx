import { useEffect, useMemo, useState } from "react";

type Resource = { id: string; path: string; title: string; module: string; type: string; pages?: number; topics?: { name: string; pages: number[] }[]; modifiedAt?: string; status?: string };
const TYPES = ["all", "slides", "lab", "worksheet", "assignment", "past-paper", "notes", "other"];
const BRIDGE = localStorage.getItem("semester-os.bridge") || "http://127.0.0.1:4317";

export function AcademicLibrary() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [query, setQuery] = useState(""); const [type, setType] = useState("all"); const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Resource | null>(null); const [page, setPage] = useState(1);
  const load = () => fetch(`${BRIDGE}/api/resources`).then(r => r.ok ? r.json() as Promise<Resource[]> : Promise.reject(new Error("Bridge unavailable"))).then(setResources).catch(e => setError(e.message));
  useEffect(() => { void load(); }, []);
  const filtered = useMemo(() => resources.filter(r => (type === "all" || r.type === type) && `${r.title} ${r.module} ${r.topics?.map(t => t.name).join(" ")}`.toLowerCase().includes(query.toLowerCase())), [resources, type, query]);
  return <section className="library-page">
    <div className="library-head"><div><p className="eyebrow">Local academic library</p><h2>Study materials</h2><p className="section-note">Your files stay in the configured Semester Vault. The bridge indexes locally and the web app never uploads originals.</p></div><button className="action-button px-3 py-2 text-xs" onClick={() => void load()}>Refresh index</button></div>
    {error && <div className="setup-alert">{error}. Start the local bridge with <code>npm run bridge</code>.</div>}
    <div className="library-toolbar"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search files, topics, pages…" aria-label="Search academic library" /> <div className="type-bar">{TYPES.map(t => <button key={t} className={type === t ? "is-active" : ""} onClick={() => setType(t)}>{t === "all" ? "All" : t.replace("-", " ")}</button>)}</div></div>
    <div className="resource-table">{filtered.map(r => <button className="resource-row" key={r.id} onClick={() => { setOpen(r); setPage(1); }}><span className="resource-title">{r.title}</span><span>{r.module}</span><span>{r.type}</span><span>{r.pages ? `${r.pages} pages` : "—"}</span><span>{r.topics?.slice(0, 2).map(t => t.name).join(" · ")}</span></button>)}{!filtered.length && <p className="empty-state">No indexed resources yet.</p>}</div>
    {open && <div className="reader-overlay"><div className="reader-shell"><header><strong>{open.title}</strong><button onClick={() => setOpen(null)}>Close</button></header><div className="reader-body"><aside><p className="panel-kicker">Topics</p>{(open.topics || []).map(t => <button key={t.name} onClick={() => setPage(t.pages[0] || 1)}>{t.name}<small>pp. {t.pages.join(", ")}</small></button>)}</aside><main><iframe title={open.title} src={`${BRIDGE}/api/file?path=${encodeURIComponent(open.path)}#page=${page}`} /><div className="reader-controls"><button onClick={() => setPage(Math.max(1, page - 1))}>‹</button><input value={page} onChange={e => setPage(Math.max(1, Number(e.target.value) || 1))} /> / {open.pages || "?"}<button onClick={() => setPage(page + 1)}>›</button></div></main></div></div></div>}
  </section>;
}

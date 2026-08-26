import { useCallback, useEffect, useMemo, useState } from "react";
import { CURRENT_TERM, TERM_DATES_UNCONFIRMED } from "../shared/term-config";
import { teachingWeekForDate } from "../shared/term-week";
import { parseCapture } from "../shared/parse-capture";
import {
  api,
  type Area,
  type DebtView,
  type ModuleView,
  type Task,
  type ActiveSession,
  type GoogleStatusView,
  type WhatsAppStatusView,
  type WeekView,
  type CalendarEventRow,
} from "./lib/api";
import type { StageKey } from "../shared/radar";
import type { WireNextView, WireRadarItem } from "./lib/wire";
import { minutesUntilNextCommitment } from "./lib/availability";
import { STAGE_FIELD } from "./lib/stages";
import { linkProps, useRoute } from "./lib/router";
import { daysBetween, formatMinutes } from "./lib/format";
import { QuickCapture } from "./components/QuickCapture";
import { TaskRow } from "./components/TaskRow";
import { OverloadHorizon } from "./components/OverloadHorizon";
import { WeekPanel } from "./components/WeekPanel";
import { ModuleCard } from "./components/ModuleCard";
import { FocusMode } from "./components/FocusMode";
import { ModulePage } from "./components/ModulePage";
import { AssessmentRadar } from "./components/AssessmentRadar";
import { NextAction } from "./components/NextAction";
import { WeekCalendar } from "./components/WeekCalendar";
import { GooglePanel } from "./components/GooglePanel";
import { CalendarImportPanel } from "./components/CalendarImportPanel";
import { WhatsAppPanel } from "./components/WhatsAppPanel";
import { Glance } from "./components/Glance";
import {
  enqueue,
  flushQueue,
  readQueue,
  requestBackgroundFlush,
} from "./lib/offline";
import { minutesUntilNextEvent } from "../shared/calendar";
import type { Calibration } from "../shared/calibration";

export function App() {
  const [modules, setModules] = useState<ModuleView[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [week, setWeek] = useState<WeekView | null>(null);
  const [debt, setDebt] = useState<DebtView | null>(null);
  const [active, setActive] = useState<ActiveSession | null>(null);
  const [calibration, setCalibration] = useState<Calibration | null>(null);
  const [radar, setRadar] = useState<WireRadarItem[]>([]);
  const [events, setEvents] = useState<CalendarEventRow[]>([]);
  const [next, setNext] = useState<WireNextView | null>(null);
  const [google, setGoogle] = useState<GoogleStatusView | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppStatusView | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleMessage, setGoogleMessage] = useState<string | null>(null);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const { route, navigate } = useRoute();
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [m, a, t, w, d, s, cal, r, commitments, gStatus, wStatus, events] =
        await Promise.all([
        api.modules(),
        api.areas(),
        api.tasks(),
        api.week(),
        api.debt(),
        api.activeSession(),
        api.calibration(),
        api.radar(14, true),
        api.commitments(),
        api.googleStatus(),
        api.whatsappStatus(),
        api.calendarEvents(),
      ]);
      setRadar(r);
      setEvents(events);

      setGoogle(gStatus);
      setWhatsapp(wStatus);

      // The gap to the next commitment is computed here, in local time: the
      // Worker runs in UTC and would be wrong by the offset.
      //
      // Real calendar events win over the hand-entered timetable once
      // Calendar is connected, matching how capacity is computed server-side.
      const available =
        events.length > 0
          ? minutesUntilNextEvent(events, new Date())
          : minutesUntilNextCommitment(commitments, w.currentWeek, new Date());
      setNext(await api.next(available));
      setModules(m);
      setAreas(a);
      setTasks(t);
      setWeek(w);
      setDebt(d);
      setActive(s);
      setCalibration(cal);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Launched from the home-screen shortcut or the Android share sheet.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("capture") === "1") {
      setCapturing(true);
      const url = new URL(window.location.href);
      url.searchParams.delete("capture");
      window.history.replaceState(null, "", url.pathname + url.search);
    }
  }, []);

  // The OAuth callback redirects back with ?google=... Surface it, then strip
  // it from the URL so a refresh does not replay a stale message.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("google");
    if (!param) return;
    setGoogleMessage(
      param === "connected"
        ? "Google connected. Sync your calendar to use it for capacity."
        : `Google connection failed: ${param.replace(/_/g, " ")}.`,
    );
    const url = new URL(window.location.href);
    url.searchParams.delete("google");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  // Q from anywhere. Capture has to be faster than opening anything else.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key.toLowerCase() === "q") {
        event.preventDefault();
        setCapturing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const moduleById = useMemo(
    () => new Map(modules.map((m) => [m.id, m])),
    [modules],
  );
  const moduleByCode = useMemo(
    () => new Map(modules.map((m) => [m.code, m])),
    [modules],
  );
  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);

  const capture = async (raw: string) => {
    const parsed = parseCapture(raw);
    const module = parsed.moduleCode
      ? moduleByCode.get(parsed.moduleCode)
      : undefined;

    const optimistic: Task = {
      id: crypto.randomUUID(),
      title: parsed.title,
      areaId: parsed.areaId ?? "university",
      moduleId: module?.id ?? null,
      assignmentId: null,
      status: "todo",
      dueAt: parsed.dueAt,
      weekNumber: null,
      estimatedMinutes: parsed.estimatedMinutes,
      isRequiredWeekly: false,
      deferredReason: null,
      scheduledStartAt: null,
      scheduledEndAt: null,
      createdAt: new Date().toISOString(),
    };

    setTasks((prev) => [optimistic, ...prev]);
    setCapturing(false);

    const payload = {
      id: optimistic.id,
      title: optimistic.title,
      areaId: optimistic.areaId,
      moduleId: optimistic.moduleId,
      dueAt: optimistic.dueAt,
      estimatedMinutes: optimistic.estimatedMinutes,
    };

    try {
      await api.createTask(payload);
      void load();
    } catch {
      // Capture must never fail. Queue it, tell the user it is safe, and let
      // the flush handle it. The insert is idempotent on the client-generated
      // id, so a retry cannot duplicate the task.
      await enqueue({
        ...payload,
        source: "manual",
        queuedAt: new Date().toISOString(),
        attempts: 0,
      });
      setQueued((await readQueue()).length);
      void requestBackgroundFlush();
    }
  };

  const flush = useCallback(async () => {
    const result = await flushQueue((queuedItem) =>
      fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queuedItem),
      }),
    );
    setQueued(result.remaining);
    if (result.sent > 0) void load();
  }, [load]);

  useEffect(() => {
    void readQueue().then((items) => setQueued(items.length));
    void flush();

    const goOnline = () => {
      setOnline(true);
      void flush();
    };
    const goOffline = () => setOnline(false);
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "flush-captures") void flush();
    };

    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      navigator.serviceWorker?.removeEventListener("message", onMessage);
    };
  }, [flush]);

  const patch = async (id: string, changes: Parameters<typeof api.updateTask>[1]) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...changes } as Task : t)),
    );
    try {
      await api.updateTask(id, changes);
      void load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed");
      void load();
    }
  };

  const isAssessed = (task: Task) => Boolean(task.assignmentId);

  const toggleStage = async (id: string, key: StageKey, next: boolean) => {
    try {
      await api.updateAssignment(id, { [STAGE_FIELD[key]]: next });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Update failed");
    } finally {
      void load();
    }
  };

  const saveGrade = async (id: string, awarded: number, possible: number) => {
    try {
      await api.saveGrade(id, awarded, possible);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save grade");
    } finally {
      void load();
    }
  };

  const startFocus = async (task: Task) => {
    try {
      setActive(await api.startSession(task.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start");
    }
  };

  const stopFocus = async (complete: boolean) => {
    try {
      await api.stopSession(complete);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not stop");
    } finally {
      setActive(null);
      void load();
    }
  };

  const handlers = {
    onToggleDone: (task: Task) =>
      patch(task.id, {
        status: task.status === "todo" || task.status === "in_progress"
          ? "done"
          : "todo",
      }),
    onSubmit: (task: Task) => patch(task.id, { status: "submitted" }),
    onDefer: (task: Task, reason: string) =>
      patch(task.id, { deferredReason: reason }),
    onStart: (task: Task) => void startFocus(task),
  };

  const now = new Date();
  // Debt is rendered in its own section; excluding those ids here keeps a task
  // from appearing twice on the same screen.
  const debtIds = useMemo(
    () => new Set((debt?.items ?? []).map((t) => t.id)),
    [debt],
  );

  const groups = useMemo(() => {
    const overdue: Task[] = [];
    const today: Task[] = [];
    const upcoming: Task[] = [];
    const undated: Task[] = [];

    for (const task of tasks) {
      if (debtIds.has(task.id)) continue;
      if (!task.dueAt) {
        undated.push(task);
        continue;
      }
      const days = daysBetween(now, new Date(task.dueAt));
      if (days < 0) overdue.push(task);
      else if (days === 0) today.push(task);
      else upcoming.push(task);
    }
    return { overdue, today, upcoming, undated };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, debtIds]);

  const currentWeek = teachingWeekForDate(now, CURRENT_TERM);
  const totalEffort = modules.reduce(
    (sum, m) => sum + (m.studentEffortHours ?? 0),
    0,
  );
  const committedMinutes = tasks.reduce(
    (sum, t) => sum + (t.estimatedMinutes ?? 0),
    0,
  );

  const renderTasks = (list: Task[]) => (
    <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface)]">
      {list.map((task) => (
        <TaskRow
          key={task.id}
          task={task}
          module={task.moduleId ? moduleById.get(task.moduleId) : undefined}
          area={areaById.get(task.areaId)}
          isAssessed={isAssessed(task)}
          {...handlers}
        />
      ))}
    </ul>
  );

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <a {...linkProps({ name: "today" }, navigate)} className="brand-mark">
          <span className="brand-orb">S</span>
          <span>semester<span>os</span></span>
        </a>
        <p className="rail-term">
          {CURRENT_TERM.label}
          {currentWeek ? ` · Week ${currentWeek}` : " · Setup"}
        </p>
        <nav className="side-nav" aria-label="Main navigation">
          <a
            {...linkProps({ name: "today" }, navigate)}
            className={
              route.name === "today"
                ? "nav-link is-active"
                : "nav-link"
            }
          >
            <span className="nav-icon">⌂</span> Today
          </a>
          <a
            {...linkProps({ name: "assessments" }, navigate)}
            className={
              route.name === "assessments"
                ? "nav-link is-active"
                : "nav-link"
            }
          >
            <span className="nav-icon">◒</span> Assessments
          </a>
          <a
            {...linkProps({ name: "settings" }, navigate)}
            className={
              route.name === "settings"
                ? "nav-link is-active"
                : "nav-link"
            }
          >
            <span className="nav-icon">⚙</span> Settings
          </a>
          <a
            {...linkProps({ name: "glance" }, navigate)}
            className={
              route.name === "glance"
                ? "nav-link is-active"
                : "nav-link"
            }
          >
            <span className="nav-icon">◌</span> Glance
          </a>
        </nav>
        <button
          onClick={() => setCapturing(true)}
          className="capture-button"
        >
          <span>＋</span> Add a task <kbd>Q</kbd>
        </button>
        <p className="rail-note">A calm place to keep the term in view.</p>
      </aside>

      <main className="app-main">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">{dateLabel}</p>
            <h1>{route.name === "today" ? "Your day, at a glance." : "Semester workspace"}</h1>
          </div>
          <button onClick={() => setCapturing(true)} className="mobile-capture" aria-label="Add a task">＋</button>
        </header>
        <nav className="mobile-route-nav" aria-label="Workspace navigation">
          <a {...linkProps({ name: "today" }, navigate)} className={route.name === "today" ? "is-active" : ""}>Today</a>
          <a {...linkProps({ name: "assessments" }, navigate)} className={route.name === "assessments" ? "is-active" : ""}>Assessments</a>
          <a {...linkProps({ name: "settings" }, navigate)} className={route.name === "settings" ? "is-active" : ""}>Settings</a>
          <a {...linkProps({ name: "glance" }, navigate)} className={route.name === "glance" ? "is-active" : ""}>Glance</a>
        </nav>

      {(!online || queued > 0) && (
        <p className="sync-alert border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
          {!online && <strong>Offline. </strong>}
          {queued > 0
            ? `${queued} capture${queued === 1 ? "" : "s"} saved locally — they will sync automatically.`
            : "Captures are saved locally and sync when you reconnect."}
        </p>
      )}

      {TERM_DATES_UNCONFIRMED && (
        <p className="setup-alert">
          <strong>Term dates need confirming.</strong> Week numbers are shown as
          provisional until your confirmed semester start date is added.
        </p>
      )}

      {route.name === "share" ? (
        <ShareHandler
          onCapture={async (text) => {
            await capture(text);
            navigate({ name: "today" });
          }}
        />
      ) : route.name === "glance" ? (
        <Glance
          week={week}
          debt={debt}
          modules={modules}
          next={next}
          onCapture={() => setCapturing(true)}
          onStart={(taskId) => {
            const found = tasks.find((t) => t.id === taskId);
            if (found) void startFocus(found);
          }}
        />
      ) : route.name === "module" ? (
        (() => {
          const module = modules.find((m) => m.code === route.code);
          return module ? (
            <ModulePage
              module={module}
              onToggleStage={(id, key, next) => void toggleStage(id, key, next)}
              onSaveGrade={(id, a, b) => void saveGrade(id, a, b)}
              onClearGrade={async (id) => {
                await api.clearGrade(id);
                void load();
              }}
              onPinDate={async (id, dueAt) => {
                await api.updateAssignment(id, { dueAt });
                void load();
              }}
              googleConnected={Boolean(google?.connected)}
            />
          ) : (
            <Empty>No module with code {route.code}.</Empty>
          );
        })()
      ) : route.name === "settings" ? (
        <>
          <CalendarImportPanel onImported={() => void load()} />
          <GooglePanel
            status={google}
            busy={googleBusy}
            message={googleMessage}
            onSync={async () => {
              setGoogleBusy(true);
              setGoogleMessage(null);
              try {
                const result = await api.syncCalendar();
                setGoogleMessage(
                  `Imported ${result.imported} events (${result.skipped} skipped).`,
                );
                void load();
              } catch (cause) {
                setGoogleMessage(
                  cause instanceof Error ? cause.message : "Sync failed",
                );
              } finally {
                setGoogleBusy(false);
              }
            }}
            onDisconnect={async () => {
              setGoogleBusy(true);
              try {
                await api.disconnectGoogle();
                setGoogleMessage("Disconnected.");
                void load();
              } finally {
                setGoogleBusy(false);
              }
            }}
          />
          <WhatsAppPanel status={whatsapp} />
        </>
      ) : route.name === "assessments" ? (
        <Section
          title={`Assessment radar (${radar.length})`}
          note="Everything assessed that is due, overdue, or coming. Overdue work stays at the top rather than dropping off the list."
        >
          <AssessmentRadar
            items={radar}
            onOpenModule={(code) => navigate({ name: "module", code })}
          />
        </Section>
      ) : error ? (
        <DataUnavailable onRetry={() => { setLoading(true); void load(); }} />
      ) : (
        <>
        {week && (
          <OverloadHorizon horizon={week.horizon} currentWeek={week.currentWeek} />
        )}

        {loading ? (
          <p className="loading-state">Opening your workspace…</p>
        ) : (
          <>
            <div className="overview-grid">
              <NextAction
                recommended={next?.recommended ?? null}
                minutesAvailable={next?.minutesAvailable ?? null}
                module={
                  next?.recommended?.task.moduleId
                    ? moduleById.get(next.recommended.task.moduleId)
                    : undefined
                }
                onStart={(taskId) => {
                  const found = tasks.find((t) => t.id === taskId);
                  if (found) void startFocus(found);
                }}
              />

              {week && (
                <WeekPanel
                  week={week}
                  areas={areas}
                  onSaveAllocations={async (allocations) => {
                    await api.setAllocations(allocations);
                    void load();
                  }}
                />
              )}
            </div>

            {/* Where the free hours actually are, and somewhere to put work. */}
            <WeekCalendar
              events={events}
              tasks={tasks}
              modules={modules}
              onSchedule={async (taskId, startAt, endAt) => {
                await api.scheduleTask(taskId, startAt, endAt);
                void load();
              }}
              onUnschedule={async (taskId) => {
                await api.unscheduleTask(taskId);
                void load();
              }}
            />

            {/* Academic debt: expected work that should already be done. */}
            {debt && debt.count > 0 && (
              <Section
                title={`Academic debt: ${debt.count}`}
                tone="danger"
                note="University work from this week or earlier that should already be complete. It carries forward until done, rescheduled, or dismissed with a reason."
              >
                <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--color-muted)]">
                  {debt.byModule.map((entry) => (
                    <span key={entry.code}>
                      <strong className="text-[var(--color-fg)]">
                        {entry.code}
                      </strong>{" "}
                      {entry.titles.length}
                    </span>
                  ))}
                </p>
                {renderTasks(debt.items)}
              </Section>
            )}

            {/* Overdue first, always. Never hide overdue work. */}
            {groups.overdue.length > 0 && (
              <Section
                title={`Overdue (${groups.overdue.length})`}
                tone="danger"
                note="Carried forward until done, rescheduled, or dismissed with a reason."
              >
                {renderTasks(groups.overdue)}
              </Section>
            )}

            <Section title={`Today (${groups.today.length})`}>
              {groups.today.length > 0 ? (
                renderTasks(groups.today)
              ) : (
                <Empty>Nothing due today.</Empty>
              )}
            </Section>

            {groups.upcoming.length > 0 && (
              <Section title={`Upcoming (${groups.upcoming.length})`}>
                {renderTasks(groups.upcoming)}
              </Section>
            )}

            {groups.undated.length > 0 && (
              <Section
                title={`No date (${groups.undated.length})`}
                note="Captured but not yet placed. Give these a day to make them real."
              >
                {renderTasks(groups.undated)}
              </Section>
            )}

            {tasks.length === 0 && (
              <Empty>
                Nothing captured yet. Press <Kbd>Q</Kbd> and type something like{" "}
                <code>digital lab friday 1h</code>.
              </Empty>
            )}

            {radar.length > 0 && (
              <Section
                title="Next assessments"
                note="Ordered by date, then by what they are worth."
              >
                <AssessmentRadar
                  items={radar}
                  compact
                  onOpenModule={(code) => navigate({ name: "module", code })}
                />
              </Section>
            )}

            <Section title="Modules">
              <div className="grid gap-3 sm:grid-cols-2">
                {modules.map((module) => (
                  <ModuleCard
                    key={module.id}
                    module={module}
                    onOpen={() => navigate({ name: "module", code: module.code })}
                  />
                ))}
              </div>

              {totalEffort > 0 && week && (
                <p className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-xs leading-relaxed text-[var(--color-muted)]">
                  <strong className="text-[var(--color-fg)]">
                    The honest effort budget.
                  </strong>{" "}
                  UCD states {totalEffort}h of total effort across these six
                  modules — about{" "}
                  <strong className="text-[var(--color-fg)]">
                    {week.effort.statedPerWeek.toFixed(1)}h a week
                  </strong>{" "}
                  of university work alone, against{" "}
                  {week.effort.realisticHours}h of realistically allocatable time,
                  before GaelForce and Accio.
                  {!week.effort.feasible && (
                    <>
                      {" "}
                      That is{" "}
                      <strong className="text-rose-300">
                        {week.effort.gapPerWeek.toFixed(1)}h a week more than fits
                      </strong>
                      . Something has to give, and it is better to choose than to
                      discover it.
                    </>
                  )}
                  {calibration?.message && (
                    <>
                      {" "}
                      <span className="text-[var(--color-fg)]">
                        {calibration.message}
                      </span>
                    </>
                  )}
                  {committedMinutes > 0 && (
                    <>
                      {" "}
                      You currently have{" "}
                      <strong className="text-[var(--color-fg)]">
                        {formatMinutes(committedMinutes)}
                      </strong>{" "}
                      of estimated work captured.
                    </>
                  )}
                </p>
              )}
            </Section>
          </>
        )}
        </>
      )}

      {active?.task && (
        <FocusMode
          task={active.task}
          module={
            active.task.moduleId
              ? moduleById.get(active.task.moduleId)
              : undefined
          }
          startedAt={active.session.startedAt}
          onFinish={() => void stopFocus(true)}
          onPause={() => void stopFocus(false)}
        />
      )}

      <QuickCapture
        open={capturing}
        modules={modules}
        onClose={() => setCapturing(false)}
        onSave={(raw) => void capture(raw)}
      />
      </main>
    </div>
  );
}

function Section({
  title,
  note,
  tone,
  children,
}: {
  title: string;
  note?: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <section className={`content-section${tone === "danger" ? " is-danger" : ""}`}>
      <div className="section-heading">
        <h2>{title}</h2>
      </div>
      {note && (
        <p className="section-note">{note}</p>
      )}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="empty-state">
      {children}
    </p>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="keycap">
      {children}
    </kbd>
  );
}

function DataUnavailable({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="data-unavailable">
      <div className="error-icon">!</div>
      <h2>Your workspace isn&apos;t ready yet</h2>
      <p>
        We couldn&apos;t load your semester data. If this is a new deployment,
        the database still needs its first setup. Once that&apos;s done, your tasks
        and modules will appear here.
      </p>
      <button onClick={onRetry}>Try again</button>
    </section>
  );
}

/**
 * Android share-target landing.
 *
 * Whatever was shared is pre-filled and saved on confirm rather than silently
 * captured, because a share sheet fires easily by accident and a stream of
 * junk tasks would be worse than one extra tap.
 */
function ShareHandler({
  onCapture,
}: {
  onCapture: (text: string) => Promise<void>;
}) {
  const params = new URLSearchParams(window.location.search);
  const shared = [params.get("title"), params.get("text"), params.get("url")]
    .filter(Boolean)
    .join(" ")
    .trim();

  const [value, setValue] = useState(shared);

  return (
    <section className="my-8">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-muted)]">
        Capture shared text
      </h2>
      {shared ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) void onCapture(value);
          }}
        >
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-md border border-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3 outline-none"
          />
          <button className="mt-3 rounded-md border border-[var(--color-accent)] px-4 py-2 text-sm">
            Save task
          </button>
        </form>
      ) : (
        <Empty>Nothing was shared.</Empty>
      )}
    </section>
  );
}

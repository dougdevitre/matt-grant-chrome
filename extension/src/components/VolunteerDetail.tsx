import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { Task, VolunteerWork } from "../lib/types.js";

// Expanded pane under a roster row: one volunteer's tasks, claimed shifts, and
// recent activity. When the captain can manage the team, it also offers assigning
// an open task to this volunteer.
export function VolunteerDetail({
  clerkId,
  canManage,
}: {
  clerkId: string;
  canManage: boolean;
}) {
  const [work, setWork] = useState<VolunteerWork | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assignable, setAssignable] = useState<Task[]>([]);
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      setWork(await api.volunteerWork(clerkId));
      if (canManage) {
        // Open tasks the captain can see form the assignable pool.
        const tasks = await api.tasks();
        setAssignable(tasks.filter((t) => t.status === "open"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "work_load_failed");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkId]);

  async function assign() {
    if (!pick) return;
    setBusy(true);
    setError(null);
    try {
      await api.assignTask(clerkId, pick);
      setPick("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "assign_failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !work) return <div className="warn" role="alert">{messageForError(error)}</div>;
  if (!work) return <div className="note">Loading…</div>;

  const openTasks = work.tasks.filter((t) => t.status !== "done" && t.status !== "skipped");

  return (
    <div className="detail">
      <div className="detail-row">
        <span className="k">Tasks</span>
        <span>
          {openTasks.length} open · {work.tasks.length} total
        </span>
      </div>
      {work.tasks.slice(0, 6).map((t) => (
        <div className="prow" key={t.id}>
          <span>{t.title}</span>
          <span className={`tag ${t.status}`}>{t.status}</span>
        </div>
      ))}

      <div className="detail-row">
        <span className="k">Shifts</span>
        <span>{work.shifts.length} claimed</span>
      </div>
      {work.shifts.slice(0, 6).map((s) => (
        <div className="prow" key={s.id}>
          <span>{s.role}</span>
          <span className="note">{s.startsAt.slice(0, 10)}</span>
        </div>
      ))}

      <div className="detail-row">
        <span className="k">Recent activity</span>
        <span>{work.recentActivity.length}</span>
      </div>
      {work.recentActivity.slice(0, 5).map((a, i) => (
        <div className="prow" key={i}>
          <span>{a.action}</span>
          <span className="note">{a.ts.slice(0, 10)}</span>
        </div>
      ))}
      {work.tasks.length === 0 && work.shifts.length === 0 ? (
        <p className="note">No tasks or shifts yet.</p>
      ) : null}

      {canManage ? (
        <div className="assign-task">
          <label className="k">Assign a task</label>
          <div className="row">
            <select
              className="select"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              disabled={busy || assignable.length === 0}
            >
              <option value="">
                {assignable.length ? "Choose an open task…" : "No open tasks"}
              </option>
              {assignable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <button className="btn" disabled={!pick || busy} onClick={assign}>
              Assign
            </button>
          </div>
          {error ? <div className="warn" role="alert">{messageForError(error)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

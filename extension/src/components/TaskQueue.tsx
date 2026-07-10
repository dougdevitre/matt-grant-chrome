import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { ClerkIdentity, Task } from "../lib/types.js";

function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "";
  const ms = Date.parse(dueAt) - Date.now();
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "overdue";
  const days = Math.floor(ms / 86_400_000);
  return days >= 1 ? `due in ${days}d` : "due today";
}

export function TaskQueue({
  me,
  zip,
}: {
  me: ClerkIdentity;
  zip: string | null;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The Local tab's resolved ZIP scopes the queue — useful, but it must be
  // visible and escapable, or tasks elsewhere silently vanish and an empty
  // queue reads as "all done".
  const [useZip, setUseZip] = useState(true);
  const effectiveZip = useZip ? zip : null;

  async function load() {
    try {
      setTasks(await api.tasks(effectiveZip));
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }

  useEffect(() => {
    setUseZip(true); // a newly resolved location re-applies its filter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip, useZip]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "action_failed";
      setError(messageForError(code));
      // A stale version means someone else changed this task — reload so the
      // next attempt carries the fresh version.
      if (code === "version_conflict") await load();
    } finally {
      setBusyId(null);
    }
  }

  const zipBanner = effectiveZip ? (
    <p className="note">
      Showing tasks for ZIP {effectiveZip}.{" "}
      <button className="linklike" onClick={() => setUseZip(false)}>
        Show all
      </button>
    </p>
  ) : null;

  if (error) return <div className="warn" role="alert">{messageForError(error)}</div>;
  if (!tasks) return <p className="note">Loading your queue…</p>;
  if (tasks.length === 0)
    return (
      <div className="queue">
        {zipBanner}
        <div className="empty">
          {effectiveZip
            ? `No tasks in ZIP ${effectiveZip} for this phase.`
            : "Your queue is clear for this phase. Nice work."}
        </div>
      </div>
    );

  return (
    <div className="queue">
      {zipBanner}
      {tasks.map((t) => {
        const mine = t.assignedClerkId === me.clerkId;
        const busy = busyId === t.id;
        return (
          <div className="task" key={t.id}>
            <div className="task-head">
              <span className={`pill ${t.status}`}>{t.status}</span>
              {t.dueAt ? <span className="due">{dueLabel(t.dueAt)}</span> : null}
            </div>
            <h3>{t.title}</h3>
            <p>{t.detail}</p>
            <div className="task-actions">
              {t.status === "open" ? (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => act(t.id, () => api.claimTask(t.id, t.version))}
                >
                  Claim
                </button>
              ) : null}
              {mine && (t.status === "claimed" || t.status === "in_progress") ? (
                <>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => act(t.id, () => api.completeTask(t.id))}
                  >
                    Done
                  </button>
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => act(t.id, () => api.skipTask(t.id))}
                  >
                    Skip
                  </button>
                </>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

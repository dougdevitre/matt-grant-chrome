import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
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

  async function load() {
    try {
      setTasks(await api.tasks(zip));
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zip]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "action_failed");
    } finally {
      setBusyId(null);
    }
  }

  if (error) return <div className="warn">Couldn't load tasks: {error}</div>;
  if (!tasks) return <p className="note">Loading your queue…</p>;
  if (tasks.length === 0)
    return (
      <div className="empty">
        Your queue is clear for this phase. Nice work.
      </div>
    );

  return (
    <div className="queue">
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

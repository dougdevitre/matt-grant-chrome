import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { VolunteerWork } from "../lib/types.js";

// Expanded pane under a roster row: one volunteer's tasks, claimed shifts, and
// recent activity. Read-only in this phase (assign/reassign comes later).
export function VolunteerDetail({ clerkId }: { clerkId: string }) {
  const [work, setWork] = useState<VolunteerWork | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .volunteerWork(clerkId)
      .then((w) => {
        if (!cancelled) setWork(w);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "work_load_failed");
      });
    return () => {
      cancelled = true;
    };
  }, [clerkId]);

  if (error) return <div className="warn" role="alert">{messageForError(error)}</div>;
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
    </div>
  );
}

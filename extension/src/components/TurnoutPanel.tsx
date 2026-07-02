import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { FollowUp, GotvDashboard } from "../lib/types.js";

// GOTV turnout dashboard: how many contacts have cast a ballot, overall and by
// ZIP. Counts only — no voter PII. Gated by voter.read in the parent.
export function TurnoutPanel() {
  const [data, setData] = useState<GotvDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [due, setDue] = useState<FollowUp[]>([]);

  function loadDue() {
    api
      .followUpsDue()
      .then(setDue)
      .catch(() => {
        /* reminders are optional; ignore */
      });
  }

  useEffect(() => {
    api
      .gotvDashboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "load_failed"));
    loadDue();
  }, []);

  async function markDone(id: string) {
    try {
      await api.resolveFollowUp(id, "done");
      setDue((list) => list.filter((f) => f.id !== id));
    } catch {
      /* ignore */
    }
  }

  if (error) {
    return (
      <div className="panel">
        <div className="warn" role="alert">{messageForError(error)}</div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="panel">
        <p className="note">Loading turnout…</p>
      </div>
    );
  }

  const pct = data.total ? Math.round((data.cast / data.total) * 100) : 0;

  return (
    <div className="panel">
      <h2 className="section-h">Turnout progress</h2>
      <div
        className="gotv-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Share of contacts who have cast a ballot"
      >
        <div className="gotv-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="note">
        {data.cast} of {data.total} contacts have voted ({pct}%)
      </p>
      <div className="counts">
        <span className="pill done">{data.voted} voted</span>
        <span className="pill">{data.earlyVoted} early</span>
        <span className="pill">{data.pledged} pledged</span>
        <span className="pill">{data.remaining} to go</span>
      </div>

      {data.byZip.length ? (
        <div className="gotv-zips">
          <h2 className="section-h">By ZIP</h2>
          {data.byZip.map((z) => (
            <div className="contact" key={z.zip}>
              <div>
                <strong>{z.zip}</strong>{" "}
                <span className="note">
                  {z.cast}/{z.total} voted
                </span>
              </div>
              <span className="tag">{z.remaining} left</span>
            </div>
          ))}
        </div>
      ) : null}

      {due.length ? (
        <div className="gotv-zips">
          <h2 className="section-h">Reminders due ({due.length})</h2>
          {due.map((f) => (
            <div className="contact" key={f.id}>
              <div>
                <strong>Follow up</strong>{" "}
                <span className="note">{f.note ?? "reminder"}</span>
              </div>
              <button className="btn secondary" onClick={() => markDone(f.id)}>
                Done
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

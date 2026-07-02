import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { TeamMember } from "../lib/types.js";
import { VolunteerDetail } from "./VolunteerDetail.js";

// Team Captain view: the captain's roster of volunteers. Each row expands to a
// read-only summary of that volunteer's tasks, shifts, and recent activity.
export function TeamPanel() {
  const [roster, setRoster] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .team()
      .then((r) => {
        if (!cancelled) setRoster(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "team_load_failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="panel">
      <h2 className="section-h">Your team</h2>
      <p className="note">
        Volunteers you manage. Tap a name to see their tasks, shifts, and recent activity.
      </p>
      {error ? <div className="warn" role="alert">{messageForError(error)}</div> : null}
      {roster && roster.length === 0 ? (
        <p className="note">No volunteers on your roster yet. Ask an admin to add them.</p>
      ) : null}
      {roster?.map((m) => (
        <div key={m.id}>
          <div
            className="contact contact-row"
            role="button"
            tabIndex={0}
            aria-expanded={openId === m.clerkId}
            onClick={() => setOpenId((id) => (id === m.clerkId ? null : m.clerkId))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenId((id) => (id === m.clerkId ? null : m.clerkId));
              }
            }}
          >
            <div>
              <strong>{m.displayName}</strong>
              <span className="note"> {m.email ?? m.phone ?? ""}</span>
            </div>
            {m.teamId ? <span className="tag">{m.teamId}</span> : null}
          </div>
          {openId === m.clerkId ? <VolunteerDetail clerkId={m.clerkId} /> : null}
        </div>
      ))}
    </div>
  );
}

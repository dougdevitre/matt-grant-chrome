import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { ClerkIdentity, TeamMember } from "../lib/types.js";
import { VolunteerDetail } from "./VolunteerDetail.js";

// Team Captain view: the captain's roster of volunteers. Each bound volunteer's
// row expands to their tasks/shifts/activity (+ assign, when the captain can
// manage). Captains with team.manage can also invite and remove volunteers.
export function TeamPanel({ me }: { me: ClerkIdentity }) {
  const canManage = me.scopes.includes("team.manage");
  const [roster, setRoster] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState({ displayName: "", email: "" });

  async function load() {
    setError(null);
    try {
      setRoster(await api.team());
    } catch (e) {
      setError(e instanceof Error ? e.message : "team_load_failed");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doInvite() {
    if (!invite.displayName.trim() || !invite.email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.inviteVolunteer({
        displayName: invite.displayName.trim(),
        email: invite.email.trim(),
      });
      setInvite({ displayName: "", email: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "invite_failed");
    } finally {
      setBusy(false);
    }
  }

  async function doRemove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.removeVolunteer(id);
      if (openId === id) setOpenId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "remove_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2 className="section-h">Your team</h2>
      <p className="note">
        Volunteers you manage. Tap a name to see their tasks, shifts, and recent activity.
      </p>
      {error ? <div className="warn" role="alert">{messageForError(error)}</div> : null}

      {canManage ? (
        <div className="form invite-form">
          <div className="row">
            <input
              placeholder="Volunteer name"
              value={invite.displayName}
              onChange={(e) => setInvite({ ...invite, displayName: e.target.value })}
            />
            <input
              placeholder="Email"
              value={invite.email}
              onChange={(e) => setInvite({ ...invite, email: e.target.value })}
            />
          </div>
          <button
            className="btn"
            disabled={busy || !invite.displayName.trim() || !invite.email.trim()}
            onClick={doInvite}
          >
            Invite volunteer
          </button>
          <p className="note">They join your team once they sign in with that email.</p>
        </div>
      ) : null}

      {roster && roster.length === 0 ? (
        <p className="note">No volunteers on your roster yet.</p>
      ) : null}
      {roster?.map((m) => (
        <div key={m.id}>
          <div
            className="contact contact-row"
            role="button"
            tabIndex={0}
            aria-expanded={openId === m.id}
            onClick={() => setOpenId((id) => (id === m.id ? null : m.id))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setOpenId((id) => (id === m.id ? null : m.id));
              }
            }}
          >
            <div>
              <strong>{m.displayName}</strong>
              <span className="note"> {m.email ?? m.phone ?? ""}</span>
            </div>
            <div>
              {m.clerkId ? null : <span className="tag">pending</span>}
              {canManage ? (
                <button
                  className="linklike"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    doRemove(m.id);
                  }}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
          {openId === m.id ? (
            m.clerkId ? (
              <VolunteerDetail clerkId={m.clerkId} canManage={canManage} />
            ) : (
              <div className="detail">
                <p className="note">Hasn't signed in yet — no tasks or shifts to show.</p>
              </div>
            )
          ) : null}
        </div>
      ))}
    </div>
  );
}

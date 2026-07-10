import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { ClerkIdentity, EventKind, EventWithShifts } from "../lib/types.js";

function when(startsAt: string, endsAt: string): string {
  const s = new Date(startsAt);
  const e = new Date(endsAt);
  const date = s.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time(s)}–${time(e)}`;
}

const KIND_LABEL: Record<EventKind, string> = {
  registration_drive: "Registration drive",
  canvass: "Canvass",
  phone_bank: "Phone bank",
  early_vote_reminder: "Early-vote reminder",
};

// Event + shift creation for the Events & Scheduler Clerk (events.write). This
// was the role's missing entry point: the server routes existed but the panel
// only listed events, so an events_clerk could never actually add one.
function CreateEvent({ county, onCreated }: { county: string | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<EventKind>("canvass");
  const [countyIn, setCountyIn] = useState(county ?? "");
  const [venue, setVenue] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = title.trim() && countyIn.trim() && startsAt && endsAt;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.createEvent({
        title: title.trim(),
        kind,
        county: countyIn.trim(),
        venueName: venue.trim() || null,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        // phases intentionally omitted — the server derives the right phase
        // window from the kind.
      });
      setTitle("");
      setVenue("");
      setStartsAt("");
      setEndsAt("");
      setOpen(false);
      onCreated();
    } catch (e) {
      setError(messageForError(e instanceof Error ? e.message : "save_failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="btn secondary" onClick={() => setOpen(true)}>
        Create event
      </button>
    );
  }
  return (
    <div className="card">
      <h3>Create event</h3>
      {error ? <div className="warn" role="alert">{error}</div> : null}
      <div className="form">
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          Kind
          <select
            className="select"
            value={kind}
            onChange={(e) => setKind(e.target.value as EventKind)}
          >
            {(Object.keys(KIND_LABEL) as EventKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          County
          <input value={countyIn} onChange={(e) => setCountyIn(e.target.value)} />
        </label>
        <label>
          Venue (optional)
          <input value={venue} onChange={(e) => setVenue(e.target.value)} />
        </label>
        <label>
          Starts
          <input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label>
          Ends
          <input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </label>
        <div className="task-actions">
          <button className="btn" disabled={busy || !valid} onClick={save}>
            Save event
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// Inline add-shift form on an event card (events.write only).
function AddShift({ event, onAdded }: { event: EventWithShifts; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("");
  const [capacity, setCapacity] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Shift times default to the event window; refine later if needed.
      await api.addShift(event.id, {
        role: role.trim(),
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        capacity,
      });
      setRole("");
      setOpen(false);
      onAdded();
    } catch (e) {
      setError(messageForError(e instanceof Error ? e.message : "save_failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="linklike" onClick={() => setOpen(true)}>
        + Add shift
      </button>
    );
  }
  return (
    <div className="form">
      {error ? <div className="warn" role="alert">{error}</div> : null}
      <label>
        Shift role
        <input
          value={role}
          placeholder="e.g. Door knocker"
          onChange={(e) => setRole(e.target.value)}
        />
      </label>
      <label>
        Capacity
        <input
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
        />
      </label>
      <div className="task-actions">
        <button className="btn" disabled={busy || !role.trim()} onClick={save}>
          Save shift
        </button>
        <button className="btn secondary" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function Scheduler({
  me,
  county,
  zip,
}: {
  me: ClerkIdentity;
  county: string | null;
  zip: string | null;
}) {
  const [events, setEvents] = useState<EventWithShifts[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setEvents(await api.events(county, zip));
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [county, zip]);

  async function claim(shiftId: string, version: number) {
    setBusyId(shiftId);
    setError(null);
    try {
      await api.claimShift(shiftId, version);
      await load();
    } catch (e) {
      const code = e instanceof Error ? e.message : "claim_failed";
      setError(messageForError(code));
      // Stale version: someone else claimed/changed it — reload for fresh state.
      if (code === "version_conflict") await load();
    } finally {
      setBusyId(null);
    }
  }

  const canManageEvents = me.scopes.includes("events.write" as never);

  if (error) return <div className="warn" role="alert">{messageForError(error)}</div>;
  if (!events) return <p className="note">Loading the schedule…</p>;
  if (events.length === 0)
    return (
      <div className="schedule">
        <div className="empty">
          No events for this phase yet
          {county ? ` in ${county} County` : ""}.
        </div>
        {canManageEvents ? <CreateEvent county={county} onCreated={load} /> : null}
      </div>
    );

  return (
    <div className="schedule">
      {canManageEvents ? <CreateEvent county={county} onCreated={load} /> : null}
      {events.map((ev) => (
        <div className="event" key={ev.id}>
          <h3>{ev.title}</h3>
          <p className="note">
            {when(ev.startsAt, ev.endsAt)}
            {ev.venueName ? ` · ${ev.venueName}` : ""}
          </p>
          <div className="shifts">
            {ev.shifts.map((s) => {
              const mine = s.claimedBy.includes(me.clerkId);
              const full = s.claimedBy.length >= s.capacity;
              return (
                <div className="shift" key={s.id}>
                  <div>
                    <strong>{s.role}</strong>
                    <span className="note">
                      {" "}
                      {when(s.startsAt, s.endsAt)} · {s.claimedBy.length}/
                      {s.capacity}
                    </span>
                  </div>
                  {mine ? (
                    <span className="pill done">claimed</span>
                  ) : (
                    <button
                      className="btn"
                      disabled={full || busyId === s.id}
                      onClick={() => claim(s.id, s.version)}
                    >
                      {full ? "Full" : "Claim shift"}
                    </button>
                  )}
                </div>
              );
            })}
            {canManageEvents ? <AddShift event={ev} onAdded={load} /> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

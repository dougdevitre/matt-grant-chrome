import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { ClerkIdentity, EventWithShifts } from "../lib/types.js";

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

  if (error) return <div className="warn">Couldn't load events: {error}</div>;
  if (!events) return <p className="note">Loading the schedule…</p>;
  if (events.length === 0)
    return (
      <div className="empty">
        No events for this phase yet
        {county ? ` in ${county} County` : ""}.
      </div>
    );

  return (
    <div className="schedule">
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
          </div>
        </div>
      ))}
    </div>
  );
}

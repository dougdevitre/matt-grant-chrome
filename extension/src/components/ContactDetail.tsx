import { useState } from "react";
import { api } from "../lib/api.js";
import { messageForError } from "../lib/errors.js";
import type { Contact, PollingPlace, VoteMethod } from "../lib/types.js";

const METHODS: { v: VoteMethod; label: string }[] = [
  { v: "early_in_person", label: "Early in person" },
  { v: "absentee", label: "Absentee / mail" },
  { v: "election_day", label: "Election day" },
];

// Per-contact GOTV detail: capture a vote plan, look up where they vote, and
// schedule a follow-up reminder. Rendered inline under a contact row.
export function ContactDetail({
  contact,
  onChanged,
}: {
  contact: Contact;
  onChanged: () => void;
}) {
  const [method, setMethod] = useState<VoteMethod | "">(contact.votePlan?.method ?? "");
  const [time, setTime] = useState(contact.votePlan?.time ?? "");
  const [needsRide, setNeedsRide] = useState(contact.votePlan?.needsRide ?? false);
  const [dueAt, setDueAt] = useState("");
  const [polling, setPolling] = useState<PollingPlace | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function savePlan() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.setVotePlan(contact.id, {
        method: method || null,
        time: time || null,
        needsRide,
        version: contact.version,
      });
      setMsg("Vote plan saved.");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadPolling() {
    setErr(null);
    try {
      setPolling(await api.pollingPlace(contact.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "polling_failed");
    }
  }

  async function schedule() {
    if (!dueAt) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.scheduleFollowUp(contact.id, { dueAt: new Date(dueAt).toISOString() });
      setMsg("Reminder scheduled.");
      setDueAt("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "schedule_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="contact-detail">
      <div className="field">
        <label className="field-label">Vote plan</label>
        <select
          className="select"
          value={method}
          onChange={(e) => setMethod(e.target.value as VoteMethod | "")}
        >
          <option value="">How will they vote?</option>
          {METHODS.map((m) => (
            <option key={m.v} value={m.v}>
              {m.label}
            </option>
          ))}
        </select>
        <input
          className="input"
          placeholder="When (e.g. before work)"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <label className="filter-toggle">
          <input
            type="checkbox"
            checked={needsRide}
            onChange={(e) => setNeedsRide(e.target.checked)}
          />{" "}
          Needs a ride to the polls
        </label>
        <button className="btn secondary" disabled={busy} onClick={savePlan}>
          Save plan
        </button>
      </div>

      <div className="field">
        <button className="btn secondary" onClick={loadPolling}>
          Where do they vote?
        </button>
        {polling ? (
          <div className="polling">
            {polling.address ? <div className="note">{polling.address}</div> : null}
            {polling.lea?.name ? (
              <div className="note">Election office: {polling.lea.name}</div>
            ) : null}
            <a href={polling.lookupUrl} target="_blank" rel="noopener">
              Official Missouri voter lookup ↗
            </a>
          </div>
        ) : null}
      </div>

      <div className="field">
        <label className="field-label">Follow-up reminder</label>
        <input
          className="input"
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
        <button className="btn secondary" disabled={busy || !dueAt} onClick={schedule}>
          Schedule
        </button>
      </div>

      {msg ? <div className="ok-note">{msg}</div> : null}
      {err ? <div className="warn" role="alert">{messageForError(err)}</div> : null}
    </div>
  );
}

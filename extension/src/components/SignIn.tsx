import { useState } from "react";
import { signInDev } from "../lib/api.js";
import type { Role } from "../lib/types.js";

const ROLES: { value: Role; label: string }[] = [
  { value: "registration_clerk", label: "Registration Clerk" },
  { value: "voter_contact_clerk", label: "Voter Contact Clerk" },
  { value: "list_data_clerk", label: "List & Data Clerk" },
  { value: "compliance_clerk", label: "Compliance Clerk" },
  { value: "events_clerk", label: "Events & Scheduler Clerk" },
  { value: "social_comms_clerk", label: "Social & Comms Clerk" },
  { value: "admin", label: "Campaign Admin" },
];

// Dev sign-in: exchanges a shared dev secret for a scoped token. In production
// this screen is replaced by the Clerk sign-in flow (AUTH_DRIVER=clerk).
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [base, setBase] = useState("http://localhost:8787");
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [role, setRole] = useState<Role>("registration_clerk");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = base.trim() && name.trim() && secret.trim() && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signInDev({
        base: base.trim().replace(/\/$/, ""),
        devSecret: secret.trim(),
        sub: name.trim(),
        role,
      });
      onSignedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "sign_in_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="hdr">
        <h1>Matt Grant — Clerk Tools</h1>
      </header>
      <p className="note">Sign in to load your queue and tools.</p>
      <div className="form">
        <label>
          Service URL
          <input value={base} onChange={(e) => setBase(e.target.value)} />
        </label>
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. jordan"
          />
        </label>
        <label>
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="select"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Access code
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <button className="btn" disabled={!canSubmit} onClick={submit}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        {error ? <div className="warn">Sign-in failed: {error}</div> : null}
      </div>
    </div>
  );
}

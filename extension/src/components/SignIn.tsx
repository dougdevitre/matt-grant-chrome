import { useEffect, useState } from "react";
import { DEFAULT_BASE, signInDev, signInClerk } from "../lib/api.js";
import { clerkEnabled } from "../lib/clerkConfig.js";
import { ClerkSignIn } from "./ClerkSignIn.js";
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

type Mode = "clerk" | "dev";

// Production sign-in uses a Clerk session token (role comes from the user's
// Clerk publicMetadata). The dev flow exchanges a shared secret + chosen role
// and is only honored when the service runs AUTH_DRIVER=dev.
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [mode, setMode] = useState<Mode>("clerk");
  // Default to the build-time service URL (the deployed backend for a production
  // build, localhost for dev) so a downloaded extension is zero-config. A value
  // explicitly saved in chrome.storage still wins — hydrate it below.
  const [base, setBase] = useState(DEFAULT_BASE);
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [role, setRole] = useState<Role>("registration_clerk");
  const [sessionToken, setSessionToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If the user previously saved an explicit Service URL, prefer it over the
  // build-time default (mirrors getBase() in api.ts).
  useEffect(() => {
    chrome.storage.local.get("apiBase").then(({ apiBase }) => {
      if (typeof apiBase === "string" && apiBase) setBase(apiBase);
    });
  }, []);

  const canSubmit =
    !!base.trim() &&
    !busy &&
    (mode === "dev" ? !!name.trim() && !!secret.trim() : !!sessionToken.trim());

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const b = base.trim().replace(/\/$/, "");
      if (mode === "dev") {
        await signInDev({ base: b, devSecret: secret.trim(), sub: name.trim(), role });
      } else {
        await signInClerk({ base: b, sessionToken: sessionToken.trim() });
      }
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
        <h1><img className="hdr-logo" src="icons/icon48.png" alt="" /> Matt Grant — Campaign Tools</h1>
      </header>
      <p className="note">Sign in to load your queue and tools.</p>

      <div className="tabs" role="tablist">
        <button
          className={mode === "clerk" ? "tab active" : "tab"}
          onClick={() => setMode("clerk")}
        >
          Clerk
        </button>
        <button
          className={mode === "dev" ? "tab active" : "tab"}
          onClick={() => setMode("dev")}
        >
          Dev
        </button>
      </div>

      <div className="form">
        <label>
          Service URL
          <input value={base} onChange={(e) => setBase(e.target.value)} />
        </label>

        {mode === "clerk" ? (
          clerkEnabled ? (
            <ClerkSignIn
              base={base.trim().replace(/\/$/, "")}
              onSignedIn={onSignedIn}
            />
          ) : (
            <label>
              Clerk session token
              <textarea
                className="textarea"
                value={sessionToken}
                placeholder="Paste your Clerk session token"
                onChange={(e) => setSessionToken(e.target.value)}
              />
            </label>
          )
        ) : (
          <>
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
          </>
        )}

        {/* Clerk's hosted widget submits itself; the manual button drives the
            Dev flow and the Clerk paste fallback. */}
        {mode === "clerk" && clerkEnabled ? null : (
          <>
            <button className="btn" disabled={!canSubmit} onClick={submit}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            {error ? <div className="warn">Sign-in failed: {error}</div> : null}
          </>
        )}
      </div>
    </div>
  );
}

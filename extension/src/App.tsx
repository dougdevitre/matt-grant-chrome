import { useCallback, useEffect, useState } from "react";
import "./styles.css";
import { api, signOut } from "./lib/api.js";
import { clerkSignOut } from "./lib/clerkSession.js";
import { ROLE_LABELS } from "./lib/rbac.js";
import type {
  ClerkIdentity,
  LocationInput,
  PhaseConfig,
  ResolveResponse,
  Role,
} from "./lib/types.js";
import { Countdown } from "./components/Countdown.js";
import { CompanionCard } from "./components/CompanionCard.js";
import { useActiveHost } from "./lib/useActiveHost.js";
import { LocationForm } from "./components/LocationForm.js";
import { ResourceCards } from "./components/ResourceCards.js";
import { TaskQueue } from "./components/TaskQueue.js";
import { Scheduler } from "./components/Scheduler.js";
import { ImportPanel } from "./components/ImportPanel.js";
import { CommsPanel } from "./components/CommsPanel.js";
import { TurnoutPanel } from "./components/TurnoutPanel.js";
import { SignIn } from "./components/SignIn.js";

type Tab = "local" | "tasks" | "schedule" | "import" | "comms" | "turnout";

export default function App() {
  const [me, setMe] = useState<ClerkIdentity | null>(null);
  // The signed-in account's real role (never the preview). Drives whether the
  // "View as" switcher shows and what the sign-out chip reports.
  const [realRole, setRealRole] = useState<Role | null>(null);
  const [viewAs, setViewAs] = useState<Role | null>(null);
  const [phase, setPhase] = useState<PhaseConfig | null>(null);
  const [data, setData] = useState<ResolveResponse | null>(null);
  const [tab, setTab] = useState<Tab>("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [ready, setReady] = useState(false);
  // Context-aware "Working here" card; dismissable for the session.
  const [companionHidden, setCompanionHidden] = useState(false);
  const activeHost = useActiveHost(!!me && !companionHidden);

  const load = useCallback(async (as?: Role | null) => {
    setError(null);
    try {
      const [identity, phaseConfig] = await Promise.all([
        api.me(as ?? undefined),
        api.phase(),
      ]);
      setMe(identity);
      // The server only sets viewAs on a preview response, so a plain response
      // is the real identity — the one source of truth for realRole.
      if (!identity.viewAs) setRealRole(identity.role);
      setPhase(phaseConfig);
      setNeedsAuth(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "load_failed";
      if (msg === "not_signed_in" || msg === "invalid_token") {
        setNeedsAuth(true);
      } else {
        setError(msg);
      }
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function resolve(input: LocationInput) {
    setBusy(true);
    setError(null);
    try {
      setData(await api.resolve(input));
      setPhase(await api.phase());
    } catch (e) {
      setError(e instanceof Error ? e.message : "resolve_failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await signOut();
    await clerkSignOut(); // also end the Clerk session (no-op when Clerk is off)
    setMe(null);
    setRealRole(null);
    setViewAs(null);
    setData(null);
    setNeedsAuth(true);
  }

  // Admin-only: re-fetch /me as another role to preview its view (null = own).
  function previewAs(role: Role | null) {
    setViewAs(role);
    load(role);
  }

  if (!ready) return <div className="app"><p className="note">Loading…</p></div>;
  if (needsAuth) return <SignIn onSignedIn={load} />;

  const county = data?.location.county ?? null;
  const zip = data?.location.zip ?? null;

  const scopes = me?.scopes ?? [];
  const canImport = scopes.includes("list.import");
  const canComms =
    scopes.includes("comms.draft") ||
    scopes.includes("comms.approve") ||
    scopes.includes("comms.send");
  const canRead = scopes.includes("voter.read");

  const tabs: { id: Tab; label: string }[] = [
    { id: "local", label: "Local" },
    { id: "tasks", label: "Tasks" },
    { id: "schedule", label: "Schedule" },
    ...(canRead ? [{ id: "turnout" as Tab, label: "Turnout" }] : []),
    ...(canImport ? [{ id: "import" as Tab, label: "Import" }] : []),
    ...(canComms ? [{ id: "comms" as Tab, label: "Comms" }] : []),
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "local";

  return (
    <div className="app">
      <header className="hdr">
        <h1><img className="hdr-logo" src="icons/icon48.png" alt="" /> Matt Grant — Campaign Tools</h1>
        {me ? (
          <button className="role-chip linklike" onClick={handleSignOut} title="Sign out">
            {ROLE_LABELS[realRole ?? me.role]} ·&nbsp;exit
          </button>
        ) : null}
      </header>

      {realRole === "admin" ? (
        <label className="viewas">
          <span className="viewas-label">View as</span>
          <select
            className="viewas-select"
            value={viewAs ?? ""}
            onChange={(e) => previewAs((e.target.value || null) as Role | null)}
          >
            <option value="">Admin (you)</option>
            {(Object.keys(ROLE_LABELS) as Role[])
              .filter((r) => r !== "admin")
              .map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
          </select>
        </label>
      ) : null}

      {me?.viewAs ? (
        <div className="preview-banner">
          Previewing as <strong>{ROLE_LABELS[me.role]}</strong> — actions still run as admin.{" "}
          <button className="linklike" onClick={() => previewAs(null)}>
            Back to my view
          </button>
        </div>
      ) : null}

      {phase ? <Countdown config={phase} /> : null}

      <CompanionCard
        host={activeHost}
        scopes={scopes}
        onDismiss={() => setCompanionHidden(true)}
      />

      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={activeTab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {activeTab === "local" ? (
        <>
          <LocationForm initial={data?.location} onResolve={resolve} busy={busy} />
          {error ? <div className="warn">Something went wrong: {error}</div> : null}
          {data ? <ResourceCards data={data} /> : null}
        </>
      ) : null}

      {activeTab === "tasks" && me ? <TaskQueue me={me} zip={zip} /> : null}
      {activeTab === "schedule" && me ? (
        <Scheduler me={me} county={county} zip={zip} />
      ) : null}
      {activeTab === "turnout" ? <TurnoutPanel /> : null}
      {activeTab === "import" ? <ImportPanel canRead={canRead} /> : null}
      {activeTab === "comms" && me ? <CommsPanel me={me} /> : null}
    </div>
  );
}

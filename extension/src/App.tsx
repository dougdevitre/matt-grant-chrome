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
} from "./lib/types.js";
import { Countdown } from "./components/Countdown.js";
import { LocationForm } from "./components/LocationForm.js";
import { ResourceCards } from "./components/ResourceCards.js";
import { TaskQueue } from "./components/TaskQueue.js";
import { Scheduler } from "./components/Scheduler.js";
import { ImportPanel } from "./components/ImportPanel.js";
import { CommsPanel } from "./components/CommsPanel.js";
import { SignIn } from "./components/SignIn.js";

type Tab = "local" | "tasks" | "schedule" | "import" | "comms";

export default function App() {
  const [me, setMe] = useState<ClerkIdentity | null>(null);
  const [phase, setPhase] = useState<PhaseConfig | null>(null);
  const [data, setData] = useState<ResolveResponse | null>(null);
  const [tab, setTab] = useState<Tab>("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [ready, setReady] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [identity, phaseConfig] = await Promise.all([api.me(), api.phase()]);
      setMe(identity);
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
    setData(null);
    setNeedsAuth(true);
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
    ...(canImport ? [{ id: "import" as Tab, label: "Import" }] : []),
    ...(canComms ? [{ id: "comms" as Tab, label: "Comms" }] : []),
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "local";

  return (
    <div className="app">
      <header className="hdr">
        <h1>Matt Grant — Clerk Tools</h1>
        {me ? (
          <button className="role-chip linklike" onClick={handleSignOut} title="Sign out">
            {ROLE_LABELS[me.role]} ·&nbsp;exit
          </button>
        ) : null}
      </header>

      {phase ? <Countdown config={phase} /> : null}

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
      {activeTab === "import" ? <ImportPanel canRead={canRead} /> : null}
      {activeTab === "comms" && me ? <CommsPanel me={me} /> : null}
    </div>
  );
}

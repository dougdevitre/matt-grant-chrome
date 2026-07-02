import { useCallback, useEffect, useState } from "react";
import "./styles.css";
import { api, signOut, DEFAULT_BASE } from "./lib/api.js";
import { clerkSignOut } from "./lib/clerkSession.js";
import { messageForError } from "./lib/errors.js";
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
import { useStoredFlag } from "./lib/useStoredFlag.js";
import { LocationForm } from "./components/LocationForm.js";
import { ResourceCards } from "./components/ResourceCards.js";
import { TaskQueue } from "./components/TaskQueue.js";
import { Scheduler } from "./components/Scheduler.js";
import { ImportPanel } from "./components/ImportPanel.js";
import { CommsPanel } from "./components/CommsPanel.js";
import { TurnoutPanel } from "./components/TurnoutPanel.js";
import { TeamPanel } from "./components/TeamPanel.js";
import { SignIn } from "./components/SignIn.js";

type Tab = "local" | "tasks" | "schedule" | "import" | "comms" | "turnout" | "team";

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
  // Context-aware "Working here" card — persistent preference (Settings toggle).
  const [showSiteTips, setShowSiteTips] = useStoredFlag("showSiteTips", true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const activeHost = useActiveHost(!!me && showSiteTips);
  // First-run welcome — default hidden until we've read storage (avoids a flash).
  const [onboardSeen, setOnboardSeen] = useState(true);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      setOnboardSeen(false);
      return;
    }
    chrome.storage.local
      .get("onboardingSeen")
      .then(({ onboardingSeen }) => setOnboardSeen(!!onboardingSeen));
  }, []);

  function dismissOnboard() {
    setOnboardSeen(true);
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.set({ onboardingSeen: true });
    }
  }

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
  const canManageTeam = scopes.includes("team.read");

  const tabs: { id: Tab; label: string }[] = [
    { id: "local", label: "Local" },
    { id: "tasks", label: "Tasks" },
    { id: "schedule", label: "Schedule" },
    ...(canManageTeam ? [{ id: "team" as Tab, label: "Team" }] : []),
    ...(canRead ? [{ id: "turnout" as Tab, label: "Turnout" }] : []),
    ...(canImport ? [{ id: "import" as Tab, label: "Import" }] : []),
    ...(canComms ? [{ id: "comms" as Tab, label: "Comms" }] : []),
  ];
  const activeTab = tabs.some((t) => t.id === tab) ? tab : "local";

  return (
    <div className="app">
      <header className="hdr">
        <h1><img className="hdr-logo" src="icons/icon48.png" alt="" /> Matt Grant — Campaign Tools</h1>
        <div className="hdr-right">
          {me ? (
            <button
              className="hdr-icon"
              onClick={() => setSettingsOpen((v) => !v)}
              title="Settings"
              aria-label="Settings"
              aria-expanded={settingsOpen}
            >
              ⚙
            </button>
          ) : null}
          <a
            className="hdr-help"
            href={`${DEFAULT_BASE}/guide/`}
            target="_blank"
            rel="noopener noreferrer"
            title="Open the user guide"
          >
            Help
          </a>
          {me ? (
            <button className="role-chip linklike" onClick={handleSignOut} title="Sign out">
              {ROLE_LABELS[realRole ?? me.role]} ·&nbsp;exit
            </button>
          ) : null}
        </div>
      </header>

      {settingsOpen ? (
        <div className="settings" role="group" aria-label="Settings">
          <label className="settings-row">
            <input
              type="checkbox"
              checked={showSiteTips}
              onChange={(e) => setShowSiteTips(e.target.checked)}
            />
            Show site tips (the "Working here" card on campaign sites)
          </label>
        </div>
      ) : null}

      {me && !onboardSeen ? (
        <div className="onboard" role="note">
          <button className="onboard-x" onClick={dismissOnboard} aria-label="Dismiss welcome">
            ×
          </button>
          <strong>Welcome to Campaign Tools 👋</strong>
          <p className="note">
            Start on <b>Local</b> — pick your county for voting info. Then work your{" "}
            <b>Tasks</b> and check <b>Turnout</b>. Stuck? The <b>Help</b> link up top opens the
            guide.
          </p>
        </div>
      ) : null}

      {realRole === "public" ? (
        <div className="role-note" role="note">
          You're signed in as <strong>Voter</strong> — you can see local voting info. To unlock clerk
          tools (Tasks, Turnout, Comms…), ask your campaign admin to assign your role.
        </div>
      ) : null}

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
        onDismiss={() => setShowSiteTips(false)}
      />

      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
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
          {error ? <div className="warn" role="alert">{messageForError(error)}</div> : null}
          {data ? <ResourceCards data={data} /> : null}
        </>
      ) : null}

      {activeTab === "tasks" && me ? <TaskQueue me={me} zip={zip} /> : null}
      {activeTab === "schedule" && me ? (
        <Scheduler me={me} county={county} zip={zip} />
      ) : null}
      {activeTab === "turnout" ? <TurnoutPanel /> : null}
      {activeTab === "team" ? <TeamPanel /> : null}
      {activeTab === "import" ? <ImportPanel canRead={canRead} /> : null}
      {activeTab === "comms" && me ? <CommsPanel me={me} /> : null}
    </div>
  );
}

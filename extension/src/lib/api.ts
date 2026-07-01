// Typed client for the matt-grant-chrome microservice. The bearer token is read
// from chrome.storage.local (set by your auth flow / Clerk integration). No
// secrets are bundled here.

import type {
  BatchResult,
  ClerkIdentity,
  Contact,
  EventWithShifts,
  FollowUp,
  GotvDashboard,
  ImportPreview,
  ImportResult,
  LocationInput,
  MessageTemplate,
  PhaseConfig,
  PollingPlace,
  ResolveResponse,
  Shift,
  Task,
  VoteMethod,
} from "./types.js";

// Baked in at build time so a downloaded extension talks to the deployed
// service with no configuration. A value saved in chrome.storage still wins
// (see getBase). Falls back to localhost for local dev / when unset.
const DEFAULT_BASE =
  import.meta.env.VITE_DEFAULT_SERVICE_URL || "http://localhost:8787";

async function getToken(): Promise<string | null> {
  const { authToken } = await chrome.storage.local.get("authToken");
  return typeof authToken === "string" ? authToken : null;
}

async function getBase(): Promise<string> {
  const { apiBase } = await chrome.storage.local.get("apiBase");
  return typeof apiBase === "string" && apiBase ? apiBase : DEFAULT_BASE;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken();
  if (!token) throw new Error("not_signed_in");
  const base = await getBase();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `http_${res.status}`);
  }
  return res;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await request(path, init)).json()) as T;
}

/** A paged list: the (possibly sliced) items plus the full count from the
 *  `X-Total-Count` header the server sets. */
export interface Page<T> {
  items: T[];
  total: number;
}

async function callList<T>(path: string, init?: RequestInit): Promise<Page<T>> {
  const res = await request(path, init);
  const items = (await res.json()) as T[];
  const total = Number(res.headers.get("X-Total-Count"));
  return { items, total: Number.isFinite(total) ? total : items.length };
}

export const api = {
  me: () => call<ClerkIdentity>("/me"),
  phase: () => call<PhaseConfig>("/phase"),
  resolve: (input: LocationInput) =>
    call<ResolveResponse>("/location/resolve", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // Tasks
  tasks: (zip?: string | null) =>
    call<Task[]>(`/tasks${zip ? `?zip=${encodeURIComponent(zip)}` : ""}`),
  claimTask: (id: string, version?: number) =>
    call<Task>(`/tasks/${id}/claim`, {
      method: "POST",
      body: JSON.stringify(version != null ? { version } : {}),
    }),
  completeTask: (id: string) =>
    call<Task>(`/tasks/${id}/complete`, { method: "POST", body: "{}" }),
  skipTask: (id: string, reason?: string) =>
    call<Task>(`/tasks/${id}/skip`, {
      method: "POST",
      body: JSON.stringify(reason ? { reason } : {}),
    }),

  // Scheduling
  events: (county?: string | null, zip?: string | null) => {
    const qs = new URLSearchParams();
    if (county) qs.set("county", county);
    if (zip) qs.set("zip", zip);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return call<EventWithShifts[]>(`/events${suffix}`);
  },
  claimShift: (shiftId: string, version?: number) =>
    call<Shift>(`/events/shifts/${shiftId}/claim`, {
      method: "POST",
      body: JSON.stringify(version != null ? { version } : {}),
    }),

  // Contacts
  contacts: (zip?: string | null, regStatus?: string | null) => {
    const qs = new URLSearchParams();
    if (zip) qs.set("zip", zip);
    if (regStatus) qs.set("regStatus", regStatus);
    const s = qs.toString() ? `?${qs.toString()}` : "";
    return call<Contact[]>(`/contacts${s}`);
  },
  // Paged variant: returns the slice + the full total (X-Total-Count).
  contactsPage: (opts: {
    limit: number;
    offset: number;
    zip?: string | null;
    regStatus?: string | null;
    voteStatus?: string | null;
    notVoted?: boolean;
  }) => {
    const qs = new URLSearchParams();
    qs.set("limit", String(opts.limit));
    qs.set("offset", String(opts.offset));
    if (opts.zip) qs.set("zip", opts.zip);
    if (opts.regStatus) qs.set("regStatus", opts.regStatus);
    if (opts.voteStatus) qs.set("voteStatus", opts.voteStatus);
    if (opts.notVoted) qs.set("notVoted", "true");
    return callList<Contact>(`/contacts?${qs.toString()}`);
  },

  // GOTV turnout dashboard (counts only).
  gotvDashboard: () => call<GotvDashboard>("/dashboard/gotv"),

  // GOTV: per-contact vote plan, polling place, follow-ups
  setVotePlan: (
    contactId: string,
    plan: {
      method?: VoteMethod | null;
      date?: string | null;
      time?: string | null;
      needsRide?: boolean;
      note?: string | null;
      version?: number;
    }
  ) =>
    call<{ status: string }>(`/contacts/${contactId}/vote-plan`, {
      method: "POST",
      body: JSON.stringify(plan),
    }),
  pollingPlace: (contactId: string) =>
    call<PollingPlace>(`/contacts/${contactId}/polling-place`),
  scheduleFollowUp: (
    contactId: string,
    input: { templateId?: string | null; dueAt: string; note?: string | null }
  ) =>
    call<FollowUp>(`/contacts/${contactId}/followups`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  followUpsDue: () => call<FollowUp[]>("/followups?due=now"),
  resolveFollowUp: (id: string, action: "done" | "cancel") =>
    call<FollowUp>(`/followups/${id}/${action}`, { method: "POST", body: "{}" }),

  // GOTV: batch send a template to not-yet-voted contacts
  sendBatch: (input: { templateId: string; zip?: string | null; limit?: number }) =>
    call<BatchResult>("/comms/send-batch", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  importPreview: (csv: string) =>
    call<ImportPreview>("/contacts/import/preview", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),
  importCommit: (csv: string) =>
    call<ImportResult>("/contacts/import/commit", {
      method: "POST",
      body: JSON.stringify({ csv }),
    }),
  sendToContact: (templateId: string, contactId: string, idempotencyKey: string) =>
    call<{ status: string }>("/comms/send-to-contact", {
      method: "POST",
      body: JSON.stringify({ templateId, contactId, idempotencyKey }),
    }),

  // Comms
  templates: () => call<MessageTemplate[]>("/comms/templates"),
  createTemplate: (input: {
    category: string;
    channel: string;
    subject?: string | null;
    body: string;
  }) =>
    call<MessageTemplate>("/comms/templates", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  approveTemplate: (id: string, approve: boolean) =>
    call<MessageTemplate>(`/comms/templates/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ approve }),
    }),
  send: (
    templateId: string,
    recipient: string,
    idempotencyKey: string,
    stepUpToken?: string
  ) =>
    call<{ status: string }>("/comms/send", {
      method: "POST",
      body: JSON.stringify({ templateId, recipient, idempotencyKey }),
      headers: stepUpToken ? { "X-StepUp-Token": stepUpToken } : {},
    }),
};

// --- Auth: exchange a credential for a scoped token (stored in chrome.storage) ---

export async function signInDev(opts: {
  base: string;
  devSecret: string;
  sub: string;
  role: string;
}): Promise<void> {
  const res = await fetch(`${opts.base}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      devSecret: opts.devSecret,
      sub: opts.sub,
      role: opts.role,
    }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as { token: string; expiresIn: number; role: string };
  await chrome.storage.local.set({
    apiBase: opts.base,
    authToken: data.token,
    tokenExpiresAt: Date.now() + data.expiresIn * 1000,
    authSub: opts.sub,
    authRole: data.role,
    authMode: "dev",
  });
}

/**
 * Production sign-in: exchange a Clerk session token for a scoped token. The
 * session token is also stored so SMS step-up can re-present it. (Acquiring the
 * Clerk session token client-side is a front-end integration; the backend
 * `/auth/token` already accepts `{ sessionToken }` when AUTH_DRIVER=clerk.)
 */
export async function signInClerk(opts: {
  base: string;
  sessionToken: string;
}): Promise<void> {
  const res = await fetch(`${opts.base}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken: opts.sessionToken }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as { token: string; expiresIn: number; role: string };
  await chrome.storage.local.set({
    apiBase: opts.base,
    authToken: data.token,
    tokenExpiresAt: Date.now() + data.expiresIn * 1000,
    authRole: data.role,
    authMode: "clerk",
    clerkSessionToken: opts.sessionToken,
  });
}

/** Which sign-in flow is active (drives the SMS step-up re-auth UI). */
export async function authMode(): Promise<"dev" | "clerk"> {
  const { authMode } = await chrome.storage.local.get("authMode");
  return authMode === "clerk" ? "clerk" : "dev";
}

/**
 * Step-up re-auth for a sensitive action (SMS). Returns an ephemeral token to
 * pass as X-StepUp-Token; not persisted. Dev driver only — the Clerk flow uses
 * a fresh session token instead of the access code.
 */
export async function stepUp(accessCode?: string): Promise<string> {
  const { apiBase, authSub, authRole, authMode, clerkSessionToken } =
    await chrome.storage.local.get([
      "apiBase",
      "authSub",
      "authRole",
      "authMode",
      "clerkSessionToken",
    ]);
  // Clerk re-presents the stored session token; dev re-presents the access code.
  const body =
    authMode === "clerk"
      ? { sessionToken: clerkSessionToken }
      : { devSecret: accessCode, sub: authSub, role: authRole };
  const res = await fetch(`${apiBase}/auth/step-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as { stepUpToken: string };
  return data.stepUpToken;
}

export async function signOut(): Promise<void> {
  await chrome.storage.local.remove([
    "authToken",
    "tokenExpiresAt",
    "authSub",
    "authRole",
    "authMode",
    "clerkSessionToken",
  ]);
}

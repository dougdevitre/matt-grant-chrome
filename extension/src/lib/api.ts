// Typed client for the matt-grant-chrome microservice. The bearer token is read
// from chrome.storage.local (set by your auth flow / Clerk integration). No
// secrets are bundled here.

import type {
  ClerkIdentity,
  Contact,
  EventWithShifts,
  ImportPreview,
  ImportResult,
  LocationInput,
  MessageTemplate,
  PhaseConfig,
  ResolveResponse,
  Shift,
  Task,
} from "./types.js";

async function getToken(): Promise<string | null> {
  const { authToken } = await chrome.storage.local.get("authToken");
  return typeof authToken === "string" ? authToken : null;
}

// The backend base URL comes from (1) the build-time VITE_API_BASE for
// production builds, then (2) the apiBase persisted at sign-in. There is no
// hardcoded fallback so a production build can never silently point at a
// developer's localhost.
async function getBase(): Promise<string> {
  const envBase = import.meta.env.VITE_API_BASE;
  if (envBase) return envBase;
  const { apiBase } = await chrome.storage.local.get("apiBase");
  if (typeof apiBase === "string" && apiBase) return apiBase;
  throw new Error("not_configured");
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
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
  return (await res.json()) as T;
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
  });
}

/**
 * Step-up re-auth for a sensitive action (SMS). Returns an ephemeral token to
 * pass as X-StepUp-Token; not persisted. Dev driver only — the Clerk flow uses
 * a fresh session token instead of the access code.
 */
export async function stepUp(devSecret: string): Promise<string> {
  const { apiBase, authSub, authRole } = await chrome.storage.local.get([
    "apiBase",
    "authSub",
    "authRole",
  ]);
  const res = await fetch(`${apiBase}/auth/step-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ devSecret, sub: authSub, role: authRole }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as { stepUpToken: string };
  return data.stepUpToken;
}

/**
 * Production sign-in: exchange a Clerk session token (obtained from the Clerk
 * SDK's getToken({ template })) for the app's short-lived scoped token. The
 * backend (AUTH_DRIVER=clerk) verifies the Clerk JWT against Clerk's JWKS and
 * derives the role from the user's publicMetadata.role claim.
 */
export async function signInClerk(sessionToken: string): Promise<void> {
  const base = await getBase();
  const res = await fetch(`${base}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error ?? `http_${res.status}`);
  }
  const data = (await res.json()) as {
    token: string;
    expiresIn: number;
    role: string;
  };
  await chrome.storage.local.set({
    apiBase: base,
    authToken: data.token,
    tokenExpiresAt: Date.now() + data.expiresIn * 1000,
    authRole: data.role,
  });
}

/**
 * Clerk step-up for a sensitive action (SMS): exchange a FRESH Clerk session
 * token for an ephemeral step-up token (admin-only, server-side). Mirrors
 * `stepUp` but for the Clerk auth mode.
 */
export async function stepUpClerk(sessionToken: string): Promise<string> {
  const base = await getBase();
  const res = await fetch(`${base}/auth/step-up`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionToken }),
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
  ]);
}

// The side panel mirrors the server RBAC for UI hiding only: a clerk sees the
// Import tab only with list.import, and the Comms tab only with a comms scope.
// (The server re-checks every call; this is cosmetic gating.)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "./App.js";
import { api } from "./lib/api.js";
import type { Scope } from "./lib/types.js";

// Mock the chrome-backed API client. Children import the same module, so they
// see these mocks too.
vi.mock("./lib/api.js", () => ({
  api: {
    me: vi.fn(),
    phase: vi.fn(),
    resolve: vi.fn(),
    tasks: vi.fn(),
    events: vi.fn(),
    contacts: vi.fn(),
    templates: vi.fn(),
  },
  signOut: vi.fn(),
  signInDev: vi.fn(),
  signInClerk: vi.fn(),
  authMode: vi.fn().mockResolvedValue("dev"),
  stepUp: vi.fn(),
}));

// App → SignIn → ClerkSignIn statically imports the Clerk SDK; stub it so tests
// don't load the real (browser-oriented) package. Clerk is disabled in tests
// (no VITE key), so SignIn isn't even rendered here.
vi.mock("@clerk/chrome-extension", () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  SignIn: () => null,
  useAuth: () => ({ isSignedIn: false, getToken: vi.fn() }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

const PHASE = {
  phase: "PHASE_1_REGISTER",
  label: "Register",
  primaryCta: "Register by Jul 8 at sos.mo.gov",
  nextDeadline: "2026-07-08T23:59:59-05:00",
};

async function renderAs(role: string, scopes: Scope[]) {
  vi.mocked(api.me).mockResolvedValue({ clerkId: "c1", role: role as never, scopes });
  vi.mocked(api.phase).mockResolvedValue(PHASE as never);
  render(<App />);
  // Wait for the async load to resolve and the panel to render.
  await screen.findByRole("button", { name: "Local" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("App tab gating", () => {
  it("always shows the base Local/Tasks/Schedule tabs", async () => {
    await renderAs("registration_clerk", [
      "voter.read",
      "voter.write",
      "contact.log",
      "comms.send_registration",
      "task.read",
      "task.write",
    ]);
    expect(screen.getByRole("button", { name: "Local" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Schedule" })).toBeInTheDocument();
    // registration_clerk has neither list.import nor a comms.draft/approve/send scope.
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comms" })).not.toBeInTheDocument();
  });

  it("shows Import only for a clerk with list.import", async () => {
    await renderAs("list_data_clerk", [
      "voter.read",
      "list.import",
      "list.tag",
      "task.read",
      "task.write",
    ]);
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Comms" })).not.toBeInTheDocument();
  });

  it("shows Comms only for a clerk with a comms scope", async () => {
    await renderAs("social_comms_clerk", [
      "comms.draft",
      "comms.send",
      "finance.read",
      "task.read",
      "task.write",
    ]);
    expect(screen.getByRole("button", { name: "Comms" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });
});

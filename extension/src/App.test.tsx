// The side panel mirrors the server RBAC for UI hiding only: a clerk sees the
// Import tab only with list.import, and the Comms tab only with a comms scope.
// (The server re-checks every call; this is cosmetic gating.)

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    // LocationForm (Local tab) fetches this on mount; empty → text-input fallback.
    locationOptions: vi.fn().mockResolvedValue({ counties: [] }),
    tasks: vi.fn(),
    events: vi.fn(),
    contacts: vi.fn(),
    templates: vi.fn(),
  },
  DEFAULT_BASE: "https://svc.example",
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
  await screen.findByRole("tab", { name: "Local" });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("App role explainer", () => {
  it("tells a Voter (public role) how to get access", async () => {
    await renderAs("public", ["voter.read"]);
    expect(
      screen.getByText(/ask your campaign admin to assign your role/i)
    ).toBeInTheDocument();
  });

  it("does not show the Voter explainer for a clerk role", async () => {
    await renderAs("registration_clerk", ["voter.read", "task.read", "task.write"]);
    expect(
      screen.queryByText(/ask your campaign admin to assign your role/i)
    ).not.toBeInTheDocument();
  });
});

describe("App settings + a11y", () => {
  it("opens Settings and toggles the site-tips preference", async () => {
    await renderAs("registration_clerk", ["voter.read", "task.read", "task.write"]);
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    const cb = screen.getByRole("checkbox", { name: /show site tips/i });
    expect(cb).toBeChecked();
    await userEvent.click(cb);
    expect(cb).not.toBeChecked();
  });

  it("marks the active tab with aria-selected", async () => {
    await renderAs("registration_clerk", ["voter.read", "task.read", "task.write"]);
    expect(screen.getByRole("tab", { name: "Local" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveAttribute("aria-selected", "false");
  });
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
    expect(screen.getByRole("tab", { name: "Local" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Schedule" })).toBeInTheDocument();
    // registration_clerk has neither list.import nor a comms.draft/approve/send scope.
    expect(screen.queryByRole("tab", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Comms" })).not.toBeInTheDocument();
  });

  it("shows Import only for a clerk with list.import", async () => {
    await renderAs("list_data_clerk", [
      "voter.read",
      "list.import",
      "list.tag",
      "task.read",
      "task.write",
    ]);
    expect(screen.getByRole("tab", { name: "Import" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Comms" })).not.toBeInTheDocument();
  });

  it("shows Comms only for a clerk with a comms scope", async () => {
    await renderAs("social_comms_clerk", [
      "comms.draft",
      "comms.send",
      "finance.read",
      "task.read",
      "task.write",
    ]);
    expect(screen.getByRole("tab", { name: "Comms" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Import" })).not.toBeInTheDocument();
  });
});

describe('App "View as" switcher (admin-only)', () => {
  const ADMIN_SCOPES: Scope[] = [
    "voter.read",
    "list.import",
    "comms.draft",
    "task.read",
    "task.write",
  ];
  const REG_SCOPES: Scope[] = [
    "voter.read",
    "voter.write",
    "contact.log",
    "comms.send_registration",
    "task.read",
    "task.write",
  ];

  // Emulate the server: /me?as=<role> returns that role's scopes + viewAs for an
  // admin; a plain /me returns the admin identity.
  function mockMeWithPreview() {
    vi.mocked(api.me).mockImplementation(async (as?: string) => {
      if (as === "registration_clerk") {
        return {
          clerkId: "c1",
          role: "registration_clerk",
          scopes: REG_SCOPES,
          viewAs: true,
        } as never;
      }
      return { clerkId: "c1", role: "admin", scopes: ADMIN_SCOPES } as never;
    });
    vi.mocked(api.phase).mockResolvedValue(PHASE as never);
  }

  it("hides the switcher for a non-admin", async () => {
    await renderAs("list_data_clerk", ["voter.read", "list.import", "task.read", "task.write"]);
    expect(screen.queryByRole("combobox", { name: /view as/i })).not.toBeInTheDocument();
  });

  it("previews a role: reshapes tabs, shows a banner, then restores", async () => {
    mockMeWithPreview();
    render(<App />);
    await screen.findByRole("tab", { name: "Local" });

    // Admin sees the switcher + the full tab set.
    const select = screen.getByRole("combobox", { name: /view as/i });
    expect(screen.getByRole("tab", { name: "Import" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Comms" })).toBeInTheDocument();

    // Preview as Registration Clerk → admin-only tabs disappear, banner appears.
    await userEvent.selectOptions(select, "registration_clerk");
    expect(await screen.findByText(/previewing as/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Comms" })).not.toBeInTheDocument();
    // The sign-out chip still reports the real role, not the preview.
    expect(screen.getByRole("button", { name: /Campaign Admin/ })).toBeInTheDocument();

    // Back to my view → full tab set returns, banner gone.
    await userEvent.click(screen.getByRole("button", { name: /back to my view/i }));
    expect(await screen.findByRole("tab", { name: "Comms" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Import" })).toBeInTheDocument();
    expect(screen.queryByText(/previewing as/i)).not.toBeInTheDocument();
  });
});

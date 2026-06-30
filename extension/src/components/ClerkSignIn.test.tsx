// The Clerk bridge: shows Clerk's hosted widget until signed in, then exchanges
// the Clerk session token for the backend's scoped JWT via signInClerk.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ClerkSignIn } from "./ClerkSignIn.js";
import { signInClerk } from "../lib/api.js";

let signedIn = false;
const getToken = vi.fn();

vi.mock("@clerk/chrome-extension", () => ({
  SignIn: () => <div>clerk-widget</div>,
  useAuth: () => ({ isSignedIn: signedIn, getToken }),
}));
vi.mock("../lib/api.js", () => ({ signInClerk: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../lib/clerkConfig.js", () => ({ JWT_TEMPLATE: "" }));

beforeEach(() => {
  vi.clearAllMocks();
  signedIn = false;
  getToken.mockResolvedValue("clerk-jwt-xyz");
});

describe("ClerkSignIn", () => {
  it("renders Clerk's widget while signed out", () => {
    signedIn = false;
    render(<ClerkSignIn base="http://localhost:8787" onSignedIn={vi.fn()} />);
    expect(screen.getByText("clerk-widget")).toBeInTheDocument();
  });

  it("exchanges the session token once signed in and notifies the parent", async () => {
    signedIn = true;
    const onSignedIn = vi.fn();
    render(<ClerkSignIn base="http://localhost:8787" onSignedIn={onSignedIn} />);

    await waitFor(() =>
      expect(signInClerk).toHaveBeenCalledWith({
        base: "http://localhost:8787",
        sessionToken: "clerk-jwt-xyz",
      })
    );
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
  });
});

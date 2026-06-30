// Sign-in supports two flows: Clerk (production, session token) by default, and
// Dev (shared secret + role). Smoke-tests both submit paths.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignIn } from "./SignIn.js";
import { signInDev, signInClerk } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  signInDev: vi.fn().mockResolvedValue(undefined),
  signInClerk: vi.fn().mockResolvedValue(undefined),
}));

// Clerk is disabled in tests (no VITE key) so the paste fallback renders; stub
// the SDK that ClerkSignIn imports so the real package isn't loaded.
vi.mock("@clerk/chrome-extension", () => ({
  SignIn: () => null,
  useAuth: () => ({ isSignedIn: false, getToken: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignIn — Clerk (default)", () => {
  it("submits a Clerk session token and notifies the parent", async () => {
    const onSignedIn = vi.fn();
    render(<SignIn onSignedIn={onSignedIn} />);

    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toBeDisabled(); // no token yet

    await userEvent.type(screen.getByLabelText("Clerk session token"), "clerk-jwt-123");
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(signInClerk).toHaveBeenCalledWith(
      expect.objectContaining({ sessionToken: "clerk-jwt-123" })
    );
    expect(onSignedIn).toHaveBeenCalled();
  });
});

describe("SignIn — Dev", () => {
  it("disables submit until name + access code are provided, then signs in", async () => {
    const onSignedIn = vi.fn();
    render(<SignIn onSignedIn={onSignedIn} />);

    await userEvent.click(screen.getByRole("button", { name: "Dev" }));
    const button = screen.getByRole("button", { name: "Sign in" });
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Your name"), "jordan");
    await userEvent.type(screen.getByLabelText("Access code"), "s3cret");
    expect(button).toBeEnabled();

    await userEvent.click(button);
    expect(signInDev).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "jordan", devSecret: "s3cret", role: "registration_clerk" })
    );
    expect(onSignedIn).toHaveBeenCalled();
  });
});

// Smoke test for the dev sign-in screen: the button stays disabled until the
// required fields are filled, and submitting calls the sign-in flow.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignIn } from "./SignIn.js";
import { signInDev } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  signInDev: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignIn", () => {
  it("disables submit until name + access code are provided", async () => {
    render(<SignIn onSignedIn={() => {}} />);
    const button = screen.getByRole("button", { name: "Sign in" });
    // Service URL is prefilled; name + access code are empty.
    expect(button).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Your name"), "jordan");
    await userEvent.type(screen.getByLabelText("Access code"), "s3cret");
    expect(button).toBeEnabled();
  });

  it("submits the entered credentials and notifies the parent", async () => {
    const onSignedIn = vi.fn();
    render(<SignIn onSignedIn={onSignedIn} />);

    await userEvent.type(screen.getByLabelText("Your name"), "jordan");
    await userEvent.type(screen.getByLabelText("Access code"), "s3cret");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInDev).toHaveBeenCalledWith(
      expect.objectContaining({ sub: "jordan", devSecret: "s3cret", role: "registration_clerk" })
    );
    expect(onSignedIn).toHaveBeenCalled();
  });
});

// The step-up flow must present a FRESH Clerk session token (they expire in
// ~60s); this bridge is how non-hook code mints one. Verify registration,
// pass-through, error swallowing, and unregistration.

import { describe, expect, it } from "vitest";
import {
  clerkFreshSessionToken,
  registerClerkGetToken,
} from "./clerkSession.js";

describe("clerkFreshSessionToken", () => {
  it("returns null when no provider is mounted", async () => {
    registerClerkGetToken(null);
    expect(await clerkFreshSessionToken()).toBeNull();
  });

  it("returns the token from the registered getter", async () => {
    registerClerkGetToken(async () => "fresh-token");
    expect(await clerkFreshSessionToken()).toBe("fresh-token");
    registerClerkGetToken(null);
  });

  it("swallows getter errors (falls back to null)", async () => {
    registerClerkGetToken(async () => {
      throw new Error("clerk exploded");
    });
    expect(await clerkFreshSessionToken()).toBeNull();
    registerClerkGetToken(null);
  });
});

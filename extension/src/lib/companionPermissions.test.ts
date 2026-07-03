import { afterEach, describe, expect, it, vi } from "vitest";
import manifest from "../../public/manifest.json";
import { COMPANION_ORIGINS } from "./companionSites.js";
import {
  requestCompanionHosts,
  removeCompanionHosts,
} from "./companionPermissions.js";

// Guards the split introduced for the Chrome Web Store submission: the companion
// "Working here" hosts must live in `optional_host_permissions` (runtime grant),
// and the runtime request (COMPANION_ORIGINS) must never ask for anything that
// isn't declared there — otherwise chrome.permissions.request() rejects, and the
// install-time review surface would creep back up.

const required = manifest.host_permissions as string[];
const optional = (manifest.optional_host_permissions ?? []) as string[];

describe("companion host permissions manifest lockstep", () => {
  it("keeps required install-time hosts to backend + Clerk only", () => {
    expect([...required].sort()).toEqual(
      [
        "http://localhost:8787/*",
        "https://clerk.mattgrantforcongress.org/*",
        "https://ezvnqn5e5i.us-east-1.awsapprunner.com/*",
      ].sort()
    );
  });

  it("keeps optional_host_permissions in exact lockstep with COMPANION_ORIGINS", () => {
    expect([...optional].sort()).toEqual([...COMPANION_ORIGINS].sort());
  });

  it("never lists a companion origin among the required host permissions", () => {
    for (const origin of COMPANION_ORIGINS) {
      expect(required).not.toContain(origin);
    }
  });

  it("does not request a wildcard App Runner host", () => {
    expect(required).not.toContain("https://*.awsapprunner.com/*");
  });
});

describe("requestCompanionHosts / removeCompanionHosts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats tips as usable when there is no permissions API", async () => {
    // chrome is undefined in the plain test env → nothing to gate on.
    expect(await requestCompanionHosts()).toBe(true);
  });

  it("requests exactly the companion origins and returns the grant result", async () => {
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("chrome", { permissions: { request } });
    expect(await requestCompanionHosts()).toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: COMPANION_ORIGINS });
  });

  it("returns false when the user denies", async () => {
    vi.stubGlobal("chrome", {
      permissions: { request: vi.fn().mockResolvedValue(false) },
    });
    expect(await requestCompanionHosts()).toBe(false);
  });

  it("revokes the companion origins on removal", async () => {
    const remove = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("chrome", { permissions: { remove } });
    await removeCompanionHosts();
    expect(remove).toHaveBeenCalledWith({ origins: COMPANION_ORIGINS });
  });
});

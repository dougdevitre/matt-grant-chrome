// Runtime grant/revoke for the companion "Working here" host access. These hosts
// live in the manifest's `optional_host_permissions` (not `host_permissions`),
// so a fresh install asks for NO social/Google/etc. access — the panel requests
// them only when the user turns on "site tips" in Settings. Keeps the install
// footprint (and the Chrome Web Store review surface) to just the backend + Clerk.

import { COMPANION_ORIGINS } from "./companionSites.js";

// True when the runtime permissions API is unavailable (tests, the Vite dev
// preview, any non-extension context) — there's nothing to grant there, so we
// treat the tips as usable and let `useActiveHost` no-op on its own guards.
function noPermsApi(): boolean {
  return typeof chrome === "undefined" || !chrome.permissions?.request;
}

/**
 * Ask the user to grant the companion host origins. Resolves true if granted
 * (or if there's no permissions API to gate on), false if the user declines.
 */
export async function requestCompanionHosts(): Promise<boolean> {
  if (noPermsApi()) return true;
  try {
    return await chrome.permissions.request({ origins: COMPANION_ORIGINS });
  } catch {
    return false;
  }
}

/** Revoke the companion host origins (best-effort; ignored where unsupported). */
export async function removeCompanionHosts(): Promise<void> {
  if (typeof chrome === "undefined" || !chrome.permissions?.remove) return;
  try {
    await chrome.permissions.remove({ origins: COMPANION_ORIGINS });
  } catch {
    /* best-effort — a failed revoke just leaves the (harmless) grant in place */
  }
}

// Build-time Clerk config. The publishable key is public (safe to ship in the
// bundle). Order: explicit `VITE_CLERK_PUBLISHABLE_KEY` → the production key for
// any production build → empty for local dev / CI, where the extension runs
// Clerk-disabled (Dev sign-in + the legacy paste fallback), so nothing local
// requires a key.
const PROD_PUBLISHABLE_KEY = "pk_live_Y2xlcmsubWF0dGdyYW50Zm9yY29uZ3Jlc3Mub3JnJA";

export const PUBLISHABLE_KEY: string =
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ||
  (import.meta.env.PROD ? PROD_PUBLISHABLE_KEY : "");

// Optional Clerk JWT template name that injects a `role` claim from
// `publicMetadata.role`. Leave unset if the default session token already
// carries the role (the backend reads `publicMetadata.role` then a top-level
// `role` claim — see docs/clerk-setup.md).
export const JWT_TEMPLATE: string = import.meta.env.VITE_CLERK_JWT_TEMPLATE ?? "";

/** True when a real publishable key is configured (enables in-panel Clerk auth). */
export const clerkEnabled: boolean = PUBLISHABLE_KEY.startsWith("pk_");

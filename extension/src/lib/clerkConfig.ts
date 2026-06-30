// Build-time Clerk config. The publishable key is public (safe to ship in the
// bundle) and is injected via Vite env (`VITE_CLERK_PUBLISHABLE_KEY`). When it's
// absent — local dev / CI — the extension runs Clerk-disabled: the Dev sign-in
// and the legacy paste fallback are used instead, so nothing requires a key.

export const PUBLISHABLE_KEY: string = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";

// Optional Clerk JWT template name that injects a `role` claim from
// `publicMetadata.role`. Leave unset if the default session token already
// carries the role (the backend reads `publicMetadata.role` then a top-level
// `role` claim — see docs/clerk-setup.md).
export const JWT_TEMPLATE: string = import.meta.env.VITE_CLERK_JWT_TEMPLATE ?? "";

/** True when a real publishable key is configured (enables in-panel Clerk auth). */
export const clerkEnabled: boolean = PUBLISHABLE_KEY.startsWith("pk_");

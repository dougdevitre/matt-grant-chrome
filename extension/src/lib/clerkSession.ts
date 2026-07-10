// A tiny bridge so non-hook code (App's sign-out handler, which also runs when
// Clerk is disabled) can trigger Clerk's signOut without calling a React hook.
// ClerkRoot registers the real function when a provider is mounted.

let signOutFn: (() => Promise<unknown>) | null = null;

export function registerClerkSignOut(fn: (() => Promise<unknown>) | null): void {
  signOutFn = fn;
}

/** Sign out of Clerk if a provider is mounted; no-op otherwise. Best-effort. */
export async function clerkSignOut(): Promise<void> {
  if (!signOutFn) return;
  try {
    await signOutFn();
  } catch {
    /* best-effort — clearing our own scoped token is what matters */
  }
}

let getTokenFn: (() => Promise<string | null>) | null = null;

export function registerClerkGetToken(fn: (() => Promise<string | null>) | null): void {
  getTokenFn = fn;
}

/**
 * A FRESH Clerk session token, or null when no provider is mounted / no
 * session. Clerk session JWTs are short-lived (~60s), so anything that
 * re-presents one to the backend (SMS step-up) must mint it at call time —
 * the token snapshotted at sign-in is long expired by then.
 */
export async function clerkFreshSessionToken(): Promise<string | null> {
  if (!getTokenFn) return null;
  try {
    return await getTokenFn();
  } catch {
    return null;
  }
}

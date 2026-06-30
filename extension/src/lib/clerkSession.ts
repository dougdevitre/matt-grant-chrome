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

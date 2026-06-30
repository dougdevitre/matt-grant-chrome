import { useEffect } from "react";
import type { ReactNode } from "react";
import { ClerkProvider, useClerk } from "@clerk/chrome-extension";
import { PUBLISHABLE_KEY, clerkEnabled } from "./clerkConfig.js";
import { registerClerkSignOut } from "./clerkSession.js";

// Exposes Clerk's signOut to non-hook code (App's sign-out handler) so signing
// out of the app also ends the Clerk session — otherwise the bridge would just
// auto-exchange a fresh token on the next render.
function SignOutBridge() {
  const { signOut } = useClerk();
  useEffect(() => {
    registerClerkSignOut(() => signOut());
    return () => registerClerkSignOut(null);
  }, [signOut]);
  return null;
}

// Wraps the app in Clerk's provider only when a publishable key is configured.
// Without one (local dev / CI) children render with no Clerk runtime, so the Dev
// sign-in path and the unit tests need no Clerk setup.
export function ClerkRoot({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} afterSignOutUrl="/index.html">
      <SignOutBridge />
      {children}
    </ClerkProvider>
  );
}

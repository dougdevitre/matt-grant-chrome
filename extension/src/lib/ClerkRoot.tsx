import { useEffect } from "react";
import type { ReactNode } from "react";
import { ClerkProvider, useAuth, useClerk } from "@clerk/chrome-extension";
import { JWT_TEMPLATE, PUBLISHABLE_KEY, clerkEnabled } from "./clerkConfig.js";
import { registerClerkGetToken, registerClerkSignOut } from "./clerkSession.js";

// Exposes Clerk's signOut and getToken to non-hook code. signOut: so signing
// out of the app also ends the Clerk session — otherwise the bridge would just
// auto-exchange a fresh token on the next render. getToken: so the SMS step-up
// can mint a FRESH session token at send time (Clerk session JWTs expire in
// ~60s; the one snapshotted at sign-in is long dead by the first send).
function SignOutBridge() {
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  useEffect(() => {
    registerClerkSignOut(() => signOut());
    registerClerkGetToken(() =>
      getToken(JWT_TEMPLATE ? { template: JWT_TEMPLATE } : undefined)
    );
    return () => {
      registerClerkSignOut(null);
      registerClerkGetToken(null);
    };
  }, [signOut, getToken]);
  return null;
}

// Wraps the app in Clerk's provider only when a publishable key is configured.
// Without one (local dev / CI) children render with no Clerk runtime, so the Dev
// sign-in path and the unit tests need no Clerk setup.
export function ClerkRoot({ children }: { children: ReactNode }) {
  if (!clerkEnabled) return <>{children}</>;
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl="/index.html"
      // In an extension the panel document is index.html; the default post-auth
      // redirect of "/" isn't a real file → ERR_FILE_NOT_FOUND (esp. OAuth).
      // Send every auth redirect back to the panel page instead.
      signInFallbackRedirectUrl="/index.html"
      signUpFallbackRedirectUrl="/index.html"
    >
      <SignOutBridge />
      {children}
    </ClerkProvider>
  );
}

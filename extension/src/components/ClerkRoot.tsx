import { useEffect, useState } from "react";
import {
  ClerkProvider,
  ClerkLoaded,
  ClerkLoading,
  SignIn as ClerkSignInWidget,
  useAuth,
  useClerk,
} from "@clerk/chrome-extension";
import App from "../App.js";
import { signInClerk, signOut as clearAppToken } from "../lib/api.js";

// Name of the Clerk JWT template that injects the role claim
// ({"role": "{{user.public_metadata.role}}"}). Configured in the Clerk Dashboard.
const JWT_TEMPLATE = "mattgrant";

/**
 * Production auth root (used when VITE_CLERK_PUBLISHABLE_KEY is set). Wraps the
 * app in Clerk, shows the Clerk sign-in until the user authenticates, then
 * exchanges the Clerk session token for the app's scoped token and renders App.
 * When the key is absent, main.tsx renders <App/> directly with the dev sign-in.
 */
export function ClerkRoot({ publishableKey }: { publishableKey: string }) {
  return (
    <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
      <ClerkLoading>
        <div className="app">
          <p className="note">Loading…</p>
        </div>
      </ClerkLoading>
      <ClerkLoaded>
        <Gate />
      </ClerkLoaded>
    </ClerkProvider>
  );
}

function Gate() {
  const { isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const [exchanged, setExchanged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function exchange() {
      if (!isSignedIn) {
        setExchanged(false);
        return;
      }
      try {
        const token = await getToken({ template: JWT_TEMPLATE });
        if (!token) throw new Error("no_clerk_token");
        await signInClerk(token);
        if (!cancelled) setExchanged(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "exchange_failed");
        }
      }
    }
    exchange();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken]);

  if (!isSignedIn) {
    return (
      <div className="app">
        <header className="hdr">
          <h1>Matt Grant — Clerk Tools</h1>
        </header>
        <p className="note">Sign in with your campaign account.</p>
        <ClerkSignInWidget />
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <header className="hdr">
          <h1>Matt Grant — Clerk Tools</h1>
        </header>
        <div className="warn">Sign-in failed: {error}</div>
        <button className="btn" onClick={() => clerk.signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  if (!exchanged) {
    return (
      <div className="app">
        <p className="note">Signing you in…</p>
      </div>
    );
  }

  // App owns its own sign-out: clear the app token AND end the Clerk session.
  return (
    <App
      onSignOut={async () => {
        await clearAppToken();
        await clerk.signOut();
      }}
    />
  );
}

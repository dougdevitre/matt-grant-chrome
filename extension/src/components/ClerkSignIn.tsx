import { useEffect, useRef, useState } from "react";
import { SignIn, useAuth } from "@clerk/chrome-extension";
import { signInClerk } from "../lib/api.js";
import { JWT_TEMPLATE } from "../lib/clerkConfig.js";
import { messageForError } from "../lib/errors.js";

// Renders Clerk's hosted sign-in inside the side panel. As soon as the user has
// a Clerk session, fetch the session token and exchange it for the backend's
// scoped JWT via the existing `signInClerk` flow, then notify the parent. The
// downstream token storage + SMS step-up path is unchanged.
export function ClerkSignIn({
  base,
  onSignedIn,
}: {
  base: string;
  onSignedIn: () => void;
}) {
  const { isSignedIn, getToken } = useAuth();
  const exchanged = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSignedIn || exchanged.current) return;
    exchanged.current = true; // exchange once per Clerk session
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const token = await getToken(JWT_TEMPLATE ? { template: JWT_TEMPLATE } : undefined);
        if (!token) throw new Error("no_session_token");
        await signInClerk({ base, sessionToken: token });
        if (!cancelled) onSignedIn();
      } catch (e) {
        if (!cancelled) {
          exchanged.current = false; // allow a retry on the next render
          // A fetch to the wrong/unreachable Service URL surfaces as a generic
          // "Failed to fetch" — name the URL so a bad Service URL is obvious.
          const raw = e instanceof Error ? e.message : "sign_in_failed";
          setError(
            /failed to fetch|networkerror|load failed/i.test(raw)
              ? `Couldn't reach the service at ${base}. Check the Service URL.`
              : messageForError(raw),
          );
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, getToken, base, onSignedIn]);

  if (isSignedIn) {
    return (
      <div className="form">
        <p className="note">{busy ? "Finishing sign-in…" : "Signed in to Clerk."}</p>
        {error ? <div className="warn">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="clerk-signin">
      <SignIn />
      {error ? <div className="warn">{error}</div> : null}
    </div>
  );
}

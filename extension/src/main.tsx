import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { ClerkRoot } from "./components/ClerkRoot.js";

// Auth mode is chosen at build time. With a Clerk publishable key, the extension
// uses the production Clerk sign-in flow; without one it keeps the dev sign-in,
// so local testing (docs/LOCAL_TESTING.md) works with zero Clerk setup.
const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {clerkKey ? <ClerkRoot publishableKey={clerkKey} /> : <App />}
  </StrictMode>
);

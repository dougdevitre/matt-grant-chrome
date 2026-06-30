import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.js";
import { ClerkRoot } from "./lib/ClerkRoot.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ClerkRoot>
      <App />
    </ClerkRoot>
  </StrictMode>
);

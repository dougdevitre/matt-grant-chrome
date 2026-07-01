/// <reference types="vite/client" />

// Typed build-time env for the extension (Vite injects `import.meta.env.VITE_*`).
interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_CLERK_JWT_TEMPLATE?: string;
  // Default backend URL baked into the build (the panel pre-fills it so a
  // downloaded extension needs no configuration). A stored value still wins.
  readonly VITE_DEFAULT_SERVICE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

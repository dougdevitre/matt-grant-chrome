/// <reference types="vite/client" />

// Typed build-time env for the extension (Vite injects `import.meta.env.VITE_*`).
interface ImportMetaEnv {
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  readonly VITE_CLERK_JWT_TEMPLATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

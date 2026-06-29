// Build-time configuration injected by Vite (see extension/.env.example).
interface ImportMetaEnv {
  /** Clerk publishable key. When set, the extension uses the Clerk sign-in
   *  flow; when unset, it falls back to the dev (shared-secret) sign-in. */
  readonly VITE_CLERK_PUBLISHABLE_KEY?: string;
  /** Backend base URL baked into a production build. Takes precedence over the
   *  runtime-configured apiBase. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

# Clerk auth setup (production sign-in)

In production the service verifies a **Clerk** session token instead of the dev shared secret.
The verifier (`ClerkVerifier` in `service/src/lib/identity.ts`) is already production-ready:
it fetches Clerk's JWKS, verifies the session token (RS256) against the configured issuer,
reads the clerk's **role**, and mints the short-lived scoped JWT the rest of the API consumes.
Scopes are **always derived server-side from the role** (`service/src/rbac.ts`) — the token
only needs to carry a trustworthy `role`. `assertSecureStartup` refuses to boot in production
unless `AUTH_DRIVER=clerk` (dev auth is forbidden) and `JWT_SECRET` is set to a non-default value.

## One-time Clerk setup

1. Create a Clerk application; note its **Frontend API / issuer** (e.g.
   `https://your-app.clerk.accounts.dev`) and **JWKS URL**
   (`<issuer>/.well-known/jwks.json`).
2. Give each clerk a **role** in Clerk **`publicMetadata.role`** — one of:
   `registration_clerk`, `voter_contact_clerk`, `list_data_clerk`, `compliance_clerk`,
   `events_clerk`, `social_comms_clerk`, `admin`. (Anyone without one of these is treated as
   `public` — civic info only, no clerk actions.)
3. Make sure the **session token carries the role**. The verifier reads
   `publicMetadata.role` first, then a top-level `role` claim — so either:
   - use the default session token (it includes `publicMetadata`), or
   - configure a Clerk **JWT template** that adds a `role` claim mapped from
     `{{user.public_metadata.role}}`.

## Environment / SSM

| Var | Value |
| --- | --- |
| `AUTH_DRIVER` | `clerk` |
| `CLERK_JWKS_URL` | `<issuer>/.well-known/jwks.json` |
| `CLERK_ISSUER` | the Clerk issuer URL |
| `CLERK_AUDIENCE` | *(optional)* if set, tokens must carry this `aud` claim |
| `JWT_SECRET` | strong secret for the minted scoped JWT (SSM SecureString) **secret** |
| `TOKEN_TTL_SECONDS` | scoped-token lifetime (default 3600) |

## Token exchange

The extension obtains a Clerk **session token** client-side, then exchanges it:

```
POST /auth/token   { "sessionToken": "<clerk session jwt>" }
  → { token, expiresIn, role }      # scoped JWT used as Bearer on every call
```

For admin-only SMS, the same Clerk session token is re-presented to `POST /auth/step-up` to
mint the short-lived `X-StepUp-Token`.

The extension now **auto-acquires** the session token via `@clerk/chrome-extension`: when a
publishable key is configured, the Clerk tab renders Clerk's hosted sign-in in the side panel,
then fetches the session token and exchanges it (no manual paste). SMS step-up is mode-aware:
Clerk re-presents the stored session token, dev re-presents the access code. Signing out of the
app also ends the Clerk session. When **no** publishable key is set, the build runs Dev-only and
the Clerk tab falls back to manual token paste — so local dev and CI need no Clerk.

## Extension setup (in-panel Clerk sign-in)

1. **Publishable key** (public — safe to ship). Set it at build time via Vite env: copy
   `extension/.env.example` → `extension/.env` and set
   `VITE_CLERK_PUBLISHABLE_KEY=pk_live_…`, then `npm run build:extension`. Optional
   `VITE_CLERK_JWT_TEMPLATE=<name>` if you use a JWT template to carry `role` (step 3 above).
2. **Allow-list the extension origin in Clerk.** Clerk's Frontend API rejects requests from an
   unknown origin, so add the extension's origin — `chrome-extension://<your-extension-id>` — to
   the instance's allowed origins (Clerk dashboard / Backend API). The ID is stable only if the
   manifest has a `key`; add a packed-extension `key` to `extension/public/manifest.json` (and
   thus a fixed ID) before allow-listing. Until then, re-allow-list whenever the unpacked ID
   changes.
3. **Manifest** already ships the Clerk CSP (`script-src 'self' 'wasm-unsafe-eval'`),
   `host_permissions` for `https://clerk.mattgrantforcongress.org/*`, and the `cookies`
   permission. Add your **deployed API origin** to `host_permissions` too (the panel fetches the
   service there).
4. **Live check:** load `extension/dist` in Chrome, open the side panel, sign in on the Clerk
   tab, and confirm `GET /me` returns the role's scopes and an SMS step-up re-auths. (This is the
   one step that can't run from the build sandbox — egress + a registered origin are required.)

## Verifying

Run the service with `AUTH_DRIVER=clerk` + the env above and exchange a real Clerk session
token at `POST /auth/token`; you should get back a scoped JWT whose `role` matches the user's
`publicMetadata.role`, and `GET /me` should report the server-derived scopes for that role.
The dev/Clerk verifier branch selection and the role→scope derivation are covered by the unit
tests (`identity` is exercised via the step-up tests; `rbac.test.ts` pins the scope matrix).
A live Clerk instance is required for an end-to-end check.

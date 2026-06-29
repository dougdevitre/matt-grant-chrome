# Production auth: Clerk sign-in + testing against a live URL

## Your production values (Matt Grant for Congress)

```
VITE_CLERK_PUBLISHABLE_KEY=pk_live_Y2xlcmsubWF0dGdyYW50Zm9yY29uZ3Jlc3Mub3JnJA
VITE_API_BASE=<your deployed backend URL>   # not deployed yet
```
Backend env / SSM:
```
AUTH_DRIVER=clerk
CLERK_ISSUER=https://clerk.mattgrantforcongress.org
CLERK_JWKS_URL=https://clerk.mattgrantforcongress.org/.well-known/jwks.json
SSM_PREFIX=/matt-grant-chrome/production
```
Still needed: the deployed backend URL, your extension ID (for Clerk
allowed_origins + backend ALLOWED_ORIGIN), the `mattgrant` JWT template, and
each user's `public_metadata.role`.

The extension supports two auth modes, chosen **at build time**:

- **Dev mode** (no `VITE_CLERK_PUBLISHABLE_KEY`): the name + shared-access-code
  sign-in. Used for local testing (`docs/LOCAL_TESTING.md`).
- **Clerk mode** (`VITE_CLERK_PUBLISHABLE_KEY` set): real Clerk sign-in. The
  extension gets a Clerk session token and exchanges it at the backend's
  `/auth/token`, which verifies it against Clerk's JWKS and derives the clerk's
  role from `publicMetadata.role`.

This guide gets you to a **live HTTPS URL with real Clerk auth**. The fastest
first target is a **deployed backend + a Clerk _development_ instance**
(`pk_test_…`, `*.clerk.accounts.dev`) — same code path as full production, no
custom-domain DNS. Going to `pk_live_…` later is just swapping keys and pointing
at your production Clerk Frontend API.

## 1. Deploy the backend (see `docs/DEPLOY.md`)

You need a public HTTPS URL for the service. Note it (e.g.
`https://matt-grant-service.onrender.com`).

## 2. Configure Clerk

1. Create a Clerk application (or use an existing one). Copy:
   - **Publishable key** (`pk_test_…` / `pk_live_…`)
   - **Frontend API URL** (e.g. `https://clerk.mattgrantforcongress.org`)
   - **JWKS URL** (`<frontend-api>/.well-known/jwks.json`) and **Issuer**
     (the Frontend API URL).
2. **JWT template** → create one named **`mattgrant`** with claims:
   ```json
   { "role": "{{user.public_metadata.role}}" }
   ```
   (The extension calls `getToken({ template: "mattgrant" })`; the backend reads
   the `role` claim.)
3. **Roles** → for each user, set **public metadata**:
   ```json
   { "role": "admin" }
   ```
   Valid roles: `admin`, `registration_clerk`, `voter_contact_clerk`,
   `list_data_clerk`, `compliance_clerk`, `events_clerk`, `social_comms_clerk`.
   (Anything else resolves to `public` with no clerk scopes.)
4. **Allowed origins** → add your extension origin
   `chrome-extension://<EXTENSION_ID>` (get the ID from step 4 below).

## 3. Backend env (on your deploy host)

```
NODE_ENV=production
AUTH_DRIVER=clerk
CLERK_JWKS_URL=https://clerk.mattgrantforcongress.org/.well-known/jwks.json
CLERK_ISSUER=https://clerk.mattgrantforcongress.org
JWT_SECRET=<a strong random secret>
ALLOWED_ORIGIN=chrome-extension://<EXTENSION_ID>
STORE_DRIVER=memory        # or airtable (+ AIRTABLE_PAT / AIRTABLE_BASE_ID)
```

The service refuses to boot in production unless `AUTH_DRIVER=clerk`,
`JWT_SECRET` is set and non-default, and `ALLOWED_ORIGIN` is pinned.

## 4. Stable extension ID (needed for Clerk allowed_origins)

Unpacked extensions get a random ID unless you pin one. To keep a stable ID:

1. Load `extension/dist/` unpacked once (`chrome://extensions` → Developer mode
   → Load unpacked) and copy the generated **ID**, **or** pack it (`Pack
   extension`) to get a `.pem` and add the derived public key as a top-level
   `"key"` in `extension/public/manifest.json`.
2. Use that `chrome-extension://<ID>` in Clerk **allowed_origins** and in the
   backend `ALLOWED_ORIGIN`.

(After you publish the Unlisted item, the Web Store assigns a permanent ID — use
that one for the production Clerk instance.)

## 5. Build the extension in Clerk mode

```bash
cp extension/.env.example extension/.env
# edit extension/.env:
#   VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
#   VITE_API_BASE=https://matt-grant-service.onrender.com
npm run build:extension
```

Also pin both hosts in `extension/public/manifest.json` `host_permissions`:
```json
"host_permissions": [
  "https://matt-grant-service.onrender.com/*",
  "https://clerk.mattgrantforcongress.org/*"
]
```
then rebuild.

## 6. Test the live path

1. Reload the unpacked extension, open the side panel.
2. You should see the **Clerk** sign-in. Sign in with a user that has a `role`
   in public metadata.
3. Confirm: the app loads, the role chip matches, RBAC tabs match the role, and
   a write action (claim a task) succeeds against the live backend.

## Notes / known follow-ups

- **SMS step-up under Clerk:** `api.ts` exposes `stepUpClerk(sessionToken)`, but
  the Comms SMS UI still calls the dev `stepUp`. SMS also needs Twilio configured,
  so wiring the Comms panel to fetch a fresh Clerk token is a follow-up before
  live SMS sends. Sign-in, tasks, scheduling, import, and template draft/approve
  are unaffected.
- Going to **full production**: swap to `pk_live_…`, set the backend
  `CLERK_*` to your production Frontend API (custom domain), and use the Web
  Store-assigned extension ID in Clerk allowed_origins.

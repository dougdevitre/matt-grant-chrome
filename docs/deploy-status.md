# Deploy status & handoff (production)

Snapshot of how far the **production deploy** of the clerk-tool service has gotten, and the
exact steps left. The application itself is finished and merged on `main` (CI green); what
remains is standing up the AWS runtime. Anyone with AWS + Airtable + Clerk admin access can
finish steps 1–3 below in ~10–15 minutes. See `docs/deploy.md` for the full reference and
`docs/clerk-setup.md` / `docs/airtable-setup.md` for provider details.

## ✅ Done

- **App code** — fully merged to `main`, CI green (tests + typecheck + build + docker-build + audit).
- **Airtable storage base** — created with all 9 required tables (`Tasks`, `Events`, `Shifts`,
  `Templates`, `Contacts`, `ContactLogs`, `OptOut`, `Outbox`, `Audit`), each with the
  `Data` blob + the filter columns the adapter needs. **Base id: `appkOfv2eLaDMAjPu`**
  ("Matt Grant for Congress - Clerk Tool Storage").
- **AWS Parameter Store** (`/matt-grant-chrome/prod`, **us-east-1**) holds:
  `JWT_SECRET`, `CLERK_ISSUER`, `CLERK_JWKS_URL`, `AIRTABLE_BASE_ID`. (SecureString for secrets.)
- **IAM instance role** — `matt-grant-apprunner-instance`, trusted by
  `tasks.apprunner.amazonaws.com`, granting `ssm:GetParameter*` on
  `/matt-grant-chrome/prod/*` + `kms:Decrypt`.
- **App Runner service** — partially configured in the console (us-east-1): source = GitHub
  `dougdevitre/matt-grant-chrome` @ `main`; runtime Nodejs 22; build
  `npm ci && npm run build:service`; start `node service/dist/index.js`; port `8787`;
  env vars `NODE_ENV=production`, `AUTH_DRIVER=clerk`, `SSM_PREFIX=/matt-grant-chrome/prod`,
  `ALLOWED_ORIGIN=chrome-extension://placeholder`; instance role selected. **Not yet created**
  — the GitHub source connection wasn't finished (see step 1).

## ▫️ Remaining — 3 steps

### 1. Finish creating the App Runner service
The blocker was the **GitHub source connection** (an `aws apprunner create-service` CLI attempt
failed with `connection ARN ... 'None'` — i.e. no `AVAILABLE` connection). Easiest fix is the
console, which completes the GitHub handshake for you:

1. **App Runner** (us-east-1) → if a `matt-grant-clerk-service` draft exists, open it; else
   **Create service** with the settings listed under "Done" above.
2. Under Source, **add/authorize the GitHub connection** ("AWS Connector for GitHub") for
   `dougdevitre/matt-grant-chrome`, branch `main`. Confirm the connection shows **Available**
   (App Runner → Settings → GitHub connections).
3. **Next → Create & deploy.** First build ≈ 5–10 min.
4. Copy the **Default domain** → that's the service URL. Verify:
   `curl https://<url>/health` → `{"ok":true}`.

### 2. Turn on Airtable persistence
Until this is done the service runs on its in-memory store (data resets on each deploy).

1. Create an **Airtable Personal Access Token** with scopes `data.records:read`,
   `data.records:write`, `schema.bases:read`, scoped to base **`appkOfv2eLaDMAjPu`**.
2. Store it (CloudShell):
   ```bash
   read -rs AIRTABLE_PAT && echo
   aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
     --name /matt-grant-chrome/prod/AIRTABLE_PAT --value "$AIRTABLE_PAT" && unset AIRTABLE_PAT
   ```
3. Add env var **`STORE_DRIVER=airtable`** to the App Runner service and redeploy.
   `curl https://<url>/ready` → `200` confirms Airtable connected (503 = bad/missing PAT,
   wrong base id, or PAT lacks access to the base).

### 3. Connect the extension
1. `npm run build:extension` → load `extension/dist` in Chrome (Developer mode → Load unpacked).
2. Copy the extension's **ID** from `chrome://extensions`.
3. Set App Runner env **`ALLOWED_ORIGIN=chrome-extension://<that-id>`** (replacing the
   placeholder) and redeploy.
4. In **Clerk**, allow-list that same `chrome-extension://<id>` origin, and set each clerk's
   **`publicMetadata.role`** (one of the roles in `docs/clerk-setup.md`).
5. In the side panel, set the **Service URL** to the App Runner URL and sign in via Clerk.

## Notes

- The four env vars (`NODE_ENV`, `AUTH_DRIVER`, `SSM_PREFIX`, `ALLOWED_ORIGIN`) are read
  directly from the environment, **not** from Parameter Store — `SSM_PREFIX` is the pointer to
  Parameter Store, so it must be an env var. Only secrets live in Parameter Store.
- The service **refuses to boot** in production on an insecure config (missing `JWT_SECRET`,
  `AUTH_DRIVER≠clerk`, `ALLOWED_ORIGIN=*`, or a selected driver missing its creds). A failed
  boot with a clear log line is the safety net working — read the App Runner logs.
- Single instance is fine; for multi-instance set `REDIS_URL` (+ `REQUIRE_SHARED_STATE=true`)
  so the SMS daily cap and rate limiter stay shared (see `docs/deploy.md`).

## Going live for real users (production onboarding)

Live service URL: **`https://ezvnqn5e5i.us-east-1.awsapprunner.com`** — baked into production
extension builds by default (`extension/src/lib/api.ts`), so a downloaded copy needs no config.
Stable extension id: **`abalnefilpmcfbabfaljnophamaegfgj`** (from the pinned manifest `key`).

**1. Clerk Dashboard (enables in-panel sign-in).**
- **Configure → Native applications → enable the Native API.** Without this the extension shows
  *"The Native API is disabled for this instance."* (Chrome extensions are "native" apps to Clerk.)
- **Configure → Domains:** a production instance must have a domain associated (even with no web app).
- Allow-list the extension origin `chrome-extension://abalnefilpmcfbabfaljnophamaegfgj`.
- **Configure → API keys:** copy the **Publishable key** (`pk_live_…`) and the **Frontend API URL**.
  `CLERK_ISSUER` = that Frontend API URL; `CLERK_JWKS_URL` = `<issuer>/.well-known/jwks.json`.

**2. Extension build must bake Clerk on (public values).** The download is packed from
`npm run build:extension` (production mode) — set in the build env so the bundle enables Clerk:
`VITE_CLERK_PUBLISHABLE_KEY=pk_live_…` (and optional `VITE_CLERK_JWT_TEMPLATE`). The service URL is
already baked; override with `VITE_DEFAULT_SERVICE_URL` only for the custom subdomain later.
The App Runner **build command must build + pack the extension** for `/download` to update, e.g.
`npm ci && npm run build && node service/scripts/pack-extension.mjs`.

**3. Parameter Store — SSM SecureString at `/matt-grant-chrome/prod/<KEY>` (CloudShell).**
```bash
REGION=us-east-1; PREFIX=/matt-grant-chrome/prod
put(){ aws ssm put-parameter --region "$REGION" --overwrite --type "$1" --name "$PREFIX/$2" --value "$3"; }
put String CLERK_ISSUER   "https://<your-frontend-api>"
put String CLERK_JWKS_URL "https://<your-frontend-api>/.well-known/jwks.json"
put String AIRTABLE_BASE_ID "appkOfv2eLaDMAjPu"
read -rs JWT_SECRET;       echo; put SecureString JWT_SECRET       "$JWT_SECRET";       unset JWT_SECRET
read -rs CONTACT_KEY_SALT; echo; put SecureString CONTACT_KEY_SALT "$CONTACT_KEY_SALT"; unset CONTACT_KEY_SALT
read -rs AIRTABLE_PAT;     echo; put SecureString AIRTABLE_PAT     "$AIRTABLE_PAT";     unset AIRTABLE_PAT
# generate secrets with: openssl rand -hex 32 ; optional: TWILIO_* (SMS), CENSUS_API_KEY, FEC_API_KEY
```

**4. App Runner env vars (not SSM):** `NODE_ENV=production`, `AUTH_DRIVER=clerk`,
`SSM_PREFIX=/matt-grant-chrome/prod`, `STORE_DRIVER=airtable`,
`ALLOWED_ORIGIN=chrome-extension://abalnefilpmcfbabfaljnophamaegfgj`.

**5. Per new user:** share the download page → they install + sign in → an admin sets their
`publicMetadata.role` in Clerk (or bulk via `scripts/set-clerk-roles.mjs`).

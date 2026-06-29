# Deploying the backend (`service/`)

The extension needs a public **HTTPS** URL for the backend. The service is a
stateless Express app (`service/src/index.ts`); `npm run build --workspace
service` compiles to `service/dist/`, and `node service/dist/index.js` runs it.

It refuses to boot in production unless: `AUTH_DRIVER=clerk`, `JWT_SECRET` set and
non-default, `ALLOWED_ORIGIN` pinned (not `*`), and — if `SMS_DRIVER=twilio` —
Twilio creds present. See `service/src/config.ts` (`assertSecureStartup`).

## Required env (all hosts)

```
NODE_ENV=production
AUTH_DRIVER=clerk
CLERK_JWKS_URL=https://<slug>.clerk.accounts.dev/.well-known/jwks.json
CLERK_ISSUER=https://<slug>.clerk.accounts.dev
JWT_SECRET=<strong random>
ALLOWED_ORIGIN=chrome-extension://<EXTENSION_ID>
STORE_DRIVER=memory            # or airtable (+ AIRTABLE_PAT, AIRTABLE_BASE_ID)
PORT=8787
```

## Option A — Render (recommended, simplest)

A `service/render.yaml` blueprint is included. In Render: **New + → Blueprint →**
select this repo. Fill the `sync:false` vars (`CLERK_JWKS_URL`, `CLERK_ISSUER`,
`ALLOWED_ORIGIN`) in the dashboard; `JWT_SECRET` is auto-generated. Render gives
you `https://<name>.onrender.com` — that's your `VITE_API_BASE`.

## Option B — Fly.io

```bash
fly launch --no-deploy        # creates fly.toml
fly secrets set JWT_SECRET=... CLERK_JWKS_URL=... CLERK_ISSUER=... ALLOWED_ORIGIN=...
fly deploy
```
Use a Node 20 Dockerfile that runs `npm ci && npm run build --workspace service`
and starts `node service/dist/index.js` (internal port 8787).

## Option C — AWS (Lambda+API Gateway or Fargate)

Matches the SSM/IAM model already in the README: load secrets from SSM
SecureString under `SSM_PREFIX` with least-privilege `ssm:GetParameter`. Wrap the
Express app with `@codegenie/serverless-express` for Lambda, or containerize for
Fargate. Front with HTTPS and pin `ALLOWED_ORIGIN`.

### Set up Parameter Store

The service resolves each config value as `${SSM_PREFIX}/<NAME>` (with
decryption), falling back to plain env vars. Pick a prefix and use it
consistently — set `SSM_PREFIX` on the running service to match.

```bash
REGION=us-east-1
PFX=/matt-grant-chrome/prod        # set SSM_PREFIX to this exact value

# --- check what already exists (names only, no secret values) ---
aws ssm get-parameters-by-path --region $REGION \
  --path /matt-grant-chrome --recursive --query 'Parameters[].Name' --output text

# --- auth (required) ---
aws ssm put-parameter --region $REGION --name $PFX/CLERK_ISSUER   --type String \
  --value "https://<slug>.clerk.accounts.dev"
aws ssm put-parameter --region $REGION --name $PFX/CLERK_JWKS_URL --type String \
  --value "https://<slug>.clerk.accounts.dev/.well-known/jwks.json"
aws ssm put-parameter --region $REGION --name $PFX/JWT_SECRET --type SecureString \
  --value "$(openssl rand -hex 32)"

# --- optional drivers (only if used) ---
# aws ssm put-parameter --region $REGION --name $PFX/AIRTABLE_PAT --type SecureString --value "..."
# aws ssm put-parameter --region $REGION --name $PFX/AIRTABLE_BASE_ID --type String --value "appiuSYCexFUmGIOr"
# aws ssm put-parameter --region $REGION --name $PFX/TWILIO_AUTH_TOKEN --type SecureString --value "..."
```

> `ALLOWED_ORIGIN`, `NODE_ENV`, `AUTH_DRIVER`, `STORE_DRIVER`, `SSM_PREFIX` are
> set as plain runtime env vars (not secrets), not in Parameter Store.

Grant the runtime IAM role least-privilege read on just this prefix:

```json
{
  "Effect": "Allow",
  "Action": ["ssm:GetParameter", "ssm:GetParametersByPath"],
  "Resource": "arn:aws:ssm:us-east-1:<ACCOUNT_ID>:parameter/matt-grant-chrome/*"
}
```

`ParameterNotFound` at runtime is non-fatal — the service falls back to the env
var of the same name; but for an AWS deploy create the parameters above so the
secrets stay out of the environment.

## After deploy

1. `curl https://<your-host>/health` → `{"ok":true}`.
2. Put the URL in `extension/.env` as `VITE_API_BASE` and in the manifest
   `host_permissions`, then rebuild (see `docs/PRODUCTION_AUTH.md`).

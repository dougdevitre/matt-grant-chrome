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

## After deploy

1. `curl https://<your-host>/health` → `{"ok":true}`.
2. Put the URL in `extension/.env` as `VITE_API_BASE` and in the manifest
   `host_permissions`, then rebuild (see `docs/PRODUCTION_AUTH.md`).

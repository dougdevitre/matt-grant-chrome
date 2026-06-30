# Deploying the microservice

The service is a stateless Express app — it holds no session state (the store is Airtable or
in-memory), so it scales horizontally behind any load balancer. It boots with
`assertSecureStartup()` (`service/src/config.ts`), which **refuses to start** in production on
an insecure config: a default/missing `JWT_SECRET`, `AUTH_DRIVER` other than `clerk`,
`ALLOWED_ORIGIN=*`, or a selected provider driver (Twilio/Airtable/Google) missing its
credentials. Treat a failed boot as the safety net working.

## Configuration

Every value resolves via `getConfig()` — **SSM SecureString first, then env var**. Use
`service/.env.example` as the full list; in production put all secrets in SSM under one prefix
and set `SSM_PREFIX` (e.g. `/matt-grant-chrome/prod`). Minimum production set:

- `NODE_ENV=production`, `JWT_SECRET` (strong), `AUTH_DRIVER=clerk` (+ `CLERK_JWKS_URL`,
  `CLERK_ISSUER`), `ALLOWED_ORIGIN=<extension origin(s)>`.
- Provider drivers as needed: `STORE_DRIVER=airtable` (+`AIRTABLE_PAT`),
  `SMS_DRIVER=twilio` (+ Twilio vars + `TWILIO_WEBHOOK_URL`), `CALENDAR_DRIVER=google` /
  `MAILER_DRIVER=gmail` (+ `GOOGLE_SA_*`). See `docs/airtable-setup.md`, `docs/google-oauth-setup.md`.

### Least-privilege IAM (SSM read-only on the prefix)

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
    "Resource": "arn:aws:ssm:<region>:<account>:parameter/matt-grant-chrome/prod/*"
  }, {
    "Effect": "Allow",
    "Action": "kms:Decrypt",
    "Resource": "<the KMS key ARN used for the SecureStrings>"
  }]
}
```

## Option A — Docker (Fargate / any container host)

```bash
docker build -t matt-grant-chrome-service .
docker run -p 8787:8787 \
  -e NODE_ENV=production -e JWT_SECRET=… -e AUTH_DRIVER=clerk \
  -e ALLOWED_ORIGIN=chrome-extension://<id> -e SSM_PREFIX=/matt-grant-chrome/prod \
  matt-grant-chrome-service
```

The root `Dockerfile` builds the service and ships a slim production image (`node:20-slim`,
runs as the non-root `node` user). On Fargate: attach the IAM task role above, set env/secrets,
expose `8787` behind an ALB, and point the **liveness** check at `GET /health` and the
**readiness** check at `GET /ready` (200 when the store is constructable, else 503). Front with
HTTPS (ACM cert on the ALB); the app emits HSTS in production. It logs structured JSON
(`LOG_LEVEL`, default `info`), tags each request with `X-Request-Id` (honoring an inbound one
from the gateway), and shuts down gracefully on `SIGTERM` (drains in-flight requests, 10s cap).

## Option B — Lambda + API Gateway

Wrap the exported app with an adapter — `app` is already exported from
`service/src/index.ts` and `listen()` only runs as the main module, so importing it in a
handler binds no port:

```ts
import serverlessExpress from "@vendia/serverless-express";
import { app } from "./index.js";
export const handler = serverlessExpress({ app });
```

Add `@vendia/serverless-express` (or `serverless-http`) as a dependency, give the function the
IAM policy above, and set env/secrets on the function. API Gateway forwards `X-Forwarded-For`,
which the per-IP rate limiter (`lib/ratelimit.ts`) already reads.

## CORS & headers

`ALLOWED_ORIGIN` pins the allowed origin(s) (comma-separated); methods are limited to
`GET`/`POST` and allowed headers to `Authorization`, `Content-Type`, `X-StepUp-Token`,
`X-Twilio-Signature`. Baseline security headers (`nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, HSTS in prod) are applied globally (`lib/securityHeaders.ts`),
and `x-powered-by` is disabled.

## After deploy

- Point the extension's service URL at the HTTPS endpoint. The extension manifest already grants
  host access to `https://*.awsapprunner.com/*` (App Runner) and `http://localhost:8787/*`, so an
  App Runner URL needs no rebuild. Deploying elsewhere? Add that exact origin to the manifest's
  `host_permissions` and rebuild.
- If using Twilio, set the Messaging Service inbound webhook to `<url>/twilio/inbound` and set
  `TWILIO_WEBHOOK_URL` to that exact URL (the signature check depends on it).
- **Multi-instance:** the rate limiter and the **SMS daily cap** are per-process by default.
  Running more than one instance without a shared backend multiplies them — most importantly the
  SMS cap (N instances → N× the spend ceiling). Set `REDIS_URL` so both use Redis, and set
  `REQUIRE_SHARED_STATE=true` to make the service refuse to boot multi-instance without it. A
  single instance needs neither.

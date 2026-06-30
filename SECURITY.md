# Security notes

This service handles voter PII and sends SMS/email under TCPA/FEC rules, so the security
posture matters. This file records the controls in place, the hardening from the security
review, and the residual risks an operator must own before go-live.

## Controls in place

- **Auth:** Clerk session tokens are verified RS256 against the configured issuer/JWKS; the
  service then mints a short-lived HS256 scoped token. JWT verification pins algorithms
  (`HS256` for our tokens, `RS256` for Clerk) so a token signed with another scheme is rejected.
  Scopes are always derived server-side from the role — never trusted from the token.
- **RBAC:** least-privilege role→scope matrix (`service/src/rbac.ts`); every mutating route is
  scope-gated. SMS is admin-only and additionally requires a step-up token bound to the caller.
- **SMS:** kill switch + daily cap, per-clerk rate limit, consent enforced, opaque recipient
  keys, PII-safe logging (phone masked, body never logged).
- **Twilio inbound:** HMAC-SHA1 signature verified with `timingSafeEqual` against the
  configured webhook URL (not the request Host); fails closed if the token/URL is unset.
- **Audit:** tamper-evident SHA-256 hash chain built by **every** store adapter (memory and
  Airtable) via shared `auditChain.ts`, with a sequence number in the hashed material; the
  `GET /audit/verify` route (audit.read) recomputes the chain in-app.
- **Boot guard:** `assertSecureStartup` refuses to start in production on a default/missing
  `JWT_SECRET`, non-Clerk auth, `ALLOWED_ORIGIN=*`, or a provider driver missing its creds. It
  runs at module load, so it also covers serverless deployments that import `app`.
- **Transport:** pinned CORS (methods + headers), baseline security headers + HSTS in prod,
  `x-powered-by` disabled, body size limits.

## Hardening from the security review

- **JWT algorithm pinning** on `authenticate` and `verifyStepUp`.
- **Rate-limit IP trust:** `clientIp` now uses Express `req.ip` (honors `trust proxy`, OFF by
  default) instead of blindly trusting `X-Forwarded-For`, which a client could forge to rotate
  past the per-IP caps. Behind an ALB/API Gateway, set `TRUST_PROXY`. The bucket map is bounded.
- **Airtable formula injection:** `idempotencyKey` is route-validated to a safe charset, and the
  Airtable `filterByFormula` point read fails closed on any value containing a quote.
- **Async error handling:** `express-async-errors` forwards async route rejections to the
  masking error handler (Express 4 otherwise drops them, hanging the request).
- **Shift claim** now requires `task.read` (the voter-facing `public` role can no longer claim).
- **JWKS rotation:** the Clerk verifier refetches the JWKS on an unknown `kid` instead of
  failing all logins until a restart.
- **Contact keys:** set `CONTACT_KEY_SALT` to derive recipient keys with a keyed HMAC so leaked
  keys aren't offline-reversible to PII (plain hash remains the back-compat default).
- **CSV import** is capped at 5000 rows to bound geocode amplification.

## Residual risks the operator must own

- **Audit durability + out-of-band verification.** Both stores now chain audit writes and
  `/audit/verify` checks the chain in-app. But whoever can edit Airtable rows (the PAT) can also
  recompute the hashes, so the in-app check only catches careless tampering. For real assurance,
  export the audit table to an **append-only sink** and run the chain verification out-of-band on
  a schedule. Note: the Airtable chain reads the latest row before each append, so two
  **concurrent** appends could fork the chain — harmless at clerk-tool volume and caught by
  `/audit/verify`, but move to a sequenced/transactional store for high write concurrency.
- **Twilio webhook replay.** Signatures have no timestamp/nonce, so a captured valid request can
  be replayed. The only action (opt-out) is idempotent, so impact is low; add a freshness check
  if the endpoint ever does more.
- **Secrets backend.** `getConfig` falls back from SSM to env vars; nothing forces SSM use. If
  SSM SecureString is a compliance requirement, enforce `SSM_PREFIX` in production.
- **Multi-instance shared state.** The rate limiter and SMS daily cap use the shared counter:
  per-process memory by default, Redis when `REDIS_URL` is set. Run multi-instance **only** with
  `REDIS_URL` (and `REQUIRE_SHARED_STATE=true` to enforce it) — otherwise the SMS cap multiplies
  per instance. The audit chain is shared via Airtable in `airtable` mode (each append reads the
  latest row), so it is not in this set.
- **Provider error bodies** are truncated into error strings for logs; treat logs as
  potentially PII-bearing and scope log access accordingly.

## Reporting

This is a campaign tool, not a hosted product — report issues to the repository owner directly.

# matt-grant-chrome

Standalone Chrome extension + backend microservice for the **Matt Grant for Congress** clerk productivity tool (MO-02 Republican Primary, **Aug 4, 2026**).

This repo is intentionally **isolated** from the main campaign app. It has its own backend microservice so a bug in this feature cannot break the rest of the platform. The extension is a thin, role-aware client; all privileged work happens server-side.

## What it does

Six clerk roles get a role-aware side panel with four intent lanes — **Vote · Issues · Volunteer · Act** — that recompute dynamically from:

- **Role** (RBAC scopes)
- **Phase** (server-authoritative election clock)
- **Location** (county + school district + zip, optional address)

### Election anchor (Central time)

| Phase | Window | Primary message |
|---|---|---|
| `PHASE_1_REGISTER` | → **Jul 8, 2026** | Register at sos.mo.gov |
| `PHASE_2_PLAN` | Jul 9 – Jul 20 | Confirm registration, make a plan |
| `PHASE_3_TURNOUT` | **Jul 21** – Aug 4 | Vote early or Aug 4 — request the GOP ballot |
| `PHASE_CLOSED` | Aug 5+ | Read-only |

Missouri has **no same-day registration**; the primary is **open** (any registered voter may request the Republican ballot).

## Architecture

```
matt-grant-chrome/
├── extension/          # MV3 Chrome extension (React + Vite + TypeScript)
│   └── src/
│       ├── lib/        # rbac (UX gating), phase (display), api client, types
│       ├── components/ # Countdown, LocationForm, ResourceCards, TaskQueue,
│       │               #   Scheduler, ImportPanel, CommsPanel, SignIn, RolePanel
│       ├── background/ # service worker (token + phase + API proxy)
│       └── App.tsx
└── service/            # Backend microservice (Node + Express + TypeScript)
    └── src/
        ├── routes/     # /me, /phase, /location/*
        ├── lib/        # location resolver, public-data clients, types
        ├── auth.ts     # JWT scope middleware (server-authoritative RBAC)
        ├── rbac.ts     # canonical scope catalog + role matrix
        ├── phase.ts    # canonical phase clock
        └── config.ts   # SSM SecureString loader (env fallback)
```

**Security model:** the extension is fully inspectable, so it ships **no secrets**. It holds a short-lived scoped token; the service holds all keys (Airtable, FEC, Census) in **AWS SSM SecureString** and re-checks RBAC + phase on every call. The `rbac.ts`/`phase.ts` in `extension/` are for hiding UI only — `service/` is the source of truth.

## Quick start

```bash
# 1. install (npm workspaces)
npm install

# 2. run the microservice (http://localhost:8787)
cp service/.env.example service/.env   # fill in JWT_SECRET for local dev
npm run dev:service

# 3. build the extension
npm run build:extension                 # outputs extension/dist

# 4. load the extension in Chrome
#    chrome://extensions → Developer mode → "Load unpacked" → select extension/dist

# 5. sign in
#    Open the side panel → enter the service URL + your name + role + the
#    DEV_AUTH_SECRET. (In production this screen is the Clerk sign-in.)
```

## Deploy notes (microservice)

- Stateless Express app; deploy on Lambda + API Gateway, Fargate, or any Node host.
- Secrets via SSM SecureString (`/matt-grant-chrome/<env>/JWT_SECRET`, etc.). Least-privilege IAM: read-only `ssm:GetParameter` on that path prefix.
- Set `ALLOWED_ORIGIN` to the extension origin and front with HTTPS.
- A root `Dockerfile` ships a slim production image (non-root, `GET /health` for health checks); baseline security headers + `x-powered-by` off are applied globally. Full steps, IAM policy, and the Lambda adapter are in **[`docs/deploy.md`](docs/deploy.md)**; all env vars are in `service/.env.example`.

## Endpoints (v0.2)

All require a valid clerk JWT. Scope and phase are re-checked server-side on every call.

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness |
| POST | `/auth/token` | — (public) | exchange a Clerk session (or dev credential) for a scoped JWT |
| GET | `/me` | — | identity + derived scopes |
| GET | `/phase` | — | server-authoritative phase + countdown |
| POST | `/location/resolve` | `voter.read` | role+phase+location aware cards |
| GET | `/location/lea?county=` | — | local election authority deep-link |
| GET | `/tasks?zip=` | `task.read` | next-best-action queue (scope/phase filtered) |
| POST | `/tasks/:id/claim` | `task.read` | claim a task (optimistic `version`) |
| POST | `/tasks/:id/complete` | `task.write` | complete (re-checks phase + assignee) |
| POST | `/tasks/:id/skip` | `task.write` | skip with optional reason |
| GET | `/events?county=&zip=` | `voter.read` | phase-filtered events + shifts |
| POST | `/events` | `events.write` | create a drive/canvass/phone bank |
| POST | `/events/:id/shifts` | `events.write` | add a shift |
| GET | `/events/shifts/mine` | `task.read` | shifts this clerk claimed |
| POST | `/events/shifts/:id/claim` | (any clerk) | claim a shift (capacity enforced) → fires a calendar invite |
| GET | `/comms/templates` | any comms scope | list templates (draft/review/send) |
| POST | `/comms/templates` | `comms.draft` | draft a message template (disclaimer/opt-out auto-detected) |
| POST | `/comms/templates/:id/approve` | `comms.approve` | approve/reject; approval blocked if disclaimer or opt-out missing |
| POST | `/comms/send` | `comms.send` | gated send: approved + disclaimer + opt-out + phase + not-opted-out + idempotent |
| POST | `/comms/optout` | `optout.manage` | add a recipient to the opt-out list (stored by opaque key) |
| POST | `/contacts/import/preview` | `list.import` | parse + classify a CSV (new / duplicate / invalid / out-of-district) — writes nothing |
| POST | `/contacts/import/commit` | `list.import` | re-validate server-side and create the `new` rows (geocoded) |
| GET | `/contacts?zip=&regStatus=` | `voter.read` | list contacts (filtered) |
| GET | `/contacts/:id` | `voter.read` | one contact + its disposition logs |
| POST | `/contacts/:id/logs` | `contact.log` | log a disposition (registered/opted_out reflect onto the contact) |
| POST | `/contacts/:id/optout` | `optout.manage` | opt a contact out (sets flag + adds opaque key to opt-out list) |
| POST | `/comms/send-to-contact` | `comms.send` | gated send to a stored contact; register sends flip them to `reg_link_sent` |

**Task lifecycle:** `open → claimed → in_progress → done | skipped`. Registration-kind tasks can only be **completed** during `PHASE_1_REGISTER`; after Jul 8 the server rejects completion with `409 phase_closed`, even for a task claimed earlier.

**Concurrency:** tasks and shifts carry a `version`; claim/complete bump it and conflicting writes return `409 version_conflict`. Shift claims enforce `capacity` and reject double-claims.

## Security model — SMS / sensitive actions

SMS is treated as the highest-risk capability (it costs money, touches PII, and carries TCPA exposure). Defense in depth, enforced server-side; the extension UI gating is the last and least-trusted layer.

- **Admin-only.** SMS sends require the `sms.send` scope, which only the `admin` role holds. A clerk with general `comms.send` cannot send SMS.
- **Step-up re-auth.** Every SMS send requires a short-lived step-up token (`POST /auth/step-up`, admin-only, ~5 min) passed as `X-StepUp-Token` — so a leaked long-lived token still can't text. Raw `/comms/send` to an SMS template can't verify consent and is always blocked; use `/comms/send-to-contact`.
- **Consent enforced.** SMS to a contact is blocked unless `consentSms` is recorded; inbound STOP (signature-validated webhook) syncs to the opt-out list.
- **Budget + kill switch.** A daily cap (`SMS_DAILY_CAP`) protects the Twilio balance, and `SMS_ENABLED=false` hard-disables all SMS instantly.
- **Rate limited.** Per-IP limits on `/auth/token` and `/auth/step-up`; per-clerk limit on SMS sends.
- **PII-safe logging.** Phone numbers are masked and message bodies are never logged.
- **Tamper-evident audit.** Every sensitive action is appended to a SHA-256 hash-chained audit log; any later edit or deletion breaks the chain.
- **Refuse-to-boot.** In production the service exits rather than start with a default/missing `JWT_SECRET`, dev auth enabled, `ALLOWED_ORIGIN=*`, or `SMS_DRIVER=twilio` missing credentials.

## SMS (Twilio)

`sms`-channel templates send through your Twilio **Messaging Service** (`SMS_DRIVER=twilio`); the sender pool picks the toll-free number. Credentials load from SSM/env — the **Auth Token is a secret (SSM SecureString), never committed**. The Messaging Service SID and number are not secrets.

- **Consent is enforced:** an SMS to a contact is blocked unless `consentSms` is true (`POST /contacts/:id/consent`). Raw `/comms/send` to an SMS template is always blocked (can't verify consent) — use `/comms/send-to-contact`.
- **STOP sync:** `POST /twilio/inbound` (signature-validated via `X-Twilio-Signature`) records inbound STOP/UNSUBSCRIBE into the opt-out list, keeping the carrier opt-out and the app's own in sync. Set `TWILIO_WEBHOOK_URL` to the exact public URL and point your Messaging Service's inbound webhook at it.
- **Before live sends:** complete Twilio **toll-free verification** (required for political/advocacy traffic) and enable **Advanced Opt-Out** on the Messaging Service. This is educational, not legal advice — confirm messaging-compliance specifics with counsel.

## Configuration (drivers)

Each integration is a swappable adapter, defaulting to a safe no-op/in-memory mode so the repo runs with zero credentials. Flip a driver via env (secrets in SSM SecureString) to light up the real provider:

| Concern | Env | Default | Real adapter |
|---|---|---|---|
| Auth | `AUTH_DRIVER` | `dev` (disabled in prod) | `clerk` (`CLERK_JWKS_URL`, `CLERK_ISSUER`) |
| Storage | `STORE_DRIVER` | `memory` | `airtable` (`AIRTABLE_PAT`, `AIRTABLE_BASE_ID=appiuSYCexFUmGIOr`) |
| Calendar | `CALENDAR_DRIVER` | `noop` | `google` (`GOOGLE_CALENDAR_TOKEN`, `GOOGLE_CALENDAR_ID`) |
| Mailer | `MAILER_DRIVER` | `noop` | `gmail` (`GMAIL_TOKEN`) |
| SMS | `SMS_DRIVER` | `noop` | `twilio` (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`) |

The no-op calendar/mailer log to console and the audit trail so the loops are observable in dev. For production, the adapters should use a service account / OAuth, not a personal token.

## Status

v0.6 scaffold. **Live and smoke-tested:**
- **Extension UI** — the side panel now has scope-gated tabs: Local, Tasks, Schedule, plus **Import** (List Clerk: paste/upload CSV → preview counts → commit, with a contacts list) and **Comms** (Compliance: review + approve/reject; Social: draft + send approved templates). A real **sign-in** screen replaces the manual token paste. Each tab only renders if the clerk's scopes allow it.
- **Auth** — `POST /auth/token` (dev + clerk drivers) → short-lived scoped JWT.
- **Contacts layer** — CSV import (preview/commit), dedupe, geocoded in-district flag, dispositions, opt-out; register sends flip a contact to `reg_link_sent`.
- **Phase 1 — Storage:** async `StorePort`, `memory` (seeded) + `airtable` adapters.
- **Phase 2 — Calendar:** invites on shift-claim / event-create (non-blocking).
- **Phase 3 — Comms:** template → approval → gated send, idempotent outbox, opaque keys.
- **Phase 4 — LEA:** Board vs. County Clerk (St. Louis City ≠ St. Louis County).

Public-data clients (Census geocoder + ACS demographics, FEC race finance, OSM venues, DESE district profile) are implemented server-side with timeouts and graceful nulls, and covered by deterministic mocked-fetch tests (`service/src/__tests__/publicData.test.ts`). They were not live-verified from the build sandbox (egress is allowlist-restricted); ACS/OSM venue enrichment attaches to `/location/resolve` only when `ENRICH_RESOLVE=true`.

Providers are code-complete + tested, pending live credentials: Clerk auth (`docs/clerk-setup.md`), Airtable storage (`docs/airtable-setup.md`), and Google Calendar/Gmail via service-account OAuth with token refresh (`docs/google-oauth-setup.md`). The deploy path is in place — root `Dockerfile` + `docs/deploy.md`, with security headers, pinned CORS, and the refuse-to-boot guard.

The extension now does **in-panel Clerk sign-in** via `@clerk/chrome-extension`: set
`VITE_CLERK_PUBLISHABLE_KEY` (see `extension/.env.example` + `docs/clerk-setup.md`) and the Clerk
tab signs the clerk in and auto-exchanges the session token; with no key it falls back to Dev /
manual paste. It ships Chrome-Web-Store-ready **icons** (16/48/128px, regenerated by
`node extension/scripts/make-icons.mjs`). Clerk roles can be assigned in bulk from a CSV with
`node scripts/set-clerk-roles.mjs clerks.csv` (see `docs/clerk-setup.md`). Still to do: stand up
the live Clerk/Airtable/Google/Twilio accounts and flip their drivers on; allow-list the extension
origin in Clerk and set each clerk's `publicMetadata.role`; and a live run of the public-data
clients against real endpoints (egress is allowlist-restricted in the build sandbox).

**Go-live runbook:** `docs/go-live-checklist.md` is the ordered sequence with verification gates.
Two helpers back it: `node scripts/preflight.mjs` validates the deploy config against the
refuse-to-boot gate and probes `/health` + `/ready` (`--url https://…`), and
`node scripts/smoke-public-data.mjs` verifies the live Census/FEC/OSM/DESE clients from a host with
open egress. To publish the extension, `docs/chrome-web-store.md` has the listing copy, permission
justifications, and submission checklist.

## Tests & CI

Automated coverage runs under **Vitest** as two projects — `service` (Node) and
`extension` (jsdom + Testing Library).

```bash
npm test          # run the whole suite once
npm run test:watch
```

The suite targets the high-risk production paths rather than chasing a coverage
number:

- **Service unit** — phase clock boundaries, RBAC scope derivation (SMS is
  admin-only), step-up token mint/verify, Twilio signature validation, audit
  hash-chain tamper detection, SMS kill switch / daily cap, and the
  refuse-to-boot guard.
- **Service integration** (supertest, app imported in-process) — auth/RBAC
  rejection codes, optimistic-locking `409`s, the registration phase deadline,
  shift capacity, the layered SMS send guard, and the signed Twilio STOP webhook.
- **Extension** — the countdown formatter, role labels, scope-gated tab
  rendering, and the sign-in form.

`.github/workflows/ci.yml` runs `npm ci → typecheck → build → test` on every push
and pull request.

## Compliance (educational, not legal advice)

- Link out to official **sos.mo.gov** for registration and polling-place lookup; never re-host or scrape.
- Voter-list use is restricted to election purposes under Missouri law.
- Outbound messaging must honor TCPA consent/opt-out and carry the FEC "Paid for by" disclaimer. Confirm specifics with campaign counsel.

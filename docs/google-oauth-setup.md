# Google Calendar & Gmail setup (service account)

The Calendar and Gmail adapters authenticate with a **Google service account** using the
2-legged JWT-bearer flow (`service/src/lib/googleAuth.ts`): the service signs a short-lived
assertion with the service-account private key, exchanges it for an access token, and caches
the token until just before expiry — so tokens refresh automatically instead of expiring
silently like a personal bearer token. In production the service refuses to boot if the
`google`/`gmail` drivers are selected without credentials (see `assertSecureStartup` in
`service/src/config.ts`).

## One-time Google setup

1. In Google Cloud, create a **service account** and download its JSON key.
2. Enable the **Google Calendar API** and **Gmail API** for the project.
3. For Gmail "send as" and calendar invites on a Workspace user's behalf, grant the service
   account **domain-wide delegation** (Admin console → Security → API controls) for the scopes:
   - `https://www.googleapis.com/auth/calendar`
   - `https://www.googleapis.com/auth/gmail.send`

## Environment / SSM

Store the private key as an SSM SecureString — **never commit it**.

| Var | Purpose |
| --- | --- |
| `GOOGLE_SA_JSON` | The whole service-account key file (alternative to the two vars below) |
| `GOOGLE_SA_CLIENT_EMAIL` | Service-account email (if not using `GOOGLE_SA_JSON`) |
| `GOOGLE_SA_PRIVATE_KEY` | Service-account private key PEM (escaped `\n` is handled) **secret** |
| `CALENDAR_DRIVER=google` | Enable the Google Calendar adapter |
| `GOOGLE_CALENDAR_ID` | Target calendar (default `primary`) |
| `GOOGLE_CALENDAR_SUBJECT` | User to impersonate for invites (domain-wide delegation) |
| `MAILER_DRIVER=gmail` | Enable the Gmail adapter |
| `GMAIL_SUBJECT` | User to impersonate / send as |
| `GMAIL_FROM` | `From:` header (defaults to `GMAIL_SUBJECT`) |

**Back-compat:** if no service account is configured, a legacy static bearer token
(`GOOGLE_CALENDAR_TOKEN` / `GMAIL_TOKEN`) is still honored (no refresh). With neither, the
adapters fall back to the dev no-op.

## Verifying

The token provider (assertion claims, caching, refresh, error surfacing) and both adapters
(Calendar attendees + `sendUpdates=all`; Gmail `From`/MIME) are covered by mocked-fetch tests
(`googleAuth.test.ts`, `calendar.test.ts`, `mailer.test.ts`) — regressions are caught in CI
without live credentials. Live Google calls must be validated in an environment with outbound
access to `oauth2.googleapis.com` / `*.googleapis.com`.

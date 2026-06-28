# Privacy Policy — Matt Grant for Congress: Clerk Tools

**Last updated:** 2026-06-28
**Applies to:** the "Matt Grant for Congress — Clerk Tools" Chrome extension (the
"Extension").

> Replace the contact line below with your real address before publishing.
> **Contact:** privacy@REPLACE-WITH-YOUR-DOMAIN

This Extension is an **internal tool for authorized campaign clerks**, distributed
**Unlisted** on the Chrome Web Store. It is a thin client: it stores no secrets and
performs no privileged work locally. All data processing happens on the campaign's
own backend service, which the clerk signs in to.

## What the Extension stores on your device

The Extension uses `chrome.storage.local` (local to your browser profile only — it
is **not** synced to your Google account) to hold your session:

| Key              | Purpose                                                     |
| ---------------- | ----------------------------------------------------------- |
| `apiBase`        | the backend service URL you sign in to                      |
| `authToken`      | a short-lived scoped session token (bearer JWT)             |
| `tokenExpiresAt` | when that token expires                                     |
| `authSub`        | your clerk username/identifier                              |
| `authRole`       | your assigned clerk role (controls which tools are shown)   |

This data is cleared when you sign out. The Extension does **not** read your
browsing history, the content of web pages you visit, your tabs, cookies, or any
site other than the campaign backend you configure. It injects no content scripts.

## What data is sent to the campaign backend

When you use the tools, the Extension sends requests (authenticated with your
session token) to the backend service you configured. Depending on the action and
your role, this may include:

- **Contact / voter-list data** you import or view (e.g. name, phone, email, ZIP,
  registration status) — used solely for authorized election outreach.
- **Location input** (county, school district, ZIP, optional address) — used to
  show locally-relevant resources and determine in-district status.
- **Message content** you draft, approve, or send (email/SMS templates).
- **Task and scheduling actions** you take.

The backend — not the Extension — stores and processes this data. The backend
enforces role-based access control and phase rules on every request, masks PII in
logs, never logs message bodies, and keeps a tamper-evident audit trail of
sensitive actions. The Extension itself transmits this data over HTTPS to the
configured backend and retains none of it beyond the session keys listed above.

## Permissions and why they are used

- **`storage`** — to keep your session (the keys above) on your device.
- **`sidePanel`** — to render the clerk tools in Chrome's side panel.
- **Host permission (your backend domain)** — to make authenticated API calls to
  the campaign backend. No other hosts are contacted.

## Data sharing

We do **not** sell or rent personal data, and we do not share it with third parties
except the service providers the campaign backend integrates with to perform the
tool's functions (e.g. storage, email, SMS, calendar, and official public-data
lookups). Outbound messaging is subject to TCPA consent/opt-out handling and
carries the required "Paid for by" disclaimer.

## Data retention and deletion

Session data on your device is removed on sign-out or when you remove the
Extension. Contact and outreach data held by the backend is retained per the
campaign's data-retention practices and applicable law. To request access to or
deletion of data held about you, contact the address above.

## Children

The Extension is a workforce tool for authorized clerks and is not directed to
children.

## Changes

We may update this policy; material changes will be reflected by the "Last
updated" date above.

# Chrome Web Store listing copy — Matt Grant for Congress: Clerk Tools

Ready-to-paste content for the Chrome Web Store developer dashboard. Replace any
`REPLACE-...` placeholders before submitting.

---

## Item name (≤ 75 chars)

```
Matt Grant for Congress — Clerk Tools
```

## Summary / short description (≤ 132 chars)

```
Role-aware side-panel for Matt Grant for Congress clerks: voter registration, GOTV tasks, scheduling, and compliant comms.
```

## Category

```
Productivity  (alt: Workflow & Planning)
```

## Language

```
English (United States)
```

## Detailed description

```
Clerk Tools is the internal productivity panel for authorized Matt Grant for
Congress campaign clerks (MO-02 Republican Primary, August 4, 2026). It opens in
Chrome's side panel and shows only the tools your assigned role is allowed to use.

Four intent lanes — Vote, Issues, Volunteer, Act — recompute automatically from
your role, the campaign's phase (the server-authoritative election clock), and the
location you're working in (county, school district, ZIP).

Depending on your role you can:
• Work a next-best-action task queue (registration, outreach, turnout).
• Schedule events and claim volunteer shifts (with calendar invites).
• Import and review contact lists (CSV) with de-duplication and in-district checks.
• Draft, approve, and send compliant message templates with built-in disclaimer
  and opt-out gating.

Security by design: the extension ships no secrets and stores only a short-lived,
scoped session token on your device. All privileged work happens on the campaign's
own backend, which re-checks your permissions and the election phase on every
request, masks PII in logs, and keeps a tamper-evident audit trail.

This is an internal tool for authorized clerks and requires a campaign-issued
account and backend access to function.

Paid for by REPLACE-WITH-CAMPAIGN-COMMITTEE.
```

## Single-purpose description (dashboard field)

```
A single-purpose productivity side panel that lets authorized campaign clerks sign
in to the campaign backend and perform role-appropriate voter-registration, GOTV,
scheduling, and compliant-messaging tasks.
```

## Permission justifications (dashboard "Privacy practices" tab)

- **storage** — Persists the signed-in clerk's short-lived session (backend URL,
  scoped auth token, expiry, username, role) in `chrome.storage.local` so the
  panel stays usable across reloads. Cleared on sign-out.
- **sidePanel** — The entire UI renders in Chrome's side panel; this permission is
  required to open it.
- **Host permission (your backend domain)** — The panel makes authenticated HTTPS
  API calls to the single campaign backend it signs in to. No other hosts are
  accessed; there are no content scripts.

## Data-usage disclosures (Privacy practices tab)

- Does the item collect/use user data? **Yes.**
- Data types handled: **Personally identifiable information** (clerk identifier;
  imported contact data such as name, phone, email, ZIP, registration status),
  **Location** (county/ZIP/optional address entered by the clerk), **User-generated
  content** (message templates the clerk drafts/sends), **Authentication info**
  (session token).
- Sold to third parties: **No.**
- Used only for the item's single purpose (campaign clerk operations): **Yes.**
- Used for creditworthiness / lending: **No.**
- Privacy policy URL: **REPLACE-WITH-HOSTED-PRIVACY-URL** (host `PRIVACY.md`, e.g.
  GitHub Pages or the campaign site).

## Distribution

- Visibility: **Unlisted**
- Regions: as appropriate (default: all)
- Pricing: Free

## Assets to upload

- **Store icon:** 128×128 PNG (use `extension/public/icons/icon-128.png`, or the
  final logo at that size).
- **Screenshots:** five 1280×800 PNGs are pre-generated in `store-assets/`
  (sign-in, Local, Tasks, Schedule, Comms), captured from the real UI against a
  local seeded backend. Upload any/all; regenerate after a UI change per
  `docs/CHROME_STORE_SUBMISSION.md`. Re-shoot once the official logo and final
  copy are in place if you want them reflected.
- **Small promo tile (optional):** 440×280 PNG.

---

### Notes
- Confirm the committee name and the "Paid for by" line with campaign counsel.
- Because this references a political campaign, review Chrome Web Store program
  policies even for an Unlisted item; an internal-tool framing (above) keeps it a
  productivity utility rather than political advertising.
```

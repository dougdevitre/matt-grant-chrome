# Chrome Web Store submission

Everything needed to publish the extension to the Chrome Web Store: the listing
copy, the permission justifications reviewers ask for, the data-handling
disclosures, and a submission checklist. The extension itself is built and
ships store-ready icons — this is the paperwork, not code.

> Distribution note: because this tool is for a fixed set of campaign clerks,
> **Unlisted** visibility (link-only, still reviewed) is usually the right
> choice over Public. You can also side-load via "Load unpacked" (see
> `docs/deploy-status.md`) and skip the store entirely; use the store when you
> want one-click install + auto-update for the volunteer team.

## Package to upload

Build the extension and zip `extension/dist` (this is the same artifact the
service serves at `/download/`):

```bash
npm run build:extension          # outputs extension/dist
npm run build:download           # also packs the zip via service/scripts/pack-extension.mjs
```

Upload the **contents** of `extension/dist` as a zip (manifest at the zip root).

> ⚠️ Remove the `"key"` field from `manifest.json` before packaging for the
> store **only if** you want the store to assign the ID. The committed `key`
> pins a stable extension ID for local/side-loaded installs and for the Clerk
> `ALLOWED_ORIGIN` allow-list; if you keep it, the store ID will match your
> side-loaded ID (convenient — the origin you already allow-listed stays valid).
> Decide once and keep it consistent, because the ID is baked into
> `ALLOWED_ORIGIN` and the Clerk origin allow-list.

## Listing copy

**Name** (from manifest): `Matt Grant for Congress — Campaign Tools`

**Summary** (≤132 chars):
> Role-aware campaign productivity panel for voter registration and GOTV — MO-02 Republican Primary, Aug 4, 2026.

**Category:** Productivity

**Language:** English (United States)

**Description:**
> A side-panel tool for authorized Matt Grant for Congress campaign clerks. It
> presents a role-aware set of actions across four lanes — Vote, Issues,
> Volunteer, Act — that update automatically based on the clerk's role, the
> election phase (register → plan → turnout), and their MO-02 location (county,
> school district, ZIP).
>
> Clerks sign in with their campaign Clerk account; all privileged work happens
> on a secured backend, and the extension ships no secrets. Voter-registration
> and polling-place lookups link out to the official Missouri Secretary of
> State site — nothing is scraped or re-hosted. Outbound messaging carries the
> required "Paid for by" disclaimer and honors opt-out.
>
> This tool is intended for authorized campaign staff and volunteers only.

**Single purpose** (Chrome requires one sentence):
> Give authorized campaign clerks a role- and phase-aware panel of voter-registration and get-out-the-vote actions for Missouri's 2nd Congressional District.

## Permission justifications

Reviewers require a justification per permission. These map to the current
`extension/public/manifest.json`.

| Permission | Justification |
|---|---|
| `sidePanel` | The entire UI is a Chrome side panel opened from the toolbar action. |
| `storage` | Persist the clerk's Service URL, selected location, and the "site tips" toggle across sessions. No PII beyond the clerk's own settings. |
| `cookies` | Required by `@clerk/chrome-extension` to read the Clerk session on the campaign's Clerk domain so the clerk stays signed in. |
| `geolocation` | Opt-in only, behind the "Use my current location" button. The device coordinates are sent once to reverse-geocode the voter's county/ZIP/district and jump to the official polling-place lookup; they are not stored or logged, and manual entry is always available. |

**Host permissions** — the first two are the backend and the auth provider; the
rest let the panel detect when the clerk's **active tab is on one of these
campaign-related sites** (hostname only) so it can show a relevant "working here"
tip. Note: opening a link (the tip's buttons) needs no host permission — these
grants are solely to read the active tab's origin, and only for these specific
sites. The extension reads no page content and injects no scripts.

| Host pattern | Why |
|---|---|
| `http://localhost:8787/*`, `https://*.awsapprunner.com/*` | Talk to the backend microservice (local dev + deployed App Runner). |
| `https://clerk.mattgrantforcongress.org/*` | Clerk auth (session token exchange; the Clerk SDK also reads its session cookie here). |
| `https://sos.mo.gov/*`, `https://*.sos.mo.gov/*` | Detect the official MO SoS voter site to show registration / polling-place tips. |
| `https://*.airtable.com/*`, `https://docs.google.com/*`, `https://mail.google.com/*`, `https://calendar.google.com/*` | Detect the campaign's working tools to show import / logging / scheduling tips. |
| County authority domains (`stlouiscountymo.gov`, `sccmo.org`, `franklinmo.org`, `warrencountymoclerk.com` + subdomains) | Detect a MO-02 Local Election Authority site to show a dates/lookup tip. |
| `winred.com`, `x.com`/`twitter.com`, `facebook.com`, `instagram.com`, `youtube.com` (+ subdomains) | Detect donation + social channels to show a compliance tip. |

> The "working here" tips are user-toggleable (the "site tips" switch in
> Settings), read only the active tab's hostname — never the path or page
> content — and are documented in the privacy policy. If a reviewer still wants a
> smaller surface, the social/WinRed hosts can be dropped: they only power
> contextual tips, not core function (keep `companionSites.ts` in lockstep with
> the manifest if you do).

## Privacy & data disclosures

Fill these into the store's Privacy tab:

- **Single purpose:** see above.
- **Data collected:** the clerk's own settings (Service URL, location selection,
  UI toggles) via `storage`; the Clerk session via `cookies`. The extension
  itself collects no browsing history, no page content, and no analytics.
- **Data sold to third parties:** No.
- **Data used/transferred for purposes unrelated to core functionality:** No.
- **Data used for creditworthiness / lending:** No.
- **Remote code:** No. CSP is `script-src 'self' 'wasm-unsafe-eval'`; the WASM
  allowance is for Clerk's crypto. No remotely hosted JS is loaded.
- **Privacy policy URL:** required for a published listing. The service serves
  one at **`https://<app-runner-domain>/privacy.html`** (source:
  `service/public/privacy.html`, linked from the `/` landing page). Confirm the
  contact email in that file before publishing, then paste the URL here.

## Submission checklist

- [ ] Register/confirm the Chrome Web Store **developer account** (one-time $5 fee).
- [ ] Decide **Public vs Unlisted** (Unlisted recommended for a clerk-only tool).
- [ ] Decide whether to keep the manifest `"key"` (see package note above) and rebuild.
- [ ] `npm run build:extension` → zip the contents of `extension/dist`.
- [ ] Prepare store assets: **128×128 icon** (already in `extension/public/icons`),
      at least one **1280×800 or 640×400 screenshot** of the side panel, and an
      optional 440×280 small promo tile.
- [ ] Paste the listing copy, permission justifications, and privacy disclosures above.
- [ ] Add the **privacy policy URL**.
- [ ] Set distribution to the campaign's region (US) and audience (not "child-directed").
- [ ] Submit for review (Unlisted still reviewed; expect hours–days).
- [ ] After publish, confirm the **store extension ID** matches the ID in your
      Clerk origin allow-list and the service `ALLOWED_ORIGIN`; if it changed,
      update both and redeploy (see `docs/go-live-checklist.md`).

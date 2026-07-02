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

**Host permissions** — each is either the backend, the auth provider, or a site
the companion card offers context on (link-outs / "working here" tips). None are
used to inject content that reads page data for exfiltration; they scope the
companion card and API calls:

| Host pattern | Why |
|---|---|
| `http://localhost:8787/*`, `https://*.awsapprunner.com/*` | Talk to the backend microservice (local dev + deployed App Runner). |
| `https://clerk.mattgrantforcongress.org/*` | Clerk auth (session token exchange). |
| `https://sos.mo.gov/*`, `https://*.sos.mo.gov/*` | Official MO SoS registration / polling-place link-outs. |
| `https://*.airtable.com/*`, `https://docs.google.com/*`, `https://mail.google.com/*`, `https://calendar.google.com/*` | Companion-card deep links to the campaign's working tools. |
| County authority domains (`stlouiscountymo.gov`, `sccmo.org`, `franklinmo.org`, `warrencountymoclerk.com` + subdomains) | Local Election Authority link-outs for the four MO-02 counties. |
| `winred.com`, `x.com`/`twitter.com`, `facebook.com`, `instagram.com`, `youtube.com` (+ subdomains) | Context cards for donation + social channels the campaign runs. |

> If a reviewer flags host permissions as broad: the companion card only reacts
> to the active tab's origin to show relevant tips/links; it does not read page
> content. If you want to shrink the review surface, drop the social/WinRed
> hosts — they only power contextual cards, not core function.

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

# Chrome Web Store submission checklist

How to take this extension from the repo to a published **Unlisted** item.
Companion files: `STORE_LISTING.md` (copy/paste listing text) and `PRIVACY.md`
(the privacy policy you must host and link).

---

## 0. Pre-upload — must do before zipping

- [ ] **Deploy & harden the backend** (`service/`). In production it must run with
      `NODE_ENV=production`, a strong `JWT_SECRET`, `AUTH_DRIVER=clerk`, and a
      pinned `ALLOWED_ORIGIN` (the extension origin). The service refuses to boot
      otherwise — see `README.md` → "Security model".
- [ ] **Pin the manifest hosts.** Edit `extension/public/manifest.json` →
      `host_permissions`, replacing the two placeholders with your real **HTTPS**
      backend host and (for Clerk auth builds) your Clerk Frontend API host. If
      shipping with real auth, also build in Clerk mode — see
      `docs/PRODUCTION_AUTH.md`.
- [ ] **Replace placeholder icons** in `extension/public/icons/` with the official
      logo at 16/32/48/128 (keep the same filenames). See that folder's README.
- [ ] **Complete legal/compliance review** of the SMS/messaging feature (TCPA
      consent + opt-out, FEC "Paid for by" disclaimer). Confirm with counsel.
- [ ] **Fill placeholders** in `PRIVACY.md` (contact email) and `STORE_LISTING.md`
      (committee name, privacy-policy URL).

## 1. Build the upload package

```bash
npm install
npm run typecheck          # should pass clean
npm run build:extension    # outputs extension/dist/
# zip the CONTENTS of dist (manifest.json must be at the zip root):
cd extension/dist && zip -r -X ../../matt-grant-clerk-tools-v1.0.0.zip . -x "icons/README.md"
```

Verify the zip: `unzip -l matt-grant-clerk-tools-v1.0.0.zip` — `manifest.json`,
`background.js`, `index.html`, `assets/*`, and `icons/icon-*.png` should be at the
top level (no extra parent folder).

## 2. Host the privacy policy

- [ ] Publish `PRIVACY.md` at a public URL (GitHub Pages, the campaign site, etc.).
- [ ] Copy that URL — the dashboard requires it because the extension handles
      personal data.

## 3. Screenshots (listing requires ≥ 1)

Five 1280×800 PNGs are already in **`store-assets/`** (sign-in, Local, Tasks,
Schedule, Comms), captured from the real UI against a local seeded backend. They
show the placeholder icons/copy and seeded demo data — good enough to submit, but
re-shoot after dropping in the official logo and final committee name if you want
those reflected.

**To regenerate** (after a UI change or rebrand):

1. Run the backend locally with dev auth + the in-memory store:
   `JWT_SECRET=dev-screenshot-secret DEV_AUTH_SECRET=dev-only-change-me \
   AUTH_DRIVER=dev STORE_DRIVER=memory NODE_ENV=development npm run dev:service`
2. `npm run build:extension`, then serve it:
   `python3 -m http.server 5180 --directory extension/dist`
3. Mint an admin token: `POST http://localhost:8787/auth/token` with
   `{"devSecret":"dev-only-change-me","sub":"Jordan Vega","role":"admin"}`.
4. Drive headless Chromium (binary at `/opt/pw-browsers/...` or your local
   Chrome) against `http://localhost:5180/`, stubbing `chrome.storage.local`
   with that token + `apiBase=http://localhost:8787`, and screenshot each tab at
   1280×800.

**Or capture manually:** `chrome://extensions` → Developer mode → Load unpacked
`extension/dist/` → open the side panel → sign in → screenshot the views.

## 4. Developer dashboard

- [ ] Go to the Chrome Web Store developer dashboard and ensure the **one-time
      developer registration fee** is paid and the publisher account is verified.
- [ ] **Add new item** → upload `matt-grant-clerk-tools-v1.0.0.zip`.
- [ ] **Store listing tab:** paste name, summary, detailed description, single-
      purpose description, and category from `STORE_LISTING.md`. Upload the
      128×128 store icon and screenshots.
- [ ] **Privacy practices tab:** paste the permission justifications, answer the
      data-usage questions ("collects data: yes"; data types: PII, location, UGC,
      auth info; "sold to third parties: no"; "used only for single purpose: yes"),
      and enter the privacy-policy URL.
- [ ] **Distribution tab:** set **Visibility = Unlisted**; set regions and Free
      pricing.
- [ ] **Submit for review.**

## 5. After it's live

- [ ] Install via the Unlisted link and smoke-test against the production backend:
      toolbar icon renders, side panel opens, sign-in works, an **unset** Service
      URL shows a `not_configured` error (never falls back to localhost), and a
      role's tabs match its scopes.
- [ ] Share the Unlisted link only with authorized clerks.

## Version bumps / updates

For each future release, increment `version` in both
`extension/public/manifest.json` and `extension/package.json`, rebuild, re-zip,
and upload as a new package version in the dashboard.

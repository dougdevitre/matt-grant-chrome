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
- [ ] **Pin the backend domain in the manifest.** Edit
      `extension/public/manifest.json` → `host_permissions`, replacing
      `https://REPLACE-WITH-YOUR-BACKEND-DOMAIN/*` with your real **HTTPS** backend
      host (e.g. `https://api.mattgrant.example/*`). This is the only manifest edit
      needed; the API base is otherwise entered by the clerk at sign-in.
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

## 3. Capture screenshots (listing requires ≥ 1)

The UI lives in Chrome's side panel and needs a signed-in session, so capture from
a real run:

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select `extension/dist/`.
2. Click the extension's toolbar icon to open the side panel.
3. Sign in (enter your backend Service URL, name, role, access code).
4. Screenshot representative views (sign-in, Tasks queue, Schedule, Comms) at
   **1280×800** or **640×400** (PNG/JPEG). 1–5 images recommended.

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

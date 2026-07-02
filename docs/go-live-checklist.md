# Go-live checklist

One ordered runbook to take the clerk-tool from "merged & green on `main`" to
"clerks are using it in production." The application code is finished; every
step here is **operational** (standing up runtime + provider accounts). Deeper
references live in `docs/deploy.md`, `docs/deploy-status.md`, `docs/clerk-setup.md`,
`docs/airtable-setup.md`, and `docs/google-oauth-setup.md` — this file is the
sequence and the verification gates between steps.

Two helper scripts back this up:

- `scripts/preflight.mjs` — validate config before you deploy, and probe
  `/health` + `/ready` after. Mirrors the service's refuse-to-boot gate.
- `scripts/smoke-public-data.mjs` — verify the live public-data clients
  (Census/ACS, FEC, Overpass, DESE) once you have open egress.

---

## 0. Preflight (before any deploy)

Run the config gate with the exact env you're about to deploy. Nothing here
touches the cloud — it just catches the misconfigurations that would make the
service refuse to boot.

```bash
NODE_ENV=production AUTH_DRIVER=clerk STORE_DRIVER=airtable \
  ALLOWED_ORIGIN='chrome-extension://<id>' \
  JWT_SECRET='<32+ random bytes>' AIRTABLE_PAT='<pat>' \
  node scripts/preflight.mjs
```

✅ **Gate:** prints `OK — all checks passed.` (exit 0). If it lists problems,
fix them before deploying — the live service enforces the same rules at boot.

---

## 1. Stand up the App Runner service

The blocker last time was the **GitHub source connection**; the console
completes the handshake for you. Full settings are in `docs/deploy-status.md`.

1. **App Runner** (us-east-1) → open the `matt-grant-clerk-service` draft or
   **Create service** with: source = GitHub `dougdevitre/matt-grant-chrome` @
   `main`; runtime Node 22; build `npm ci && npm run build:service && npm run build:download`;
   start `node service/dist/index.js`; port `8787`.
2. Under Source, **authorize the GitHub connection** ("AWS Connector for
   GitHub") and confirm it shows **Available**.
3. Env vars: `NODE_ENV=production`, `AUTH_DRIVER=clerk`,
   `SSM_PREFIX=/matt-grant-chrome/prod`, `ALLOWED_ORIGIN=chrome-extension://placeholder`
   (real ID comes in step 4). Instance role: `matt-grant-apprunner-instance`.
4. **Create & deploy** (first build ≈ 5–10 min). Copy the **Default domain**.

✅ **Gate:**
```bash
node scripts/preflight.mjs --no-config --url https://<app-runner-domain>
```
`/health` 200 = up. `/ready` may be 503 until step 2 (in-memory store still
constructs, so it should be 200; 503 here means a boot/config problem — read the
App Runner logs; the refuse-to-boot line is the safety net working).

---

## 2. Turn on Airtable persistence

Until this is done the service uses its in-memory store (data resets each deploy).
Base is already created: **`appkOfv2eLaDMAjPu`**. See `docs/airtable-setup.md`.

1. Create an Airtable **Personal Access Token** with `data.records:read`,
   `data.records:write`, `schema.bases:read`, scoped to that base.
2. Store it (CloudShell):
   ```bash
   read -rs AIRTABLE_PAT && echo
   aws ssm put-parameter --region us-east-1 --type SecureString --overwrite \
     --name /matt-grant-chrome/prod/AIRTABLE_PAT --value "$AIRTABLE_PAT" && unset AIRTABLE_PAT
   ```
3. Add env `STORE_DRIVER=airtable` to the service and redeploy.

✅ **Gate:** `node scripts/preflight.mjs --no-config --url https://<domain>` →
`/ready` 200 (503 = bad/missing PAT, wrong base id, or no base access).

---

## 3. Connect the extension

1. `npm run build:extension` → load `extension/dist` in Chrome (Developer mode →
   Load unpacked). Copy the **extension ID** from `chrome://extensions`.
2. Set App Runner env `ALLOWED_ORIGIN=chrome-extension://<that-id>` (replace the
   placeholder) and redeploy.
3. In **Clerk**, allow-list that same `chrome-extension://<id>` origin.
4. Assign each clerk's role — bulk from CSV:
   ```bash
   CLERK_SECRET_KEY=sk_live_xxx node scripts/set-clerk-roles.mjs clerks.csv
   ```
   (see `docs/clerk-setup.md` for the role slugs).
5. In the side panel, set the **Service URL** to the App Runner domain and sign
   in via Clerk.

✅ **Gate:** sign in as a test clerk; confirm the four lanes render for that role
and the countdown/phase looks right.

---

## 4. Optional providers (enable per feature)

Each is code-complete and off by default; the boot gate requires creds once you
flip the driver on. Re-run the step-0 preflight with the added env each time.

- **SMS (Twilio):** `SMS_DRIVER=twilio` + `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_WEBHOOK_URL`.
  Verify TCPA quiet hours (`SMS_QUIET_START`/`END`). Point the Twilio inbound
  webhook at `https://<domain>/twilio/inbound` for STOP handling.
- **Calendar (Google):** `CALENDAR_DRIVER=google` + service account
  (`GOOGLE_SA_JSON` or `GOOGLE_SA_CLIENT_EMAIL`/`GOOGLE_SA_PRIVATE_KEY`).
  See `docs/google-oauth-setup.md`.
- **Email (Gmail):** `MAILER_DRIVER=gmail` + the same Google service account.
- **Multi-instance:** if you scale past one instance, set `REDIS_URL` and
  `REQUIRE_SHARED_STATE=true` so the SMS daily cap + rate limiter stay shared.
- **Public-data enrichment:** `ENRICH_RESOLVE=true` attaches ACS/OSM enrichment
  to `/location/resolve`. Optional keys: `CENSUS_API_KEY`, `FEC_API_KEY`,
  `DESE_API_BASE`.

✅ **Gate (public-data, from a machine with open egress):**
```bash
FEC_API_KEY=... CENSUS_API_KEY=... node scripts/smoke-public-data.mjs
```
A failing upstream degrades to `null` in production (graceful), but confirm the
shapes before you rely on the enrichment.

---

## 5. Publish the extension (optional)

For one-click install + auto-update across the volunteer team, submit to the
Chrome Web Store — full copy, permission justifications, and checklist in
`docs/chrome-web-store.md`. If the store assigns a **new** extension ID, update
`ALLOWED_ORIGIN` and the Clerk origin allow-list to match, then redeploy.

---

## Done when

- [ ] `/health` and `/ready` both 200 on the App Runner domain.
- [ ] A test clerk can sign in and sees role-correct lanes.
- [ ] Data persists across a redeploy (Airtable on).
- [ ] Any enabled provider (SMS/Calendar/Gmail) verified end-to-end.
- [ ] Clerk roles assigned for the real team.

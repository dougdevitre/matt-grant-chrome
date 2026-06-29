# Local testing guide

Run the whole thing on your own machine (you need **Chrome** for the side panel
and **Node 18+**). No credentials required — the backend runs with an in-memory
seeded store and dev sign-in.

## 1. Get the code

```bash
git clone <repo-url> && cd matt-grant-chrome
git checkout claude/vigilant-turing-qgsk84
npm install
```

## 2. Start the backend (terminal 1)

```bash
cp service/.env.example service/.env      # dev defaults are ready to use
npm run dev:service                        # http://localhost:8787
```

Sanity check: `curl http://localhost:8787/health` → `{"ok":true}`.

## 3. Build the extension (terminal 2)

```bash
npm run build:extension                    # outputs extension/dist/
```

(Use `npm run dev --workspace extension` instead if you want it to rebuild on
every edit; then just hit "Reload" on the extension card after changes.)

## 4. Load it in Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/dist/` folder.
4. The "Matt Grant for Congress — Clerk Tools" card appears with the MG icon.
5. Pin it and click the toolbar icon (or right-click → "Open side panel").

## 5. Sign in

On the sign-in screen:

| Field        | Value                                            |
| ------------ | ------------------------------------------------ |
| Service URL  | `http://localhost:8787`                          |
| Your name    | anything (e.g. `jordan`)                          |
| Role         | **Campaign Admin** (shows every tab)             |
| Access code  | `dev-only-change-me` (your `DEV_AUTH_SECRET`)     |

Pick different roles to see RBAC in action — each role only renders the tabs its
scopes allow (e.g. only List & Data and Admin see **Import**; only Compliance,
Social, and Admin see **Comms**).

## 6. What to exercise

- **Local** — enter County `St. Louis`, School district `Hazelwood`, ZIP `63031`
  → "Show my info" → Vote/Issues/Volunteer/Act cards.
- **Tasks** — claim / complete / skip seeded tasks; note registration tasks can
  only be completed during `PHASE_1_REGISTER`.
- **Schedule** — the seeded "Florissant Library Registration Drive"; claim a shift.
- **Import** — paste CSV → preview counts → commit; then see the contacts list.
- **Comms** — draft a template (disclaimer/opt-out auto-detected), approve as
  Compliance, send as Social. SMS sends are admin-only and need step-up.

## Notes & troubleshooting

- **`not_configured` error** = no Service URL was saved; sign in again with the
  URL filled. (This is the intended production guard — there is no localhost
  fallback baked into the build.)
- **CORS / "failed to fetch"**: the dev backend allows all origins, so this
  normally just works. If Chrome blocks the call because of host permissions,
  temporarily add `"http://localhost:8787/*"` to `host_permissions` in
  `extension/public/manifest.json`, rebuild, and reload — **revert before
  packaging for the store.**
- **Reset demo data**: restart `npm run dev:service` (the memory store re-seeds).
- **Token expired** after an hour: just sign in again.

## Testing against a live URL with real auth

This guide covers local dev (dev sign-in). To test against a deployed
HTTPS backend with real **Clerk** sign-in, see `docs/PRODUCTION_AUTH.md`
(and `docs/DEPLOY.md` for standing up the backend).

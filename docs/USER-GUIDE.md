# Clerk Tools — user guide

A plain-language guide for campaign clerks. If you're setting up the backend, see
`docs/deploy.md` and `docs/deploy-status.md` instead — this page is for the people who *use* the
extension.

The same steps are shown on the download page itself (the service root URL, e.g.
`https://ezvnqn5e5i.us-east-1.awsapprunner.com/`).

## 1. Install it (~2 minutes)

You only do this once, on a computer (Chrome, Edge, or Brave — not phones).

1. Go to the download page and click **Download for Chrome**.
2. **Unzip** the file. You'll get a folder named `matt-grant-clerk-extension`. Put it somewhere you
   won't delete it — if the folder goes away, so does the extension.
3. In Chrome, go to `chrome://extensions` (type it in the address bar).
4. Turn on **Developer mode** (switch in the top-right corner).
5. Click **Load unpacked** (top-left) and select the `matt-grant-clerk-extension` folder.
6. Click the puzzle-piece icon in the toolbar and **pin** "Clerk Tools" so the red icon stays visible.

> Developer mode is expected here — this is a campaign tool that isn't in the public Chrome store. It's
> safe. (A future version may be published to the Chrome Web Store for one-click install; when that
> happens the download page will simply link there instead.)

## 2. Sign in

1. Click the **red Clerk Tools icon** — the panel opens on the right.
2. On the **Clerk** tab, **sign in** with your campaign email. There's nothing to configure; the
   extension already knows which server to talk to.
3. The **first time** you sign in, an admin needs to give you a role. Until they do, you'll see a
   limited view. Message your campaign admin and tell them you've signed in.

## 3. Your role decides what you see

Once an admin sets your role, the matching tabs appear:

| Role | What you can do |
| --- | --- |
| Registration clerk | Reach voters about registering; send approved registration texts. |
| Voter-contact clerk | GOTV outreach; log voter conversations. |
| List-data clerk | Import and tag voter lists. |
| Events clerk | Manage events and volunteer shifts. |
| Social/comms clerk | Draft and send approved messages. |
| Compliance clerk | Approvals, opt-outs, and the audit log. |
| Admin | Everything, including assigning roles. |

**Guardrails that are always on:** text messages only send during allowed hours, messages require
approval before they go out, and anyone who replies STOP is opted out automatically.

## 4. Troubleshooting

- **"I'm signed in but nothing shows."** Your role isn't set yet — ask an admin to set it, then
  reopen the panel.
- **"The extension disappeared."** The folder was moved or deleted. Unzip the download again and
  redo **Load unpacked**.
- **"It can't reach the server."** Rare. Try again in a minute; if it persists, tell your admin.
- **Anything else** — contact your campaign admin.

## For admins — granting a role

After a clerk signs in once, set their role in the **Clerk dashboard**:

1. Open <https://dashboard.clerk.com> → your application → **Users**.
2. Click the clerk → **Public metadata** → **Edit** → enter `{ "role": "<role>" }` → **Save**.
3. Valid roles: `registration_clerk`, `voter_contact_clerk`, `list_data_clerk`, `compliance_clerk`,
   `events_clerk`, `social_comms_clerk`, `admin`.

To onboard many clerks at once, use `scripts/set-clerk-roles.mjs` with a CSV (see
`docs/clerk-setup.md`).

# Social blasts & volunteer amplification

The **Share** tab turns every clerk into an amplifier. The campaign publishes a
small library of approved, phase-relevant posts; volunteers copy the text +
hashtags or open their own platform's composer, share to **their own channels**,
and mark it shared. Nothing auto-posts — this is distributed, human-in-the-loop
sharing, the same posture as the GOTV follow-up sender.

## How it works

1. **Draft** — a Social & Comms Clerk (`comms.draft`) opens *Create a post*,
   picks a theme, and hits **Generate text + hashtags**. The server composes
   platform-tailored copy, a hashtag set, the right link, and a "Paid for by …"
   disclaimer from campaign facts (candidate, phase, links, committee name). The
   clerk edits and saves it as a draft.
2. **Approve** — a Compliance Clerk (`comms.approve`) reviews *Pending review*.
   Approval is **blocked** unless the disclaimer is present, exactly like the
   comms template pipeline.
3. **Share** — any signed-in clerk sees approved posts under *Share to your
   channels*. They pick a platform, **Copy** or **Share on X/Facebook/LinkedIn**
   (a web share-intent opens the platform's own composer), then **Mark shared**.
4. **Track** — every share is audited and rolls up into the media dashboard at
   the top of the tab (per-blast progress vs. goal, total shares, per-platform).

No OAuth, no API tokens, no secrets — opening a composer is just a new browser
tab, and copy uses the clipboard.

## Blast calendar

A **blast** is a coordinated wave of posts tied to the phase clock. Two blasts
are seeded out of the box (dev/memory store):

| Blast | Phase / window | Theme | Link | Seeded |
|---|---|---|---|---|
| Register by Jul 8 | `PHASE_1_REGISTER` → Jul 8 | Deadline urgency (no same-day reg) | SOS register | ✔ |
| Chip in for MO-02 | evergreen (all active phases) | Grassroots fundraising (WinRed) | `DONATE_URL` | ✔ |
| Make your plan | `PHASE_2_PLAN` (Jul 9–20) | Confirm reg + plan to vote | SOS status | create it |
| Early vote / Aug 4 turnout | `PHASE_3_TURNOUT` (Jul 21–Aug 4) | Early options, election-day push | Polling place | create it |

Create or reschedule blasts from the Share tab (`comms.draft`); advance a blast
`scheduled → active → done` with `comms.approve`.

Phase relevance is enforced on the read side: the Share tab lists only posts
whose `phases` include the current phase, and the dashboard features only an
active blast that is still phase-relevant — a "Register by Jul 8" blast left
active after the deadline drops off everyone's Share tab automatically (it
stays in the full blast list so the team can mark it done).

## Donations (WinRed)

The **donate** theme is an ordinary post whose link is a WinRed contribute page,
set via the `DONATE_URL` env/SSM value (see `service/.env.example`). WinRed is
**not** token-connected here — a donate ask is just an outbound link volunteers
share, matching the app's "link out, never embed" rule. **Verify the real
committee WinRed slug before launch.**

## Compliance (educational, not legal advice)

- Every shareable post carries the FEC **"Paid for by `COMMITTEE_NAME`"**
  disclaimer, and approval is blocked without it. The attribution is appended to
  the text volunteers actually copy or send to a composer (unless the body
  already inlines it), so the published post carries it too — not just the card
  in the side panel.
- Donation asks must not solicit contributions from foreign nationals and should
  carry the committee disclaimer. Genuinely personal, uncompensated volunteer
  speech has a narrower FEC disclaimer exemption, but campaign-supplied
  coordinated copy is safer with the attribution — so we keep it. Confirm
  specifics with campaign counsel.

## Endpoints

| Method | Path | Scope | Purpose |
|---|---|---|---|
| GET | `/social/posts?phase=&blastId=&category=&status=` | any clerk (approved); `comms.draft`/`comms.approve` for drafts | post library |
| POST | `/social/generate` | `comms.draft` | unsaved generated draft suggestion |
| POST | `/social/posts` | `comms.draft` | save a draft |
| POST | `/social/posts/:id/approve` | `comms.approve` | approve/reject (disclaimer gate) |
| POST | `/social/posts/:id/shared` | any clerk | self-report a share (audited, rate-limited per clerk) |
| GET | `/social/blasts?status=` | any clerk | list blasts |
| POST | `/social/blasts` | `comms.draft` | schedule a blast |
| POST | `/social/blasts/:id/status` | `comms.approve` | advance a blast's status |
| GET | `/dashboard/social` | any clerk | amplification dashboard (counts only) |

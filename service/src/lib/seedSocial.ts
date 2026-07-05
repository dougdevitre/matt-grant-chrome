// Shared social seed content: the starter blast calendar + a few approved,
// ready-to-share posts. Used two ways from ONE source of truth:
//   1. the in-memory store seeds it on boot (so dev/tests are non-empty), and
//   2. `scripts/seed-social.mjs` runs it against a live store (e.g. Airtable)
//      so production isn't empty on day one.
//
// Idempotent by default: if the store already holds any social posts it skips,
// so re-running against a populated Airtable base is safe. Pass { force: true }
// to seed regardless (used only for a deliberate reseed).

import { COMMITTEE_NAME, DONATE_URL } from "../config.js";
import type { StorePort, NewSocialPost } from "./store.js";
import type { Phase } from "./types.js";

const ALL_PHASES: Phase[] = ["PHASE_1_REGISTER", "PHASE_2_PLAN", "PHASE_3_TURNOUT"];
const REG_LINK = "https://www.sos.mo.gov/elections/goVoteMissouri/register";
const POLLING_LINK =
  "https://www.sos.mo.gov/elections/goVoteMissouri/findyourpollingplace";

export interface SeedSocialResult {
  blasts: number;
  posts: number;
  skipped: boolean;
}

export async function seedSocialContent(
  store: StorePort,
  { force = false }: { force?: boolean } = {}
): Promise<SeedSocialResult> {
  // Idempotency: don't double-seed a store that already has posts.
  const existing = await store.listSocialPosts({});
  if (existing.length > 0 && !force) {
    return { blasts: 0, posts: 0, skipped: true };
  }

  const disclaimer = `Paid for by ${COMMITTEE_NAME}.`;

  // Create then approve (seed posts are shareable immediately).
  const seedPost = async (input: NewSocialPost): Promise<void> => {
    const p = await store.createSocialPost(input);
    await store.putSocialPost({
      ...p,
      status: "approved",
      complianceApprovalId: "seed_approved",
    });
  };

  const registerBlast = await store.createSocialBlast({
    title: "Register by Jul 8",
    theme: "Registration deadline urgency (no same-day registration in MO).",
    phases: ["PHASE_1_REGISTER"],
    scheduledFor: "2026-07-01T09:00:00-05:00",
    goal: 150,
    status: "active",
    createdBy: "seed",
  });
  const donateBlast = await store.createSocialBlast({
    title: "Chip in for MO-02",
    theme: "Evergreen grassroots fundraising ask (WinRed).",
    phases: ALL_PHASES,
    scheduledFor: "2026-07-01T09:00:00-05:00",
    goal: 200,
    status: "active",
    createdBy: "seed",
  });

  await seedPost({
    blastId: registerBlast.id,
    category: "register",
    phases: ["PHASE_1_REGISTER"],
    title: "Register deadline — Jul 8",
    variants: [
      {
        platform: "x",
        text: "Missouri's voter registration deadline for the Aug 4 primary is Jul 8 — no same-day registration. Register today and back Matt Grant for Congress in MO-02.",
      },
      {
        platform: "facebook",
        text: "The deadline to register for Missouri's Aug 4 primary is July 8 — and there's no same-day registration. Take two minutes now so you can vote for Matt Grant in MO-02. Share this with a friend who hasn't registered yet!",
      },
    ],
    hashtags: ["#MO02", "#MattGrant", "#RegisterToVote", "#MissouriPrimary"],
    linkUrl: REG_LINK,
    disclaimer,
    hasDisclaimer: true,
    status: "draft",
    createdBy: "seed",
  });
  await seedPost({
    blastId: donateBlast.id,
    category: "donate",
    phases: ALL_PHASES,
    title: "Chip in — grassroots ask",
    variants: [
      {
        platform: "x",
        text: "Grassroots donors — not DC insiders — power this campaign. Chip in $10 to help send Matt Grant to Congress for MO-02.",
      },
      {
        platform: "facebook",
        text: "This campaign runs on grassroots support from neighbors like you, not DC special interests. Can you chip in $10 today to help Matt Grant win MO-02? Every dollar goes straight to reaching voters before Aug 4.",
      },
    ],
    hashtags: ["#MO02", "#MattGrant", "#Grassroots"],
    linkUrl: DONATE_URL,
    disclaimer,
    hasDisclaimer: true,
    status: "draft",
    createdBy: "seed",
  });
  await seedPost({
    blastId: null,
    category: "turnout",
    phases: ["PHASE_3_TURNOUT"],
    title: "Aug 4 — polls open",
    variants: [
      {
        platform: "x",
        text: "Today's the day, MO-02! Polls are open until 7pm. Bring a photo ID and vote for Matt Grant for Congress in the Aug 4 primary.",
      },
    ],
    hashtags: ["#MO02", "#MattGrant", "#VoteAug4"],
    linkUrl: POLLING_LINK,
    disclaimer,
    hasDisclaimer: true,
    status: "draft",
    createdBy: "seed",
  });

  return { blasts: 2, posts: 3, skipped: false };
}

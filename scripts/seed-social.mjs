#!/usr/bin/env node
// Seed the starter social blast calendar + approved posts into the configured
// store, so the Share tab and /dashboard/social aren't empty on day one.
//
// The in-memory store seeds this automatically; production (Airtable) starts
// empty, so run this once after the tables exist. It reuses the same content +
// domain logic as the memory seed (service/src/lib/seedSocial.ts) and is
// idempotent — if the store already has social posts it skips (pass --force to
// seed anyway).
//
// Prereqs: create the `SocialPosts` + `SocialBlasts` Airtable tables first (see
// docs/airtable-setup.md). This script builds the service, so run it from the
// repo root:
//
//   STORE_DRIVER=airtable AIRTABLE_PAT=<pat> AIRTABLE_BASE_ID=appkOfv2eLaDMAjPu \
//   CONTACT_KEY_SALT=<salt> DONATE_URL=https://secure.winred.com/<slug> \
//     npm run seed:social
//
// (In SSM-backed deploys, export the same values as env for this one run, or set
// SSM_PREFIX so getConfig resolves them. DONATE_URL sets the donate post's link.)

import { getStore } from "../service/dist/lib/store.js";
import { seedSocialContent } from "../service/dist/lib/seedSocial.js";

const force = process.argv.includes("--force");

try {
  const store = await getStore();
  const result = await seedSocialContent(store, { force });
  if (result.skipped) {
    console.log(
      "Skipped — the store already has social posts. Re-run with --force to seed anyway."
    );
  } else {
    console.log(
      `Seeded ${result.blasts} blasts and ${result.posts} approved posts.`
    );
  }
  process.exit(0);
} catch (err) {
  console.error("seed:social failed:", err instanceof Error ? err.message : err);
  process.exit(1);
}

// Unit: the shared social seed content. Verifies it produces approved posts with
// disclaimers, is idempotent (safe to re-run against a populated store), and can
// be forced. Runs against a fresh in-memory store — but the memory store already
// self-seeds on construction, so we assert relative to that baseline.

import { describe, expect, it } from "vitest";
import { makeMemoryStore } from "../lib/storeMemory.js";
import { seedSocialContent } from "../lib/seedSocial.js";

describe("seedSocialContent", () => {
  it("the memory store is already seeded (skips a second run)", async () => {
    const store = makeMemoryStore();
    // The store seeds asynchronously; wait for at least one post to appear.
    for (let i = 0; i < 20 && (await store.listSocialPosts({})).length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const before = await store.listSocialPosts({});
    expect(before.length).toBeGreaterThanOrEqual(3);

    const result = await seedSocialContent(store);
    expect(result.skipped).toBe(true);
    expect((await store.listSocialPosts({})).length).toBe(before.length);
  });

  it("seeds approved posts with valid disclaimers when forced", async () => {
    const store = makeMemoryStore();
    const result = await seedSocialContent(store, { force: true });
    expect(result.skipped).toBe(false);
    expect(result.blasts).toBe(2);
    expect(result.posts).toBe(3);

    const posts = await store.listSocialPosts({ status: "approved" });
    // Every seeded post is approved and carries a disclaimer.
    for (const p of posts) {
      expect(p.status).toBe("approved");
      expect(p.hasDisclaimer).toBe(true);
      expect(p.complianceApprovalId).toBeTruthy();
    }
    // The donate post exists and links somewhere (the configured WinRed URL).
    const donate = posts.find((p) => p.category === "donate");
    expect(donate).toBeDefined();
    expect(donate!.linkUrl).toBeTruthy();
  });
});

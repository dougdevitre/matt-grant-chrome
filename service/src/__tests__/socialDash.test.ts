// Media dashboard phase relevance: an active blast whose phases have passed
// (e.g. "Register by Jul 8" after the registration deadline) must not stay
// featured on everyone's Share tab, but stays in byBlast for the team to close.

import { beforeEach, describe, expect, it } from "vitest";
import { resetStoreForTests } from "../lib/store.js";
import { socialDashboard } from "../lib/socialDash.js";

beforeEach(() => {
  resetStoreForTests();
});

describe("socialDashboard activeBlast phase relevance", () => {
  it("features an active blast during PHASE_1 (both seeded blasts qualify)", async () => {
    const dash = await socialDashboard(new Date("2026-07-01T12:00:00-05:00"));
    expect(dash.activeBlast).not.toBeNull();
  });

  it("stops featuring the register blast after the registration deadline", async () => {
    // Jul 15 is PHASE_2_PLAN: the register blast is still "active" in the store
    // but no longer phase-relevant; the evergreen donate blast is featured.
    const dash = await socialDashboard(new Date("2026-07-15T12:00:00-05:00"));
    expect(dash.activeBlast?.title).toBe("Chip in for MO-02");
    // The stale blast remains listed so the team can see it and mark it done.
    expect(dash.byBlast.some((b) => b.title === "Register by Jul 8")).toBe(true);
  });

  it("features nothing once the election is closed", async () => {
    const dash = await socialDashboard(new Date("2026-09-01T12:00:00-05:00"));
    expect(dash.activeBlast).toBeNull();
  });
});

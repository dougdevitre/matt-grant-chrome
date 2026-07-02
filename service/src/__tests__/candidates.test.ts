// The "Who's on the ballot" card lists the real MO-02 primary field.

import { describe, expect, it } from "vitest";
import { resolveLocalContext } from "../lib/locationResolver.js";
import { primaryNames } from "../data/mo02Candidates.js";

describe("MO-02 candidates", () => {
  it("marks the incumbent and includes the challenger", () => {
    const r = primaryNames("R");
    expect(r).toContain("Ann Wagner (incumbent)");
    expect(r).toContain("Matt Grant");
  });

  it("surfaces the real R primary field in the issues.candidates card", async () => {
    const res = await resolveLocalContext(
      {
        county: "Franklin County",
        schoolDistrict: "Washington School District",
        zip: "63090",
        address: null,
      },
      ["voter.read"],
      new Date("2026-07-15T12:00:00Z")
    );
    const card = res.cards.find((c) => c.id === "issues.candidates");
    expect(card?.body).toContain("Ann Wagner");
    expect(card?.body).toContain("Matt Grant");
  });
});

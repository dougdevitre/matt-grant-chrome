// Unit: the template social-post generator. Deterministic output, a valid FEC
// disclaimer, an X variant that stays within tweet length, and a donate variant
// that points at the configured WinRed URL.

import { describe, expect, it } from "vitest";
import { getGenerator, CATEGORIES } from "../lib/socialGen.js";
import { COMMITTEE_NAME, DONATE_URL } from "../config.js";
import { detectDisclaimer } from "../lib/social.js";

const gen = getGenerator();

describe("socialGen (template driver)", () => {
  it("is deterministic — same input, identical output", () => {
    const a = gen.generate({ category: "register" });
    const b = gen.generate({ category: "register" });
    expect(a).toEqual(b);
  });

  it("carries a valid 'Paid for by <committee>' disclaimer for every category", () => {
    for (const category of CATEGORIES) {
      const post = gen.generate({ category });
      expect(post.disclaimer).toContain("Paid for by");
      expect(post.disclaimer).toContain(COMMITTEE_NAME);
      expect(detectDisclaimer(post.disclaimer)).toBe(true);
    }
  });

  it("keeps the X variant within tweet length once the link + hashtags are added", () => {
    for (const category of CATEGORIES) {
      const post = gen.generate({ category });
      const x = post.variants.find((v) => v.platform === "x")!;
      // X counts a URL as 23 chars regardless of length; approximate that.
      const tags = post.hashtags.join(" ");
      const approxLen = x.text.length + 1 + tags.length + 1 + 23;
      expect(approxLen).toBeLessThanOrEqual(280);
    }
  });

  it("attaches phase relevance per category (donate is evergreen)", () => {
    expect(gen.generate({ category: "register" }).phases).toEqual(["PHASE_1_REGISTER"]);
    expect(gen.generate({ category: "donate" }).phases).toEqual([
      "PHASE_1_REGISTER",
      "PHASE_2_PLAN",
      "PHASE_3_TURNOUT",
    ]);
  });

  it("routes the donate post to the configured WinRed URL", () => {
    const post = gen.generate({ category: "donate" });
    expect(post.linkUrl).toBe(DONATE_URL);
    expect(post.hashtags).toContain("#ChipIn");
  });

  it("passes a blastId through onto the draft", () => {
    expect(gen.generate({ category: "turnout", blastId: "blast_1" }).blastId).toBe("blast_1");
  });
});

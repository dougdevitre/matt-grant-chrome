import { describe, it, expect } from "vitest";
import {
  buildShareUrl,
  composeShareText,
  variantFor,
} from "./shareLinks.js";

const content = {
  text: "Vote for MO-02!",
  url: "https://example.org/vote",
  hashtags: ["#MO02", "#VoteAug4"],
};

describe("buildShareUrl", () => {
  it("builds an X intent with text + url", () => {
    const url = buildShareUrl("x", content)!;
    expect(url).toContain("twitter.com/intent/tweet");
    expect(url).toContain(encodeURIComponent("Vote for MO-02!"));
    expect(url).toContain(encodeURIComponent("#MO02 #VoteAug4"));
    expect(url).toContain(`url=${encodeURIComponent(content.url)}`);
  });

  it("builds a Facebook sharer with the url", () => {
    const url = buildShareUrl("facebook", content)!;
    expect(url).toContain("facebook.com/sharer");
    expect(url).toContain(encodeURIComponent(content.url));
  });

  it("builds a LinkedIn share-offsite with the url", () => {
    const url = buildShareUrl("linkedin", content)!;
    expect(url).toContain("linkedin.com/sharing/share-offsite");
    expect(url).toContain(encodeURIComponent(content.url));
  });

  it("returns null for the copy affordance (clipboard fallback)", () => {
    expect(buildShareUrl("copy", content)).toBeNull();
  });

  it("omits url= on X when there is no link", () => {
    const url = buildShareUrl("x", { ...content, url: null })!;
    expect(url).not.toContain("url=");
  });

  it("falls back to copy (null) for Facebook/LinkedIn when there is no link", () => {
    // Both intents are URL-based; without a link they'd open a broken sharer.
    expect(buildShareUrl("facebook", { ...content, url: null })).toBeNull();
    expect(buildShareUrl("linkedin", { ...content, url: null })).toBeNull();
  });

  it("includes the disclaimer in the X intent text", () => {
    const url = buildShareUrl("x", {
      ...content,
      disclaimer: "Paid for by Matt Grant for Congress.",
    })!;
    expect(url).toContain(encodeURIComponent("Paid for by Matt Grant for Congress."));
  });
});

describe("composeShareText", () => {
  it("joins body, hashtags, and link", () => {
    const text = composeShareText(content);
    expect(text).toContain("Vote for MO-02!");
    expect(text).toContain("#MO02 #VoteAug4");
    expect(text).toContain(content.url);
  });

  it("skips an empty link cleanly", () => {
    const text = composeShareText({ ...content, url: null });
    expect(text.endsWith("#MO02 #VoteAug4")).toBe(true);
  });

  it("appends the disclaimer so the published post carries the attribution", () => {
    const text = composeShareText({
      ...content,
      disclaimer: "Paid for by Matt Grant for Congress.",
    });
    expect(text.endsWith("Paid for by Matt Grant for Congress.")).toBe(true);
  });

  it("does not duplicate an attribution already inlined in the body", () => {
    const text = composeShareText({
      ...content,
      text: "Chip in! Paid for by Matt Grant for Congress.",
      disclaimer: "Paid for by Matt Grant for Congress.",
    });
    expect(text.match(/paid for by/gi)?.length).toBe(1);
  });
});

describe("variantFor", () => {
  const variants = [
    { platform: "x" as const, text: "short" },
    { platform: "facebook" as const, text: "long" },
  ];
  it("returns the matching platform's text", () => {
    expect(variantFor(variants, "facebook")).toBe("long");
  });
  it("falls back to the first variant when the platform is missing", () => {
    expect(variantFor(variants, "linkedin")).toBe("short");
  });
});

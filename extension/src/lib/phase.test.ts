// Display-only countdown formatter. The server owns the real phase; this just
// formats remaining time for the banner.

import { describe, expect, it } from "vitest";
import { timeRemaining } from "./phase.js";

describe("timeRemaining", () => {
  it("formats multi-day spans as days + hours", () => {
    const now = new Date("2026-07-06T00:00:00Z");
    expect(timeRemaining("2026-07-08T05:00:00Z", now)).toBe("2d 5h");
  });

  it("formats sub-day spans as hours + minutes", () => {
    const now = new Date("2026-07-08T00:00:00Z");
    expect(timeRemaining("2026-07-08T03:30:00Z", now)).toBe("3h 30m");
  });

  it("returns 'now' once the deadline has passed", () => {
    const now = new Date("2026-07-09T00:00:00Z");
    expect(timeRemaining("2026-07-08T00:00:00Z", now)).toBe("now");
  });

  it("returns an empty string for an unparseable deadline", () => {
    expect(timeRemaining("not-a-date", new Date("2026-07-08T00:00:00Z"))).toBe("");
  });
});

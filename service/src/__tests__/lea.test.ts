// resolveLea now returns real office contact details for the MO-02 counties and
// keeps the null placeholders + SOS fallback for everything else.

import { describe, expect, it } from "vitest";
import { resolveLea } from "../lib/lea.js";

describe("resolveLea — MO-02 county authorities", () => {
  it("returns real contact details for a County Clerk county (Franklin)", () => {
    const lea = resolveLea("Franklin County");
    expect(lea.kind).toBe("county_clerk");
    expect(lea.name).toBe("Franklin County Clerk");
    expect(lea.jurisdictionUrl).toContain("franklinmo.org");
    expect(lea.phone).toBe("(636) 583-6355");
    expect(lea.address).toContain("Union, MO");
  });

  it("returns a Board of Election Commissioners for St. Louis County", () => {
    const lea = resolveLea("St. Louis County");
    expect(lea.kind).toBe("board_of_election_commissioners");
    expect(lea.jurisdictionUrl).toContain("stlouiscountymo.gov");
    expect(lea.phone).toBe("(314) 615-1800");
  });

  it("matches a bare county name without the word 'county' (Warren)", () => {
    const lea = resolveLea("Warren");
    expect(lea.jurisdictionUrl).toContain("warrencountymoclerk.com");
    expect(lea.address).toContain("Warrenton, MO");
  });

  it("falls back to null details + SOS lookup for an unknown county", () => {
    const lea = resolveLea("Nowhere County");
    expect(lea.jurisdictionUrl).toBeNull();
    expect(lea.phone).toBeNull();
    expect(lea.address).toBeNull();
    expect(lea.sosLookupUrl).toContain("sos.mo.gov");
  });
});

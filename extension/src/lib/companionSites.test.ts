import { describe, expect, it } from "vitest";
import { companionBody, matchCompanion } from "./companionSites.js";
import type { Scope } from "./types.js";

const S = (...s: string[]) => s as Scope[];

describe("matchCompanion", () => {
  it("matches SOS hosts (incl. subdomains) for a voter.read role", () => {
    expect(matchCompanion("www.sos.mo.gov", S("voter.read"))?.id).toBe("sos");
    expect(matchCompanion("voteroutreach.sos.mo.gov", S("voter.read"))?.id).toBe("sos");
    expect(matchCompanion("sos.mo.gov", S("voter.read"))?.id).toBe("sos");
  });

  it("gates Airtable behind a list scope", () => {
    expect(matchCompanion("airtable.com", S("list.import"))?.id).toBe("airtable");
    // voter.read alone can't use the Airtable importer companion.
    expect(matchCompanion("airtable.com", S("voter.read"))).toBeNull();
  });

  it("matches Google Sheets for list.import", () => {
    expect(matchCompanion("docs.google.com", S("list.import"))?.id).toBe("google-sheets");
  });

  it("returns null for non-allow-listed hosts and for no host", () => {
    expect(matchCompanion("example.com", S("voter.read", "list.import"))).toBeNull();
    expect(matchCompanion(null, S("voter.read"))).toBeNull();
  });

  it("returns null when the role lacks the required scope", () => {
    expect(matchCompanion("www.sos.mo.gov", S())).toBeNull();
  });

  it("matches the four county election-office domains (voter.read)", () => {
    for (const h of [
      "stlouiscountymo.gov",
      "www.sccmo.org",
      "www.franklinmo.org",
      "warrencountymoclerk.com",
    ]) {
      expect(matchCompanion(h, S("voter.read"))?.id).toBe("county-office");
    }
  });

  it("role-gates the workflow companions", () => {
    expect(matchCompanion("mail.google.com", S("contact.log"))?.id).toBe("gmail");
    expect(matchCompanion("calendar.google.com", S("events.write"))?.id).toBe("calendar");
    expect(matchCompanion("winred.com", S("finance.read"))?.id).toBe("winred");
    // The social card is open to any signed-in role — everyone can amplify an
    // approved post from the Share tab to their own channels.
    expect(matchCompanion("www.facebook.com", S("comms.draft"))?.id).toBe("social");
    expect(matchCompanion("www.facebook.com", S("voter.read"))?.id).toBe("social");
    // Wrong scope → no card (finance-gated).
    expect(matchCompanion("winred.com", S("voter.read"))).toBeNull();
  });
});

describe("companionBody (phase-aware tips)", () => {

  it("swaps the stale registration-deadline copy after Jul 8 (PHASE_2)", () => {
    const site = matchCompanion("www.sos.mo.gov", S("voter.read"))!;
    expect(companionBody(site, "PHASE_2_PLAN")).toMatch(/deadline .* has passed/i);
    expect(companionBody(site, "PHASE_2_PLAN")).not.toMatch(/deadline .* is Jul 8/i);
  });

  it("falls back to the default body for PHASE_1 and unknown phase", () => {
    const site = matchCompanion("www.sos.mo.gov", S("voter.read"))!;
    expect(companionBody(site, "PHASE_1_REGISTER")).toBe(site.body);
    expect(companionBody(site, null)).toBe(site.body);
  });

  it("covers the county-office card too", () => {
    const site = matchCompanion("stlouiscountymo.gov", S("voter.read"))!;
    expect(companionBody(site, "PHASE_3_TURNOUT")).toMatch(/early voting/i);
  });
});

// Public-data clients, verified with deterministic mocked fetch against each
// provider's documented response shape. (Live verification wasn't possible from
// the build sandbox — egress is restricted to an allowlist — so these parser
// tests are the regression net.) Every client must degrade to null/empty on
// failure so a slow/down upstream never breaks a request.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  demographicsForZip,
  raceFinanceContext,
  nearbyVenues,
  districtProfile,
  geocodeAddress,
} from "../lib/publicData.js";

function mockFetchOnce(payload: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CENSUS_API_KEY;
  delete process.env.FEC_API_KEY;
  delete process.env.DESE_API_BASE;
});

describe("demographicsForZip (ACS)", () => {
  it("parses the header+row matrix", async () => {
    mockFetchOnce([
      ["NAME", "B01003_001E", "B19013_001E", "zip code tabulation area"],
      ["ZCTA5 63031", "51234", "72000", "63031"],
    ]);
    const d = await demographicsForZip("63031");
    expect(d).toEqual({
      zip: "63031",
      name: "ZCTA5 63031",
      population: 51234,
      medianHouseholdIncome: 72000,
    });
  });

  it("rejects a non-5-digit zip without calling the network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await demographicsForZip("abc")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns null when the upstream errors", async () => {
    mockFetchOnce({}, false);
    expect(await demographicsForZip("63031")).toBeNull();
  });
});

describe("raceFinanceContext (FEC)", () => {
  it("summarizes candidates and flags a competitive race", async () => {
    mockFetchOnce({
      results: [
        { candidate_name: "A", party_full: "REP", total_receipts: 900000, cash_on_hand_end_period: 100000, incumbent_challenge_full: "Incumbent" },
        { candidate_name: "B", party_full: "REP", total_receipts: 500000, incumbent_challenge_full: "Challenger" },
      ],
    });
    const ctx = await raceFinanceContext("MO", "02");
    expect(ctx?.candidates).toHaveLength(2);
    expect(ctx?.candidates[0].receipts).toBe(900000);
    expect(ctx?.competitive).toBe(true); // 900k <= 500k * 3
  });

  it("is not competitive when one candidate dominates", async () => {
    mockFetchOnce({
      results: [
        { candidate_name: "A", total_receipts: 2000000 },
        { candidate_name: "B", total_receipts: 100000 },
      ],
    });
    expect((await raceFinanceContext("MO", "02"))?.competitive).toBe(false);
  });

  it("returns null on a malformed body", async () => {
    mockFetchOnce({ nope: true });
    expect(await raceFinanceContext("MO", "02")).toBeNull();
  });
});

describe("nearbyVenues (OSM/Overpass)", () => {
  it("maps named nodes and skips unnamed ones", async () => {
    mockFetchOnce({
      elements: [
        { lat: 38.79, lon: -90.32, tags: { name: "Florissant Valley Library", amenity: "library" } },
        { lat: 38.8, lon: -90.33, tags: { amenity: "community_centre" } }, // no name -> skipped
      ],
    });
    const venues = await nearbyVenues(38.79, -90.32);
    expect(venues).toEqual([
      { name: "Florissant Valley Library", lat: 38.79, lng: -90.32, kind: "library" },
    ]);
  });

  it("returns [] without coordinates", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await nearbyVenues(null, null)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("districtProfile (DESE)", () => {
  it("returns a typed null-profile when no DESE base is configured", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await districtProfile("Hazelwood")).toEqual({
      name: "Hazelwood",
      enrollment: null,
      source: null,
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads enrollment from a configured DESE base", async () => {
    process.env.DESE_API_BASE = "https://dese.example.com";
    mockFetchOnce({ enrollment: 17890 });
    const p = await districtProfile("Hazelwood");
    expect(p?.enrollment).toBe(17890);
    expect(p?.source).toBe("https://dese.example.com");
  });
});

describe("geocodeAddress (parser, captured Census payload)", () => {
  it("extracts census block + MO-02 congressional district", async () => {
    mockFetchOnce({
      result: {
        addressMatches: [
          {
            coordinates: { x: -90.32, y: 38.79 },
            geographies: {
              "Census Blocks": [{ GEOID: "295101234001023" }],
              "119th Congressional Districts": [{ GEOID: "2902" }],
            },
          },
        ],
      },
    });
    const g = await geocodeAddress("1 Government Center, Florissant, MO 63031");
    expect(g.lat).toBe(38.79);
    expect(g.lng).toBe(-90.32);
    expect(g.censusBlock).toBe("295101234001023");
    expect(g.congressionalDistrict).toBe("MO-02");
  });

  it("returns nulls for an empty address without calling the network", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    expect(await geocodeAddress("")).toEqual({
      lat: null,
      lng: null,
      censusBlock: null,
      congressionalDistrict: null,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

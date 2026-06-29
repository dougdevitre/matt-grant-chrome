// resolveLocalContext attaches public-data enrichment only when
// ENRICH_RESOLVE=true, and it degrades gracefully. Fetch is mocked so the test
// is deterministic and offline.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLocalContext } from "../lib/locationResolver.js";
import type { Scope } from "../lib/types.js";

const INPUT = {
  county: "St. Louis",
  schoolDistrict: "Hazelwood",
  zip: "63031",
  address: "1 Government Center, Florissant, MO 63031",
};
const SCOPES: Scope[] = ["voter.read"];
const NOW = new Date("2026-07-01T12:00:00Z");

// Route the mocked fetch by URL: geocoder, ACS, Overpass.
function routedFetch() {
  return vi.fn(async (url: string) => {
    const body = (data: unknown) => ({
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    });
    if (url.includes("geocoding.geo.census.gov")) {
      return body({
        result: {
          addressMatches: [
            {
              coordinates: { x: -90.32, y: 38.79 },
              geographies: {
                "Census Blocks": [{ GEOID: "295101234001023" }],
                "Congressional Districts": [{ GEOID: "2902" }],
              },
            },
          ],
        },
      });
    }
    if (url.includes("api.census.gov")) {
      return body([
        ["NAME", "B01003_001E", "B19013_001E", "zip code tabulation area"],
        ["ZCTA5 63031", "51234", "72000", "63031"],
      ]);
    }
    if (url.includes("overpass-api.de")) {
      return body({
        elements: [{ lat: 38.79, lon: -90.32, tags: { name: "Florissant Library", amenity: "library" } }],
      });
    }
    return body({});
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", routedFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ENRICH_RESOLVE;
});

describe("resolveLocalContext enrichment", () => {
  it("omits enrichment by default", async () => {
    delete process.env.ENRICH_RESOLVE;
    const res = await resolveLocalContext(INPUT, SCOPES, NOW);
    expect(res.enrichment).toBeUndefined();
    // Geocode still drives confidence to HIGH.
    expect(res.location.confidence).toBe("HIGH");
  });

  it("attaches demographics + venues when ENRICH_RESOLVE=true", async () => {
    process.env.ENRICH_RESOLVE = "true";
    const res = await resolveLocalContext(INPUT, SCOPES, NOW);
    expect(res.enrichment?.demographics).toEqual({
      population: 51234,
      medianHouseholdIncome: 72000,
    });
    expect(res.enrichment?.venues).toEqual([
      { name: "Florissant Library", lat: 38.79, lng: -90.32, kind: "library" },
    ]);
  });
});

// Public-data clients. These run server-side ONLY so API keys never reach the
// extension. The Census geocoder is now implemented; other sources remain
// clearly-labeled stubs with their integration points noted.
//
// Sources (all free / public domain unless noted):
//   - Census Geocoder: validate address, return census block + congressional district [IMPLEMENTED]
//   - Census ACS API: zip/tract demographics (needs CENSUS_API_KEY) [stub]
//   - MO SOS: local election authority, polling place, sample ballot (LINK OUT; do not scrape)
//   - MO DESE / NCES: school-district profile + local measures [stub]
//   - FEC API: competitive finance context (needs FEC_API_KEY) [stub]
//   - OpenStreetMap Overpass: public venues for drives (ODbL — attribute) [stub]

import type { Confidence } from "./types.js";

export interface GeocodeResult {
  lat: number | null;
  lng: number | null;
  censusBlock: string | null; // 15-digit GEOID
  congressionalDistrict: string | null; // e.g. "MO-02"
}

const GEOCODER_BASE =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const GEOCODE_TIMEOUT_MS = 5000;

// State FIPS -> USPS, so we can form "MO-02" from a Census GEOID like "2902".
const FIPS_TO_USPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};

interface CensusGeographyEntry {
  GEOID?: string;
  [key: string]: unknown;
}

/** Find the first geographies bucket whose key matches a pattern. */
function pickGeography(
  geographies: Record<string, CensusGeographyEntry[]> | undefined,
  pattern: RegExp
): CensusGeographyEntry | null {
  if (!geographies) return null;
  for (const key of Object.keys(geographies)) {
    if (pattern.test(key)) {
      const arr = geographies[key];
      if (Array.isArray(arr) && arr.length > 0) return arr[0];
    }
  }
  return null;
}

/** Census CD GEOID is state FIPS (2) + district (2), e.g. "2902" -> MO-02. */
function cdFromGeoid(geoid?: string): string | null {
  if (!geoid || geoid.length < 4) return null;
  const stateFips = geoid.slice(0, 2);
  const district = geoid.slice(2).padStart(2, "0");
  const usps = FIPS_TO_USPS[stateFips] ?? stateFips; // unknown -> FIPS prefix (won't match "MO-02")
  return `${usps}-${district}`;
}

/**
 * Geocode a one-line address via the Census geocoder and return its census
 * block + congressional district. Returns nulls (graceful) on any failure or
 * when no address is supplied — callers treat that as lower confidence.
 */
export async function geocodeAddress(
  address?: string | null
): Promise<GeocodeResult> {
  const empty: GeocodeResult = {
    lat: null,
    lng: null,
    censusBlock: null,
    congressionalDistrict: null,
  };
  if (!address || !address.trim()) return empty;

  const url =
    `${GEOCODER_BASE}?address=${encodeURIComponent(address.trim())}` +
    `&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return empty;
    const json = (await res.json()) as {
      result?: {
        addressMatches?: Array<{
          coordinates?: { x?: number; y?: number };
          geographies?: Record<string, CensusGeographyEntry[]>;
        }>;
      };
    };

    const match = json.result?.addressMatches?.[0];
    if (!match) return empty;

    const block = pickGeography(match.geographies, /Census Blocks/i);
    const cd = pickGeography(match.geographies, /Congressional Districts/i);

    return {
      lat: typeof match.coordinates?.y === "number" ? match.coordinates.y : null,
      lng: typeof match.coordinates?.x === "number" ? match.coordinates.x : null,
      censusBlock: typeof block?.GEOID === "string" ? block.GEOID : null,
      congressionalDistrict: cdFromGeoid(
        typeof cd?.GEOID === "string" ? cd.GEOID : undefined
      ),
    };
  } catch {
    // Timeout, network error, or unexpected shape — degrade gracefully.
    return empty;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve a Missouri county to its Local Election Authority (Phase 4). */
export async function leaForCounty(
  county: string
): Promise<{ leaId: string | null; name: string | null; url: string; kind: string }> {
  const { resolveLea } = await import("./lea.js");
  const lea = resolveLea(county);
  return {
    leaId: lea.leaId,
    name: lea.name,
    url: lea.jurisdictionUrl ?? lea.sosLookupUrl,
    kind: lea.kind,
  };
}

/**
 * Confidence is HIGH only when we successfully resolved a congressional
 * district from a real address geocode. A supplied-but-unresolved address
 * stays MEDIUM (we have county+district+zip), and missing fields are LOW.
 */
export function inferConfidence(
  county: string,
  schoolDistrict: string,
  zip: string,
  geocodedDistrict: string | null
): Confidence {
  if (geocodedDistrict) return "HIGH";
  if (county && schoolDistrict && /^\d{5}$/.test(zip)) return "MEDIUM";
  return "LOW";
}

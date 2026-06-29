// Public-data clients. These run server-side ONLY so API keys never reach the
// extension. Each applies a timeout and degrades to null/empty on failure.
//
// Sources (all free / public domain unless noted):
//   - Census Geocoder: validate address, return census block + congressional district [IMPLEMENTED]
//   - Census ACS API: zip (ZCTA) demographics (CENSUS_API_KEY optional) [IMPLEMENTED]
//   - FEC API: race finance context (FEC_API_KEY, falls back to DEMO_KEY) [IMPLEMENTED]
//   - OpenStreetMap Overpass: public venues for drives (ODbL — attribute) [IMPLEMENTED]
//   - MO DESE / NCES: school-district profile (DESE_API_BASE; honest null fallback) [IMPLEMENTED]
//   - MO SOS: local election authority, polling place, sample ballot (LINK OUT; do not scrape)

import { getConfig } from "../config.js";
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

// ---------------------------------------------------------------------------
// Shared fetch helper + additional public-data clients.
//
// All clients are server-side only (keys never reach the extension), apply a
// timeout, and degrade gracefully — returning null/empty on any failure — so a
// slow or down upstream never breaks a request. NOTE: live verification of
// these endpoints was not possible from the build sandbox (egress is restricted
// to an allowlist), so they are covered by deterministic mocked-fetch tests
// against each provider's documented response shape.
// ---------------------------------------------------------------------------

const HTTP_TIMEOUT_MS = 6000;

async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = HTTP_TIMEOUT_MS
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null; // timeout, network error, or non-JSON body
  } finally {
    clearTimeout(timer);
  }
}

// --- Census ACS: zip (ZCTA) demographics -----------------------------------

export interface AcsDemographics {
  zip: string;
  name: string | null;
  population: number | null;
  medianHouseholdIncome: number | null;
}

const ACS_BASE = "https://api.census.gov/data/2022/acs/acs5";

/**
 * Population + median household income for a ZCTA. CENSUS_API_KEY is optional
 * (the API allows keyless low-volume use). Returns nulls on any failure.
 */
export async function demographicsForZip(zip?: string | null): Promise<AcsDemographics | null> {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  const key = await getConfig("CENSUS_API_KEY");
  const url =
    `${ACS_BASE}?get=NAME,B01003_001E,B19013_001E` +
    `&for=${encodeURIComponent("zip code tabulation area")}:${zip}` +
    (key ? `&key=${encodeURIComponent(key)}` : "");
  // ACS returns a header row then data rows: [[NAME,B01003_001E,B19013_001E,zcta],[...]]
  const rows = await fetchJson<string[][]>(url);
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const [header, row] = [rows[0], rows[1]];
  const idx = (col: string) => header.indexOf(col);
  const num = (v: string | undefined) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return {
    zip,
    name: idx("NAME") >= 0 ? (row[idx("NAME")] ?? null) : null,
    population: num(row[idx("B01003_001E")]),
    medianHouseholdIncome: num(row[idx("B19013_001E")]),
  };
}

// --- FEC: race finance context ---------------------------------------------

export interface FecCandidate {
  name: string | null;
  party: string | null;
  receipts: number | null;
  disbursements: number | null;
  cashOnHand: number | null;
  incumbency: string | null;
}
export interface FecRaceContext {
  cycle: number;
  state: string;
  district: string;
  candidates: FecCandidate[];
  competitive: boolean;
}

const FEC_BASE = "https://api.open.fec.gov/v1/elections/";

/**
 * Candidate finance summary for a House race. FEC_API_KEY falls back to the
 * shared DEMO_KEY (rate-limited) so it works without a configured key.
 */
export async function raceFinanceContext(
  state: string,
  district: string,
  cycle = 2026
): Promise<FecRaceContext | null> {
  if (!state || !district) return null;
  const key = (await getConfig("FEC_API_KEY")) ?? "DEMO_KEY";
  const url =
    `${FEC_BASE}?cycle=${cycle}&office=house&state=${encodeURIComponent(state)}` +
    `&district=${encodeURIComponent(district)}&per_page=20&api_key=${encodeURIComponent(key)}`;
  const body = await fetchJson<{
    results?: Array<{
      candidate_name?: string;
      party_full?: string;
      total_receipts?: number;
      total_disbursements?: number;
      cash_on_hand_end_period?: number;
      incumbent_challenge_full?: string;
    }>;
  }>(url);
  if (!body?.results) return null;
  const candidates: FecCandidate[] = body.results.map((r) => ({
    name: r.candidate_name ?? null,
    party: r.party_full ?? null,
    receipts: typeof r.total_receipts === "number" ? r.total_receipts : null,
    disbursements: typeof r.total_disbursements === "number" ? r.total_disbursements : null,
    cashOnHand: typeof r.cash_on_hand_end_period === "number" ? r.cash_on_hand_end_period : null,
    incumbency: r.incumbent_challenge_full ?? null,
  }));
  // Competitive if the two best-funded candidates are within ~3x of each other.
  const funded = candidates
    .map((c) => c.receipts ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => b - a);
  const competitive = funded.length >= 2 && funded[0] <= funded[1] * 3;
  return { cycle, state, district, candidates, competitive };
}

// --- OpenStreetMap (Overpass): public venues for drives ---------------------
// Data © OpenStreetMap contributors, ODbL. Attribute when displaying.

export interface Venue {
  name: string;
  lat: number;
  lng: number;
  kind: string;
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * Public civic venues (libraries, community centres, town halls) within
 * `radiusM` of a point — candidate sites for registration drives.
 */
export async function nearbyVenues(
  lat?: number | null,
  lng?: number | null,
  radiusM = 4000
): Promise<Venue[]> {
  if (typeof lat !== "number" || typeof lng !== "number") return [];
  const query =
    `[out:json][timeout:10];` +
    `(node[amenity~"^(library|community_centre|townhall)$"](around:${radiusM},${lat},${lng}););` +
    `out center 20;`;
  const body = await fetchJson<{
    elements?: Array<{ lat?: number; lon?: number; tags?: Record<string, string> }>;
  }>(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      // Overpass etiquette: identify the client.
      "User-Agent": "matt-grant-chrome/0.6 (campaign clerk tool)",
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!body?.elements) return [];
  const venues: Venue[] = [];
  for (const e of body.elements) {
    const name = e.tags?.name;
    if (!name || typeof e.lat !== "number" || typeof e.lon !== "number") continue;
    venues.push({ name, lat: e.lat, lng: e.lon, kind: e.tags?.amenity ?? "venue" });
  }
  return venues;
}

// --- MO DESE / NCES: school-district profile --------------------------------

export interface DistrictProfile {
  name: string;
  enrollment: number | null;
  source: string | null;
}

/**
 * School-district profile. There is no single stable keyless JSON endpoint for
 * MO DESE/NCES, so this calls a configurable base (`DESE_API_BASE`, expected to
 * return `{ enrollment }`) when set, and otherwise returns a typed record with
 * nulls — an honest, ready-to-wire interface rather than a fake number.
 */
export async function districtProfile(name?: string | null): Promise<DistrictProfile | null> {
  if (!name || !name.trim()) return null;
  const base = await getConfig("DESE_API_BASE");
  if (!base) return { name: name.trim(), enrollment: null, source: null };
  const url = `${base.replace(/\/$/, "")}/district?name=${encodeURIComponent(name.trim())}`;
  const body = await fetchJson<{ enrollment?: number }>(url);
  return {
    name: name.trim(),
    enrollment: typeof body?.enrollment === "number" ? body.enrollment : null,
    source: body ? base : null,
  };
}

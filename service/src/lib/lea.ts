// Local Election Authority resolver for Missouri (Phase 4).
//
// Missouri jurisdictions split two ways under RSMo Chapter 115: most counties
// run elections through the COUNTY CLERK, while a set of larger/charter
// jurisdictions have a separate BOARD OF ELECTION COMMISSIONERS. Critically,
// the City of St. Louis is independent of St. Louis County and has its own
// board — a common source of voter confusion this resolver gets right.
//
// Contact details (address/phone/jurisdictionUrl) are intentionally null and
// should be populated from the official SOS "Find My Local Election Authority"
// directory; we never fabricate office details. The SOS lookup is always
// returned as the authoritative fallback.
//
// Source to populate from: https://www.sos.mo.gov/elections/goVoteMissouri/localelectionauthority

import type { LeaKind, LeaRecord } from "./types.js";

const SOS_LOOKUP =
  "https://www.sos.mo.gov/elections/goVoteMissouri/localelectionauthority";

// Jurisdictions known to operate via a Board of Election Commissioners.
// Everything not listed defaults to the County Clerk.
const BOARD_JURISDICTIONS = new Set<string>([
  "st. louis city",
  "city of st. louis",
  "st. louis county",
  "jackson county",
  "kansas city",
  "clay county",
  "platte county",
  "buchanan county",
  "st. charles county",
]);

/** Normalize free-text county/jurisdiction input for matching. */
function normalize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\bco\.?\b/g, "county");
}

/** Does this look like a bare county name without the word "county"? */
function withCountySuffix(name: string): string {
  const n = normalize(name);
  if (n.endsWith("county") || n.includes("city") || n.includes("kansas city")) {
    return n;
  }
  return `${n} county`;
}

function kindFor(normalized: string): LeaKind {
  return BOARD_JURISDICTIONS.has(normalized)
    ? "board_of_election_commissioners"
    : "county_clerk";
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Resolve a Missouri county/jurisdiction to its Local Election Authority.
 * Always succeeds: unknown inputs still get a county-clerk record plus the
 * official SOS deep-link.
 */
export function resolveLea(county: string): LeaRecord {
  const keyed = withCountySuffix(county);
  const kind = kindFor(keyed);
  const display = titleCase(keyed);
  const officeName =
    kind === "board_of_election_commissioners"
      ? `${display} Board of Election Commissioners`
      : `${display} Clerk`;

  return {
    county: titleCase(normalize(county)),
    leaId: `mo_${keyed.replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "")}`,
    name: officeName,
    kind,
    jurisdictionUrl: null, // populate from SOS directory
    phone: null,
    address: null,
    hoursNote: null,
    sosLookupUrl: SOS_LOOKUP,
  };
}

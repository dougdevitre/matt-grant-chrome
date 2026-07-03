// GOTV-readiness validator for the MO-02 reference data.
//
// Both mo02Locations.ts and mo02Candidates.ts ship as DRAFT ("VERIFY BEFORE
// GOTV"). This turns that comment into an *enforceable* gate: a single function
// that lists exactly what is still unverified, wired into a go-live readiness
// check so unverified voter-facing data can't silently ship.
//
// The gate is a human-confirmation switch, not a DESE-code proxy: it blocks
// until each dataset's `verified` flag is flipped to true (after staff confirm
// the rosters/ZIPs and the candidate slate), and it checks the fields that
// actually matter at runtime (leaId, valid ZIPs, a Republican on the ballot,
// the right election date). `deseCode` is an optional enrichment slot that
// nothing reads yet, so it is intentionally NOT gated.

import { MO02_LOCATIONS } from "./mo02Locations.js";
import { MO02_PRIMARY } from "./mo02Candidates.js";

/** Human-readable list of everything still unverified. Empty = ready for GOTV. */
export function mo02DataProblems(): string[] {
  const problems: string[] = [];

  if (!MO02_LOCATIONS.verified) {
    problems.push(
      "MO02_LOCATIONS not marked verified (confirm the county / district / ZIP rosters, then set verified: true)",
    );
  }
  if (MO02_LOCATIONS.counties.length === 0) {
    problems.push("no MO-02 counties defined");
  }

  for (const c of MO02_LOCATIONS.counties) {
    if (c.schoolDistricts.length === 0) {
      problems.push(`${c.county}: no school districts`);
    }
    for (const sd of c.schoolDistricts) {
      if (!sd.name) problems.push(`${c.county}: a school district is missing a name`);
      // leaId is the field the resolver actually uses (locationOptions.leaIdFor).
      if (!sd.leaId) problems.push(`${c.county} / ${sd.name || "?"}: missing leaId`);
    }
    if (c.zips.length === 0) {
      problems.push(`${c.county}: no ZIPs`);
    }
    for (const z of c.zips) {
      if (!/^\d{5}$/.test(z)) problems.push(`${c.county}: invalid ZIP "${z}"`);
    }
  }

  if (!MO02_PRIMARY.verified) {
    problems.push(
      "MO02_PRIMARY not marked verified (confirm the slate against the SOS filing, then set verified: true)",
    );
  }
  if (!MO02_PRIMARY.candidates.some((c) => c.party === "R")) {
    problems.push("no Republican primary candidates listed");
  }
  if (MO02_PRIMARY.electionDate !== "2026-08-04") {
    problems.push(`electionDate is ${MO02_PRIMARY.electionDate}, expected 2026-08-04`);
  }

  return problems;
}

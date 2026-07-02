// GOTV-readiness validator for the MO-02 reference data.
//
// Both mo02Locations.ts and mo02Candidates.ts ship as DRAFT ("VERIFY BEFORE
// GOTV"): every school district's DESE code is null and the ZIP lists are
// best-effort. This turns that comment into an *enforceable* gate — a single
// function that lists exactly what is still unverified, wired into a go-live
// readiness check so unverified voter-facing data can't silently ship.

import { MO02_LOCATIONS } from "./mo02Locations.js";
import { MO02_PRIMARY } from "./mo02Candidates.js";

/** Human-readable list of everything still unverified. Empty = ready for GOTV. */
export function mo02DataProblems(): string[] {
  const problems: string[] = [];

  if (MO02_LOCATIONS.counties.length === 0) {
    problems.push("no MO-02 counties defined");
  }

  for (const c of MO02_LOCATIONS.counties) {
    if (c.schoolDistricts.length === 0) {
      problems.push(`${c.county}: no school districts`);
    }
    for (const sd of c.schoolDistricts) {
      if (!sd.name) problems.push(`${c.county}: a school district is missing a name`);
      if (!sd.deseCode) {
        problems.push(`${c.county} / ${sd.name}: DESE code not verified (deseCode is null)`);
      }
    }
    if (c.zips.length === 0) {
      problems.push(`${c.county}: no ZIPs`);
    }
    for (const z of c.zips) {
      if (!/^\d{5}$/.test(z)) problems.push(`${c.county}: invalid ZIP "${z}"`);
    }
  }

  if (!MO02_PRIMARY.candidates.some((c) => c.party === "R")) {
    problems.push("no Republican primary candidates listed");
  }
  if (MO02_PRIMARY.electionDate !== "2026-08-04") {
    problems.push(`electionDate is ${MO02_PRIMARY.electionDate}, expected 2026-08-04`);
  }

  return problems;
}

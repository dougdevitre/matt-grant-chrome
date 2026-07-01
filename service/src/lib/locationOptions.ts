// Location selector options + validation, built from the MO-02 reference dataset
// (`data/mo02Locations.ts`). The extension fetches `getLocationOptions()` to
// populate cascading County → School district → ZIP dropdowns, and the resolver
// uses the validators to map a known selection to its real leaId and to keep
// confidence honest (an unknown / free-text pick can't claim MEDIUM).

import { MO02_LOCATIONS, type CountyRef } from "../data/mo02Locations.js";
import type { LocationOptions } from "./types.js";

const norm = (s: string): string => s.trim().toLowerCase();

function findCounty(county: string): CountyRef | undefined {
  const key = norm(county);
  return MO02_LOCATIONS.counties.find((c) => norm(c.county) === key);
}

/** The selector payload served to the extension (no internal-only fields). */
export function getLocationOptions(): LocationOptions {
  return {
    counties: MO02_LOCATIONS.counties.map((c) => ({
      county: c.county,
      schoolDistricts: c.schoolDistricts.map((sd) => ({ name: sd.name, leaId: sd.leaId })),
      zips: [...c.zips],
    })),
  };
}

export function isKnownCounty(county: string): boolean {
  return findCounty(county) !== undefined;
}

/** The real leaId for a county+district selection, or null if not in the dataset. */
export function leaIdFor(county: string, district: string): string | null {
  const c = findCounty(county);
  if (!c) return null;
  const key = norm(district);
  return c.schoolDistricts.find((sd) => norm(sd.name) === key)?.leaId ?? null;
}

/**
 * True when county + district + zip are all present in the dataset and mutually
 * consistent (district and zip both belong to the county). This is the signal
 * that a selection came from the dropdowns rather than a stale/typo'd free-text.
 */
export function isConsistentSelection(
  county: string,
  district: string,
  zip: string
): boolean {
  const c = findCounty(county);
  if (!c) return false;
  const districtOk = c.schoolDistricts.some((sd) => norm(sd.name) === norm(district));
  const zipOk = c.zips.includes(zip.trim());
  return districtOk && zipOk;
}

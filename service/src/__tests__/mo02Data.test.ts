// MO-02 reference data: always-on structural invariants (regression net) plus a
// GOTV-readiness gate that is skipped in the normal suite (the data ships as
// DRAFT) but enforced when RUN_GOTV_READINESS=1 — so the go-live checklist can
// prove the data was human-confirmed (the `verified` flags) before GOTV.

import { describe, expect, it } from "vitest";
import { MO02_LOCATIONS } from "../data/mo02Locations.js";
import { MO02_PRIMARY, primaryNames } from "../data/mo02Candidates.js";
import { mo02DataProblems } from "../data/verifyMo02.js";

describe("MO-02 reference data — structure", () => {
  it("has counties, each with named districts and 5-digit ZIPs", () => {
    expect(MO02_LOCATIONS.counties.length).toBeGreaterThan(0);
    for (const c of MO02_LOCATIONS.counties) {
      expect(c.schoolDistricts.length).toBeGreaterThan(0);
      for (const sd of c.schoolDistricts) {
        expect(sd.name).toBeTruthy();
        expect(sd.leaId).toBeTruthy();
      }
      for (const z of c.zips) expect(z).toMatch(/^\d{5}$/);
    }
  });

  it("lists a Republican primary field with the incumbent + Matt Grant on Aug 4", () => {
    expect(MO02_PRIMARY.electionDate).toBe("2026-08-04");
    expect(primaryNames("R")).toMatch(/Matt Grant/);
    expect(MO02_PRIMARY.candidates.some((c) => c.party === "R" && c.incumbent)).toBe(true);
  });

  it("mo02DataProblems flags the unverified datasets while the data is DRAFT", () => {
    // Documents the current gap: both datasets ship verified:false, so problems
    // exist. When staff confirm the data and flip both flags (and the structural
    // checks pass), this list empties and the readiness gate passes.
    const problems = mo02DataProblems();
    expect(problems.some((p) => /MO02_LOCATIONS not marked verified/.test(p))).toBe(true);
    expect(problems.some((p) => /MO02_PRIMARY not marked verified/.test(p))).toBe(true);
  });
});

// Skipped in normal CI (data ships DRAFT); run with RUN_GOTV_READINESS=1 as a
// go-live gate. Mirrors the packed-zip gate pattern in health.test.ts.
const gate = process.env.RUN_GOTV_READINESS ? it : it.skip;
describe("MO-02 reference data — GOTV readiness gate", () => {
  gate("has no unverified data (both datasets marked verified, ZIPs valid)", () => {
    expect(mo02DataProblems()).toEqual([]);
  });
});

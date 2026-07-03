// MO-02 primary candidate field for the "Who's on the ballot" card.
//
// ⚠️ DRAFT — VERIFY against the SOS official candidate filing before GOTV:
// https://s1.sos.mo.gov/candidatesonweb/  (Primary Election Aug 4, 2026).
// Sourced from Ballotpedia (2026-07). Update names/spellings + add anyone
// missing once confirmed, then set `verified: true` (the GOTV-readiness gate in
// verifyMo02.ts blocks until it is). This card has no runtime fallback — the
// slate is shown to voters exactly as listed here, so an omission is visible.

export interface Candidate {
  name: string;
  party: "R" | "D";
  incumbent?: boolean;
}

export interface PrimaryField {
  electionDate: string; // ISO date of the primary
  office: string;
  /** Set true once the slate is confirmed against the SOS filing. Gates GOTV. */
  verified: boolean;
  candidates: Candidate[];
}

export const MO02_PRIMARY: PrimaryField = {
  electionDate: "2026-08-04",
  office: "U.S. House — Missouri District 2",
  // DRAFT — flip to true only after confirming the slate against the SOS filing.
  verified: false,
  candidates: [
    { name: "Ann Wagner", party: "R", incumbent: true },
    { name: "Matt Grant", party: "R" },
    { name: "Timothy Bilash", party: "D" },
    { name: "Chuck Summers", party: "D" },
    { name: "Nick Vivio", party: "D" },
    { name: "Joan VonDras", party: "D" },
    { name: "Frederick Wellman", party: "D" },
  ],
};

/** Comma-separated candidate names for a party, incumbents marked. */
export function primaryNames(party: "R" | "D"): string {
  return MO02_PRIMARY.candidates
    .filter((c) => c.party === party)
    .map((c) => (c.incumbent ? `${c.name} (incumbent)` : c.name))
    .join(", ");
}

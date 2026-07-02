// Real Local Election Authority contact details for the MO-02 counties, used to
// replace the null placeholders in `lea.ts` (jurisdictionUrl / phone / address).
// Keyed by the normalized county name produced by lea.ts `withCountySuffix`
// (lowercased, "… county"). Unlisted counties keep the SOS-lookup fallback.
//
// ⚠️ VERIFY periodically — public offices, but hours/phones can change. Sourced
// from each authority's official site (2026-07). St. Louis County + St. Charles
// County run Boards of Election Commissioners; Franklin + Warren run through the
// County Clerk (matches BOARD_JURISDICTIONS in lea.ts).

import type { LeaKind } from "../lib/types.js";

export interface CountyAuthority {
  name: string;
  kind: LeaKind;
  jurisdictionUrl: string;
  phone: string;
  address: string;
  hoursNote: string | null;
}

export const MO02_AUTHORITIES: Record<string, CountyAuthority> = {
  "st. louis county": {
    name: "St. Louis County Board of Election Commissioners",
    kind: "board_of_election_commissioners",
    jurisdictionUrl:
      "https://stlouiscountymo.gov/st-louis-county-government/board-of-elections/",
    phone: "(314) 615-1800",
    address: "725 Northwest Plaza Dr, St. Ann, MO 63074",
    hoursNote: "Mon–Fri 8:00a–4:30p",
  },
  "st. charles county": {
    name: "St. Charles County Election Authority",
    kind: "board_of_election_commissioners",
    jurisdictionUrl: "https://www.sccmo.org/410/Election-Authority",
    phone: "(636) 949-7550",
    address: "397 Turner Blvd, St. Peters, MO 63376",
    hoursNote: "Mon–Fri 8:00a–5:00p",
  },
  "franklin county": {
    name: "Franklin County Clerk",
    kind: "county_clerk",
    jurisdictionUrl: "https://www.franklinmo.org/clerk",
    phone: "(636) 583-6355",
    address: "400 E Locust St, Room 201, Union, MO 63084",
    hoursNote: "Mon–Fri 8:00a–4:30p",
  },
  "warren county": {
    name: "Warren County Clerk",
    kind: "county_clerk",
    jurisdictionUrl: "https://warrencountymoclerk.com/elections/",
    phone: "(636) 456-3331",
    address: "101 Mockingbird Ln, Suite 302, Warrenton, MO 63383",
    hoursNote: "Mon–Fri 8:00a–4:30p",
  },
};

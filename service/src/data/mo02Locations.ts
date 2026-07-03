// MO-02 location reference dataset — the source of truth for the extension's
// County / School district / ZIP selectors and for resolver validation.
//
// Coverage: the counties MO-02 touches (2022 map): ALL of Franklin County plus
// portions of St. Louis, St. Charles, and Warren counties. A county/ZIP can
// straddle the district line, so `inDistrict` here means "intersects MO-02" —
// the Census address geocode remains the sole authority for true membership.
//
// ⚠️ DRAFT — VERIFY BEFORE GOTV. The county set is confirmed (Franklin +
// St. Louis/St. Charles/Warren portions). The school-district rosters and ZIP
// lists below are a best-effort draft from public sources and MUST be confirmed
// by campaign staff (ideally in an Airtable "Locations" table). `leaId` is a
// canonical stable key derived from the district and is what the resolver uses
// at runtime; `deseCode` is an optional enrichment slot (nothing reads it yet).
//
// The GOTV-readiness gate (verifyMo02.ts) blocks until `verified` below is set
// to `true` — flip it once campaign staff have eyeballed the rosters/ZIPs.

export interface SchoolDistrictRef {
  name: string;
  /** Canonical stable key used as the resolved leaId. Replace with the DESE code once verified. */
  leaId: string;
  /** Official MO DESE district code, once confirmed. null = not yet verified. */
  deseCode: string | null;
}

export interface CountyRef {
  county: string;
  /** True when the county intersects MO-02 (address geocode confirms exact membership). */
  inDistrict: boolean;
  schoolDistricts: SchoolDistrictRef[];
  zips: string[];
}

export interface LocationDataset {
  /** Set true once campaign staff have confirmed the rosters/ZIPs. Gates GOTV. */
  verified: boolean;
  counties: CountyRef[];
}

const d = (name: string, leaId: string): SchoolDistrictRef => ({ name, leaId, deseCode: null });

export const MO02_LOCATIONS: LocationDataset = {
  // DRAFT — flip to true only after campaign staff confirm the rosters + ZIPs.
  verified: false,
  counties: [
    {
      county: "Franklin County",
      inDistrict: true,
      schoolDistricts: [
        d("Washington School District", "fra_washington"),
        d("Union R-XI", "fra_union"),
        d("Sullivan School District", "fra_sullivan"),
        d("St. Clair R-XIII", "fra_st_clair"),
        d("Meramec Valley R-III (Pacific)", "fra_meramec_valley"),
        d("New Haven School District", "fra_new_haven"),
        d("Lonedell R-XIV", "fra_lonedell"),
        d("Spring Bluff R-XV", "fra_spring_bluff"),
      ],
      zips: ["63090", "63084", "63080", "63077", "63069", "63068", "63072", "63091", "63014"],
    },
    {
      county: "St. Charles County",
      inDistrict: true,
      schoolDistricts: [
        d("Francis Howell R-III", "stc_francis_howell"),
        d("Fort Zumwalt R-II", "stc_fort_zumwalt"),
        d("Wentzville R-IV", "stc_wentzville"),
        d("City of St. Charles (St. Charles R-VI)", "stc_st_charles"),
        d("Orchard Farm R-V", "stc_orchard_farm"),
      ],
      zips: ["63301", "63303", "63304", "63366", "63367", "63368", "63385", "63348", "63373"],
    },
    {
      county: "St. Louis County",
      inDistrict: true,
      schoolDistricts: [
        d("Rockwood R-VI", "stl_rockwood"),
        d("Parkway C-2", "stl_parkway"),
        d("Pattonville R-III", "stl_pattonville"),
        d("Ladue School District", "stl_ladue"),
        d("Kirkwood R-VII", "stl_kirkwood"),
        d("Lindbergh Schools", "stl_lindbergh"),
        d("Mehlville R-IX", "stl_mehlville"),
        d("Valley Park School District", "stl_valley_park"),
        d("Webster Groves School District", "stl_webster_groves"),
      ],
      zips: ["63011", "63021", "63005", "63017", "63122", "63088", "63127", "63128", "63129", "63131"],
    },
    {
      county: "Warren County",
      inDistrict: true,
      schoolDistricts: [
        d("Warren County R-III (Warrenton)", "war_warren_county"),
        d("Wright City R-II", "war_wright_city"),
      ],
      zips: ["63383", "63390", "63357", "63351"],
    },
  ],
};

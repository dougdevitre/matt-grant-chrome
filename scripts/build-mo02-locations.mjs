#!/usr/bin/env node
// Ingest a verified MO-02 locations CSV → the MO02_LOCATIONS dataset literal.
//
// Usage:  node scripts/build-mo02-locations.mjs scripts/mo02-locations.csv
//
// CSV columns (header row required):
//   county   — "Franklin County"
//   district — "Washington School District"
//   leaId    — stable slug kept as the resolver key, e.g. "fra_washington"
//   deseCode — official MO DESE district code (leave blank only if truly unknown)
//   zips     — space-separated ZIPs for that COUNTY (unioned across its rows)
//
// Prints the `export const MO02_LOCATIONS ...` block to stdout — paste it into
// service/src/data/mo02Locations.ts (replacing the existing literal), then run
//   RUN_GOTV_READINESS=1 npm test
// to confirm nothing is left unverified. Rows with a blank deseCode are emitted
// as `deseCode: null` and reported as warnings so the gap stays visible.

import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/build-mo02-locations.mjs <csv>");
  process.exit(2);
}

function parseCsv(text) {
  const rows = [];
  let f = "";
  let row = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(f);
      f = "";
    } else if (ch === "\n" || ch === "\r") {
      if (f !== "" || row.length) {
        row.push(f);
        rows.push(row);
        row = [];
        f = "";
      }
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else f += ch;
  }
  if (f !== "" || row.length) {
    row.push(f);
    rows.push(row);
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) =>
    Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()]))
  );
}

const rows = parseCsv(readFileSync(file, "utf8"));
const counties = new Map(); // county -> { districts: Map(leaId->row), zips: Set }
const warnings = [];

rows.forEach((r, idx) => {
  const line = idx + 2;
  if (!r.county || !r.district || !r.leaid) {
    if (r.county || r.district || r.leaid) warnings.push(`row ${line}: missing county/district/leaId — skipped`);
    return;
  }
  if (!counties.has(r.county)) counties.set(r.county, { districts: new Map(), zips: new Set() });
  const c = counties.get(r.county);
  c.districts.set(r.leaid, { name: r.district, leaId: r.leaid, deseCode: r.desecode || null });
  for (const z of (r.zips || "").split(/[\s;]+/).filter(Boolean)) c.zips.add(z);
  if (!r.desecode) warnings.push(`row ${line}: ${r.county} / ${r.district} has no DESE code`);
});

const q = (s) => JSON.stringify(s);
const out = ["export const MO02_LOCATIONS: LocationDataset = {", "  counties: ["];
for (const [county, c] of counties) {
  out.push("    {");
  out.push(`      county: ${q(county)},`);
  out.push("      inDistrict: true,");
  out.push("      schoolDistricts: [");
  for (const sd of c.districts.values()) {
    const dese = sd.deseCode === null ? "null" : q(sd.deseCode);
    out.push(`        { name: ${q(sd.name)}, leaId: ${q(sd.leaId)}, deseCode: ${dese} },`);
  }
  out.push("      ],");
  out.push(`      zips: [${[...c.zips].map(q).join(", ")}],`);
  out.push("    },");
}
out.push("  ],", "};");
console.log(out.join("\n"));

if (warnings.length) {
  console.error(`\n// ⚠️ ${warnings.length} warning(s) — data is NOT GOTV-ready yet:`);
  for (const w of warnings) console.error(`//   ${w}`);
  console.error("// Fill every DESE code, re-run, then: RUN_GOTV_READINESS=1 npm test");
  process.exit(1);
}

#!/usr/bin/env node
// Post-deploy live smoke test for the server-side public-data clients.
//
// The clients in service/src/lib/publicData.ts are covered by deterministic
// mocked-fetch unit tests, but the build sandbox can't reach the real endpoints
// (egress is allowlist-restricted), so they've never been verified live. Run
// THIS from a machine with open outbound HTTPS to confirm each upstream still
// answers with the shape the clients expect:
//
//   node scripts/smoke-public-data.mjs
//   FEC_API_KEY=... CENSUS_API_KEY=... DESE_API_BASE=... node scripts/smoke-public-data.mjs
//
// Keys are optional (Census ACS allows keyless low-volume use; FEC falls back to
// the shared rate-limited DEMO_KEY). This mirrors the exact URLs/params/shapes in
// publicData.ts — keep the two in sync. Exit code is non-zero if any REQUIRED
// check fails (DESE is skipped when DESE_API_BASE is unset).
//
// It calls live public APIs read-only; it sends nothing and stores nothing.

const TIMEOUT_MS = 12000;
let failures = 0;

function pass(name, detail) {
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, detail) {
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  failures++;
}
function skip(name, detail) {
  console.log(`  · ${name} skipped${detail ? ` — ${detail}` : ""}`);
}

async function get(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

// --- Census geocoder: address -> census block + congressional district ------
async function checkGeocoder() {
  const address = "600 Turner Blvd, St. Peters, MO 63376"; // St. Charles Co., MO-02
  const url =
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress" +
    `?address=${encodeURIComponent(address)}` +
    "&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json";
  try {
    const { ok, status, json } = await get(url);
    if (!ok) return fail("Census geocoder", `HTTP ${status}`);
    const match = json?.result?.addressMatches?.[0];
    if (!match) return fail("Census geocoder", "no addressMatches for a known address");
    const geos = match.geographies ?? {};
    const cdKey = Object.keys(geos).find((k) => /Congressional Districts/i.test(k));
    const cd = cdKey ? geos[cdKey]?.[0]?.GEOID : undefined;
    if (!cd) return fail("Census geocoder", "matched but no Congressional Districts geography");
    pass("Census geocoder", `CD GEOID ${cd} (expect 29xx = MO)`);
  } catch (e) {
    fail("Census geocoder", String(e?.message ?? e));
  }
}

// --- Census ACS: ZCTA demographics ------------------------------------------
async function checkAcs() {
  const zip = "63031"; // Florissant, St. Louis County
  const key = process.env.CENSUS_API_KEY;
  const url =
    "https://api.census.gov/data/2022/acs/acs5?get=NAME,B01003_001E,B19013_001E" +
    `&for=${encodeURIComponent("zip code tabulation area")}:${zip}` +
    (key ? `&key=${encodeURIComponent(key)}` : "");
  try {
    const { ok, status, json } = await get(url);
    if (!ok) return fail("Census ACS", `HTTP ${status}`);
    if (!Array.isArray(json) || json.length < 2)
      return fail("Census ACS", "expected header + data rows");
    const [header, row] = json;
    const pop = row[header.indexOf("B01003_001E")];
    if (!(Number(pop) > 0)) return fail("Census ACS", `population not positive (${pop})`);
    pass("Census ACS", `zip ${zip} population ${pop}${key ? "" : " (keyless)"}`);
  } catch (e) {
    fail("Census ACS", String(e?.message ?? e));
  }
}

// --- FEC: House race finance context ----------------------------------------
async function checkFec() {
  const key = process.env.FEC_API_KEY ?? "DEMO_KEY";
  const url =
    "https://api.open.fec.gov/v1/elections/?cycle=2026&office=house&state=MO" +
    `&district=02&per_page=20&api_key=${encodeURIComponent(key)}`;
  try {
    const { ok, status, json, text } = await get(url);
    if (status === 429) return fail("FEC", "429 rate-limited (set FEC_API_KEY to avoid DEMO_KEY limits)");
    if (!ok) return fail("FEC", `HTTP ${status} ${text.slice(0, 120)}`);
    if (!Array.isArray(json?.results)) return fail("FEC", "no results array");
    pass("FEC", `MO-02 returned ${json.results.length} candidate row(s)${key === "DEMO_KEY" ? " (DEMO_KEY)" : ""}`);
  } catch (e) {
    fail("FEC", String(e?.message ?? e));
  }
}

// --- OpenStreetMap Overpass: nearby civic venues ----------------------------
async function checkOverpass() {
  const lat = 38.7881; // St. Charles, MO
  const lng = -90.4974;
  const query =
    "[out:json][timeout:10];" +
    `(node[amenity~"^(library|community_centre|townhall)$"](around:5000,${lat},${lng}););` +
    "out center 20;";
  try {
    const { ok, status, json } = await get("https://overpass-api.de/api/interpreter", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "matt-grant-chrome/0.6 (campaign clerk tool)",
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!ok) return fail("Overpass", `HTTP ${status}`);
    if (!Array.isArray(json?.elements)) return fail("Overpass", "no elements array");
    pass("Overpass", `${json.elements.length} venue element(s) near St. Charles`);
  } catch (e) {
    fail("Overpass", String(e?.message ?? e));
  }
}

// --- MO DESE / NCES: school-district profile (only if configured) -----------
async function checkDese() {
  const base = process.env.DESE_API_BASE;
  if (!base) return skip("MO DESE", "DESE_API_BASE not set (client returns honest nulls)");
  const url = `${base.replace(/\/$/, "")}/district?name=${encodeURIComponent("Francis Howell")}`;
  try {
    const { ok, status, json } = await get(url);
    if (!ok) return fail("MO DESE", `HTTP ${status}`);
    if (json && typeof json.enrollment === "number")
      pass("MO DESE", `enrollment ${json.enrollment}`);
    else fail("MO DESE", "response missing numeric { enrollment }");
  } catch (e) {
    fail("MO DESE", String(e?.message ?? e));
  }
}

console.log("Live smoke test — server-side public-data clients\n");
await checkGeocoder();
await checkAcs();
await checkFec();
await checkOverpass();
await checkDese();

console.log("");
if (failures > 0) {
  console.log(`FAIL — ${failures} client check(s) failed. A failing upstream degrades to null in`);
  console.log("       production (graceful), but investigate before relying on that enrichment.");
  process.exit(1);
} else {
  console.log("OK — all live public-data clients responded with the expected shape.");
}

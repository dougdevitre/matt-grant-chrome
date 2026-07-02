import { Router } from "express";
import { requireScope } from "../auth.js";
import { resolveLocalContext } from "../lib/locationResolver.js";
import { getLocationOptions } from "../lib/locationOptions.js";
import { leaForCounty, reverseGeocodeCoords } from "../lib/publicData.js";
import type { LocationInput } from "../lib/types.js";

export const locationRouter = Router();

// GET /location/options — county → school district → ZIP options that populate
// the extension's cascading selectors (from the MO-02 reference dataset).
locationRouter.get("/options", requireScope("voter.read"), (_req, res) => {
  res.json(getLocationOptions());
});

// POST /location/resolve — role + phase + location aware cards.
locationRouter.post("/resolve", requireScope("voter.read"), async (req, res) => {
  const body = req.body as Partial<LocationInput>;
  if (!body?.county || !body?.schoolDistrict || !body?.zip) {
    res.status(400).json({ error: "missing_fields", needed: ["county", "schoolDistrict", "zip"] });
    return;
  }
  if (!/^\d{5}$/.test(body.zip)) {
    res.status(400).json({ error: "invalid_zip" });
    return;
  }
  const scopes = req.clerk?.scopes ?? [];
  const result = await resolveLocalContext(
    {
      county: body.county,
      schoolDistrict: body.schoolDistrict,
      zip: body.zip,
      address: body.address ?? null,
      coords: coordsFrom(body.coords),
    },
    scopes
  );
  res.json(result);
});

// POST /location/reverse-geocode { lat, lng } — map the voter's current device
// coordinates to county / ZIP / district so the panel can auto-fill and jump to
// the polling-place lookup. Coordinates never persist here (stateless).
locationRouter.post("/reverse-geocode", requireScope("voter.read"), async (req, res) => {
  const b = (req.body ?? {}) as { lat?: unknown; lng?: unknown };
  const lat = b.lat;
  const lng = b.lng;
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    res.status(400).json({ error: "invalid_coordinates" });
    return;
  }
  const geo = await reverseGeocodeCoords(lat, lng);
  res.json({
    county: geo.county,
    zip: geo.zip,
    schoolDistrict: geo.schoolDistrict,
    inDistrict:
      geo.congressionalDistrict != null ? geo.congressionalDistrict === "MO-02" : null,
    congressionalDistrict: geo.congressionalDistrict,
    censusBlock: geo.censusBlock,
  });
});

/** Accept coords only when both parts are finite numbers; otherwise drop them. */
function coordsFrom(c: LocationInput["coords"]): { lat: number; lng: number } | null {
  if (
    c &&
    typeof c.lat === "number" &&
    typeof c.lng === "number" &&
    Number.isFinite(c.lat) &&
    Number.isFinite(c.lng)
  ) {
    return { lat: c.lat, lng: c.lng };
  }
  return null;
}

// GET /location/lea?county= — local election authority deep-link.
locationRouter.get("/lea", async (req, res) => {
  const county = String(req.query.county ?? "");
  if (!county) {
    res.status(400).json({ error: "missing_county" });
    return;
  }
  res.json(await leaForCounty(county));
});

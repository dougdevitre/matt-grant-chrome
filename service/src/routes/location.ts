import { Router } from "express";
import { requireScope } from "../auth.js";
import { resolveLocalContext } from "../lib/locationResolver.js";
import { leaForCounty } from "../lib/publicData.js";
import type { LocationInput } from "../lib/types.js";

export const locationRouter = Router();

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
    },
    scopes
  );
  res.json(result);
});

// GET /location/lea?county= — local election authority deep-link.
locationRouter.get("/lea", async (req, res) => {
  const county = String(req.query.county ?? "");
  if (!county) {
    res.status(400).json({ error: "missing_county" });
    return;
  }
  res.json(await leaForCounty(county));
});

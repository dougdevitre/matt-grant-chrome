// Integration: /location/options selector data + how a known (dropdown) vs
// unknown (free-text) selection resolves. No address → the Census geocoder is
// never called, so these stay hermetic.

import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  delete process.env.ENRICH_RESOLVE;
});

describe("GET /location/options", () => {
  it("returns MO-02 counties with nested districts + zips", async () => {
    const res = await request(app)
      .get("/location/options")
      .set("Authorization", bearer(tokenFor("public")));
    expect(res.status).toBe(200);
    const names = res.body.counties.map((c: { county: string }) => c.county);
    expect(names).toContain("Franklin County");
    const franklin = res.body.counties.find(
      (c: { county: string }) => c.county === "Franklin County"
    );
    expect(franklin.schoolDistricts.length).toBeGreaterThan(0);
    expect(franklin.zips).toContain("63090");
    expect(franklin.schoolDistricts[0]).toHaveProperty("leaId");
  });

  it("requires voter.read (401 without a token)", async () => {
    const res = await request(app).get("/location/options");
    expect(res.status).toBe(401);
  });
});

describe("POST /location/resolve — dataset-aware resolution", () => {
  it("uses the dataset leaId + MEDIUM confidence for a known selection", async () => {
    const res = await request(app)
      .post("/location/resolve")
      .set("Authorization", bearer(tokenFor("public")))
      .send({ county: "Franklin County", schoolDistrict: "Washington School District", zip: "63090" });
    expect(res.status).toBe(200);
    expect(res.body.location.leaId).toBe("fra_washington");
    expect(res.body.location.confidence).toBe("MEDIUM");
  });

  it("drops an unknown free-text selection to LOW confidence (back-compatible)", async () => {
    const res = await request(app)
      .post("/location/resolve")
      .set("Authorization", bearer(tokenFor("public")))
      .send({ county: "Nowhere County", schoolDistrict: "Made Up", zip: "00000" });
    expect(res.status).toBe(200);
    // Still resolves (no error), but isn't trusted like a real dropdown pick.
    expect(res.body.location.confidence).toBe("LOW");
    expect(res.body.location.leaId).not.toBe("fra_washington");
  });
});

// Integration: /location/options selector data + how a known (dropdown) vs
// unknown (free-text) selection resolves. No address → the Census geocoder is
// never called, so these stay hermetic.

import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../index.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";

// Stub the Census coordinates geocoder so reverse-geocode tests are hermetic.
function stubCoordsFetch(districtGeoid = "2902") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          geographies: {
            Counties: [{ NAME: "Franklin County" }],
            "119th Congressional Districts": [{ GEOID: districtGeoid }],
            "Census Blocks": [{ GEOID: "295101234001023" }],
            "2020 Census ZIP Code Tabulation Areas": [{ GEOID: "63090" }],
            "Unified School Districts": [{ NAME: "Washington School District" }],
          },
        },
      }),
      text: async () => "",
    }))
  );
}

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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

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

  it("reaches HIGH confidence and a location-based polling card when coords are supplied", async () => {
    // The polling card only shows in the plan/turnout phases — pin the clock so
    // it's present, then assert the coords-driven HIGH confidence + copy.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-25T12:00:00Z"));
    stubCoordsFetch();
    const res = await request(app)
      .post("/location/resolve")
      .set("Authorization", bearer(tokenFor("public")))
      .send({
        county: "Franklin County",
        schoolDistrict: "Washington School District",
        zip: "63090",
        coords: { lat: 38.55, lng: -90.95 },
      });
    expect(res.status).toBe(200);
    expect(res.body.location.confidence).toBe("HIGH");
    const polling = res.body.cards.find(
      (c: { id: string; body: string }) => c.id === "vote.polling"
    );
    expect(polling?.body).toContain("current location");
  });
});

describe("POST /location/reverse-geocode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps coordinates to county / zip / district", async () => {
    stubCoordsFetch();
    const res = await request(app)
      .post("/location/reverse-geocode")
      .set("Authorization", bearer(tokenFor("public")))
      .send({ lat: 38.55, lng: -90.95 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      county: "Franklin County",
      zip: "63090",
      schoolDistrict: "Washington School District",
      inDistrict: true,
      congressionalDistrict: "MO-02",
    });
  });

  it("flags a point outside MO-02", async () => {
    stubCoordsFetch("2901"); // MO-01
    const res = await request(app)
      .post("/location/reverse-geocode")
      .set("Authorization", bearer(tokenFor("public")))
      .send({ lat: 39.1, lng: -94.5 });
    expect(res.body.inDistrict).toBe(false);
  });

  it("rejects non-numeric / out-of-range coordinates with 400", async () => {
    for (const bad of [{ lat: "x", lng: 0 }, { lat: 200, lng: 0 }, {}]) {
      const res = await request(app)
        .post("/location/reverse-geocode")
        .set("Authorization", bearer(tokenFor("public")))
        .send(bad);
      expect(res.status).toBe(400);
    }
  });

  it("requires voter.read (401 without a token)", async () => {
    const res = await request(app).post("/location/reverse-geocode").send({ lat: 38, lng: -90 });
    expect(res.status).toBe(401);
  });
});

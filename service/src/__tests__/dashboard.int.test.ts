// Integration: GOTV turnout dashboard — aggregate counts + the voter.read gate.

import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { resetStoreForTests } from "../lib/store.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});
beforeEach(() => {
  resetStoreForTests();
});

const admin = () => bearer(tokenFor("admin"));

describe("GET /dashboard/gotv", () => {
  it("returns turnout counts over the seeded contacts", async () => {
    const res = await request(app).get("/dashboard/gotv").set("Authorization", admin());
    expect(res.status).toBe(200);
    // Seed: Jordan (unknown) + Avery (early_voted).
    expect(res.body.total).toBe(2);
    expect(res.body.earlyVoted).toBe(1);
    expect(res.body.cast).toBe(1);
    expect(res.body.remaining).toBe(1);
    expect(res.body.counts.early_voted).toBe(1);
    expect(res.body.counts.unknown).toBe(1);
    expect(Array.isArray(res.body.byZip)).toBe(true);
  });

  it("reflects a new vote after logging a disposition", async () => {
    const list = await request(app).get("/contacts").set("Authorization", admin());
    const jordan = list.body[0].id;
    await request(app)
      .post(`/contacts/${jordan}/logs`)
      .set("Authorization", admin())
      .send({ channel: "call", disposition: "voted_election_day" });
    const res = await request(app).get("/dashboard/gotv").set("Authorization", admin());
    expect(res.body.voted).toBe(1);
    expect(res.body.cast).toBe(2);
    expect(res.body.remaining).toBe(0);
  });

  it("403s without the voter.read scope", async () => {
    // compliance_clerk lacks voter.read.
    const res = await request(app)
      .get("/dashboard/gotv")
      .set("Authorization", bearer(tokenFor("compliance_clerk")));
    expect(res.status).toBe(403);
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/dashboard/gotv");
    expect(res.status).toBe(401);
  });
});

// Integration: contacts list pagination + optimistic locking on the versioned
// mutators (consent / opt-out). Mirrors the task/shift version-conflict contract.

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

async function firstContactId(): Promise<{ id: string; version: number }> {
  const res = await request(app).get("/contacts").set("Authorization", admin());
  expect(res.status).toBe(200);
  return { id: res.body[0].id, version: res.body[0].version };
}

describe("GET /contacts pagination", () => {
  it("returns the full array and X-Total-Count when no params are given", async () => {
    const res = await request(app).get("/contacts").set("Authorization", admin());
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2); // two seeded contacts
    expect(res.headers["x-total-count"]).toBe("2");
  });

  it("slices to limit/offset while reporting the full total", async () => {
    const res = await request(app)
      .get("/contacts?limit=1&offset=1")
      .set("Authorization", admin());
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.headers["x-total-count"]).toBe("2");
  });

  it("exposes a numeric version on each contact", async () => {
    const { version } = await firstContactId();
    expect(typeof version).toBe("number");
  });
});

describe("contacts optimistic locking", () => {
  it("rejects consent with a stale version (409 version_conflict)", async () => {
    const { id } = await firstContactId();
    const res = await request(app)
      .post(`/contacts/${id}/consent`)
      .set("Authorization", admin())
      .send({ channel: "sms", consented: true, version: 999 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("version_conflict");
  });

  it("accepts consent with the correct version and bumps it", async () => {
    const { id, version } = await firstContactId();
    const ok = await request(app)
      .post(`/contacts/${id}/consent`)
      .set("Authorization", admin())
      .send({ channel: "sms", consented: true, version });
    expect(ok.status).toBe(201);

    const after = await request(app)
      .get(`/contacts/${id}`)
      .set("Authorization", admin());
    expect(after.body.version).toBe(version + 1);
  });

  it("rejects opt-out with a stale version (409)", async () => {
    const { id } = await firstContactId();
    const res = await request(app)
      .post(`/contacts/${id}/optout`)
      .set("Authorization", admin())
      .send({ version: 999 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("version_conflict");
  });

  it("still succeeds when no version is supplied (back-compat)", async () => {
    const { id } = await firstContactId();
    const res = await request(app)
      .post(`/contacts/${id}/optout`)
      .set("Authorization", admin())
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("opted_out");
  });

  it("404s for an unknown contact", async () => {
    const res = await request(app)
      .post(`/contacts/does-not-exist/optout`)
      .set("Authorization", admin())
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("contact_not_found");
  });
});

describe("GOTV turnout dispositions", () => {
  async function logDisp(id: string, disposition: string) {
    return request(app)
      .post(`/contacts/${id}/logs`)
      .set("Authorization", admin())
      .send({ channel: "call", disposition });
  }
  async function getContact(id: string) {
    const res = await request(app)
      .get(`/contacts/${id}`)
      .set("Authorization", admin());
    expect(res.status).toBe(200);
    return res.body;
  }

  it("records an early vote onto the contact (status/method/votedAt + version bump)", async () => {
    const { id, version } = await firstContactId();
    const r = await logDisp(id, "voted_early");
    expect(r.status).toBe(201);
    const c = await getContact(id);
    expect(c.voteStatus).toBe("early_voted");
    expect(c.voteMethod).toBe("early_in_person");
    expect(typeof c.votedAt).toBe("string");
    expect(c.version).toBeGreaterThan(version);
  });

  it("maps pledged_to_vote → plan_made and election-day → voted", async () => {
    const list = await request(app).get("/contacts").set("Authorization", admin());
    const jordan = list.body[0].id;
    await logDisp(jordan, "pledged_to_vote");
    expect((await getContact(jordan)).voteStatus).toBe("plan_made");
    await logDisp(jordan, "voted_election_day");
    const c = await getContact(jordan);
    expect(c.voteStatus).toBe("voted");
    expect(c.voteMethod).toBe("election_day");
  });

  it("rejects an unknown disposition", async () => {
    const { id } = await firstContactId();
    const r = await logDisp(id, "definitely_not_valid");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("invalid_disposition");
  });
});

describe("GOTV not-yet-voted filter", () => {
  it("excludes contacts who have already cast a ballot", async () => {
    // Seed: Jordan (unknown) + Avery (early_voted). notVoted drops Avery.
    const all = await request(app).get("/contacts").set("Authorization", admin());
    expect(all.body.length).toBe(2);
    const res = await request(app)
      .get("/contacts?notVoted=true")
      .set("Authorization", admin());
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.headers["x-total-count"]).toBe("1");
    expect(res.body[0].voteStatus).not.toBe("early_voted");
  });

  it("filters by an explicit voteStatus", async () => {
    const res = await request(app)
      .get("/contacts?voteStatus=early_voted")
      .set("Authorization", admin());
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].voteStatus).toBe("early_voted");
  });
});

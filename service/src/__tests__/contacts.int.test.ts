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

describe("GOTV vote plan", () => {
  async function jordan() {
    const list = await request(app).get("/contacts").set("Authorization", admin());
    return list.body.find((c: { firstName: string }) => c.firstName === "Jordan");
  }

  it("saves a vote plan and advances an unknown voteStatus to plan_made", async () => {
    const j = await jordan();
    const r = await request(app)
      .post(`/contacts/${j.id}/vote-plan`)
      .set("Authorization", admin())
      .send({ method: "early_in_person", time: "before work", needsRide: true });
    expect(r.status).toBe(201);
    const after = await request(app)
      .get(`/contacts/${j.id}`)
      .set("Authorization", admin());
    expect(after.body.votePlan.method).toBe("early_in_person");
    expect(after.body.votePlan.needsRide).toBe(true);
    expect(after.body.voteStatus).toBe("plan_made");
    expect(after.body.version).toBeGreaterThan(j.version);
  });

  it("rejects an invalid method (400) and a stale version (409)", async () => {
    const j = await jordan();
    const bad = await request(app)
      .post(`/contacts/${j.id}/vote-plan`)
      .set("Authorization", admin())
      .send({ method: "carrier_pigeon" });
    expect(bad.status).toBe(400);
    const stale = await request(app)
      .post(`/contacts/${j.id}/vote-plan`)
      .set("Authorization", admin())
      .send({ method: "absentee", version: 999 });
    expect(stale.status).toBe(409);
  });
});

describe("GOTV polling place", () => {
  it("returns the address, an LEA, and the official MO lookup URL", async () => {
    const { id } = await firstContactId();
    const r = await request(app)
      .get(`/contacts/${id}/polling-place`)
      .set("Authorization", admin());
    expect(r.status).toBe(200);
    expect(r.body.lookupUrl).toContain("sos.mo.gov");
    expect(r.body.lea).toBeTruthy();
    expect(typeof r.body.address === "string" || r.body.address === null).toBe(true);
  });

  it("404s for an unknown contact", async () => {
    const r = await request(app)
      .get(`/contacts/nope/polling-place`)
      .set("Authorization", admin());
    expect(r.status).toBe(404);
  });
});

describe("GOTV follow-up reminders", () => {
  async function scheduleFor(id: string, dueAt: string) {
    return request(app)
      .post(`/contacts/${id}/followups`)
      .set("Authorization", admin())
      .send({ dueAt, note: "call back" });
  }

  it("schedules reminders and lists only those come due", async () => {
    const { id } = await firstContactId();
    const past = await scheduleFor(id, "2020-01-01T00:00:00.000Z");
    expect(past.status).toBe(201);
    expect(past.body.status).toBe("pending");
    const future = await scheduleFor(id, "2999-01-01T00:00:00.000Z");
    expect(future.status).toBe(201);

    const due = await request(app)
      .get("/followups?due=now")
      .set("Authorization", admin());
    expect(due.status).toBe(200);
    const ids = due.body.map((f: { id: string }) => f.id);
    expect(ids).toContain(past.body.id);
    expect(ids).not.toContain(future.body.id);
  });

  it("marks a reminder done so it drops off the due queue", async () => {
    const { id } = await firstContactId();
    const f = await scheduleFor(id, "2020-01-01T00:00:00.000Z");
    const done = await request(app)
      .post(`/followups/${f.body.id}/done`)
      .set("Authorization", admin())
      .send({});
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("done");
    const due = await request(app).get("/followups?due=now").set("Authorization", admin());
    expect(due.body.map((x: { id: string }) => x.id)).not.toContain(f.body.id);
  });

  it("rejects a bad dueAt (400) and unknown reminder (404)", async () => {
    const { id } = await firstContactId();
    const bad = await scheduleFor(id, "not-a-date");
    expect(bad.status).toBe(400);
    const missing = await request(app)
      .post(`/followups/nope/done`)
      .set("Authorization", admin())
      .send({});
    expect(missing.status).toBe(404);
  });
});

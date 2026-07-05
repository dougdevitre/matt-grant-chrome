// Integration: social amplification — read/share (any clerk), draft/generate
// (comms.draft), approve (comms.approve), blasts, and the media dashboard.

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

const social = () => bearer(tokenFor("social_comms_clerk"));
const compliance = () => bearer(tokenFor("compliance_clerk"));
const voter = () => bearer(tokenFor("voter_contact_clerk"));

const DISCLAIMER = "Paid for by Matt Grant for Congress.";

describe("GET /social/posts", () => {
  it("returns the seeded approved posts for any signed-in clerk", async () => {
    const res = await request(app).get("/social/posts").set("Authorization", voter());
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    expect(res.body.every((p: { status: string }) => p.status === "approved")).toBe(true);
  });

  it("401s without a token", async () => {
    expect((await request(app).get("/social/posts")).status).toBe(401);
  });

  it("gates draft visibility behind a comms scope", async () => {
    expect(
      (await request(app).get("/social/posts?status=draft").set("Authorization", voter())).status
    ).toBe(403);
    expect(
      (await request(app).get("/social/posts?status=draft").set("Authorization", social())).status
    ).toBe(200);
  });

  it("filters by phase relevance", async () => {
    const res = await request(app)
      .get("/social/posts?phase=PHASE_1_REGISTER")
      .set("Authorization", voter());
    expect(res.status).toBe(200);
    expect(res.body.every((p: { phases: string[] }) => p.phases.includes("PHASE_1_REGISTER"))).toBe(
      true
    );
  });
});

describe("POST /social/generate", () => {
  it("requires comms.draft", async () => {
    const res = await request(app)
      .post("/social/generate")
      .set("Authorization", voter())
      .send({ category: "donate" });
    expect(res.status).toBe(403);
  });

  it("returns an unsaved draft with a disclaimer + hashtags", async () => {
    const res = await request(app)
      .post("/social/generate")
      .set("Authorization", social())
      .send({ category: "donate" });
    expect(res.status).toBe(200);
    expect(res.body.disclaimer).toContain("Paid for by");
    expect(res.body.hashtags.length).toBeGreaterThan(0);
    expect(res.body.variants.some((v: { platform: string }) => v.platform === "x")).toBe(true);
  });

  it("400s on an unknown category", async () => {
    const res = await request(app)
      .post("/social/generate")
      .set("Authorization", social())
      .send({ category: "nope" });
    expect(res.status).toBe(400);
  });
});

describe("draft → approve → share lifecycle", () => {
  async function draft(withDisclaimer: boolean): Promise<string> {
    const res = await request(app)
      .post("/social/posts")
      .set("Authorization", social())
      .send({
        category: "plan",
        title: "Make your plan",
        phases: ["PHASE_2_PLAN"],
        variants: [{ platform: "x", text: `Make a plan to vote. ${withDisclaimer ? DISCLAIMER : ""}` }],
        hashtags: ["#MO02"],
        linkUrl: "https://example.org",
        disclaimer: withDisclaimer ? DISCLAIMER : null,
      });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  it("blocks approval when the disclaimer is missing", async () => {
    const id = await draft(false);
    const res = await request(app)
      .post(`/social/posts/${id}/approve`)
      .set("Authorization", compliance())
      .send({ approve: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("missing_disclaimer");
  });

  it("approves a compliant post and makes it shareable", async () => {
    const id = await draft(true);
    const appr = await request(app)
      .post(`/social/posts/${id}/approve`)
      .set("Authorization", compliance())
      .send({ approve: true });
    expect(appr.status).toBe(200);
    expect(appr.body.status).toBe("approved");

    const shared = await request(app)
      .post(`/social/posts/${id}/shared`)
      .set("Authorization", voter())
      .send({ platform: "x" });
    expect(shared.status).toBe(200);
    expect(shared.body.shareCount).toBe(1);
  });

  it("refuses to count a share on a draft (not approved)", async () => {
    const id = await draft(true);
    const res = await request(app)
      .post(`/social/posts/${id}/shared`)
      .set("Authorization", voter());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("not_approved");
  });

  it("requires comms.approve to approve", async () => {
    const id = await draft(true);
    expect(
      (await request(app).post(`/social/posts/${id}/approve`).set("Authorization", voter())).status
    ).toBe(403);
  });
});

describe("blasts + GET /dashboard/social", () => {
  it("lists seeded blasts and reflects a new share on the dashboard", async () => {
    const blasts = await request(app).get("/social/blasts").set("Authorization", voter());
    expect(blasts.status).toBe(200);
    expect(blasts.body.length).toBeGreaterThanOrEqual(2);

    const before = await request(app).get("/dashboard/social").set("Authorization", voter());
    expect(before.status).toBe(200);
    const baseline = before.body.totalShares;

    const posts = await request(app).get("/social/posts").set("Authorization", voter());
    const postId = posts.body[0].id;
    await request(app)
      .post(`/social/posts/${postId}/shared`)
      .set("Authorization", voter())
      .send({ platform: "facebook" });

    const after = await request(app).get("/dashboard/social").set("Authorization", voter());
    expect(after.body.totalShares).toBe(baseline + 1);
    expect(after.body.activeBlast).not.toBeNull();
  });

  it("creates a blast (comms.draft) and advances its status (comms.approve)", async () => {
    const created = await request(app)
      .post("/social/blasts")
      .set("Authorization", social())
      .send({ title: "Early vote push", scheduledFor: "2026-07-22T09:00:00-05:00", goal: 100 });
    expect(created.status).toBe(201);
    const id = created.body.id;

    // Wrong scope can't create.
    expect(
      (await request(app).post("/social/blasts").set("Authorization", voter()).send({
        title: "x",
        scheduledFor: "2026-07-22T09:00:00-05:00",
      })).status
    ).toBe(403);

    const advanced = await request(app)
      .post(`/social/blasts/${id}/status`)
      .set("Authorization", compliance())
      .send({ status: "active" });
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe("active");
  });
});

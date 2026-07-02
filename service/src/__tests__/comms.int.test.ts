// Integration: the layered SMS send guard. Order is budget/kill-switch ->
// admin scope -> step-up re-auth, with consent enforced in the pipeline. SMS is
// the highest-risk capability, so each layer is exercised independently.

import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index.js";
import { resetStoreForTests } from "../lib/store.js";
import { TEST_JWT_SECRET, tokenFor, stepUpToken, bearer } from "./helpers.js";

// Register-category sends are valid in this phase. 18:00Z is 13:00 (1pm) in
// America/Chicago — inside the default TCPA quiet-hours window (8am–9pm), so the
// "happy path" sends are not blocked on time-of-day. Quiet-hours rejection is
// exercised explicitly below by moving the clock to the small hours.
const PHASE1 = new Date("2026-07-01T18:00:00Z");

// Approved register-category SMS template: carries the "Paid for by" disclaimer
// and STOP opt-out language so approval succeeds.
const SMS_BODY =
  "Register to vote today at sos.mo.gov. Paid for by Matt Grant for Congress. Reply STOP to opt out.";

let templateId: string;
let averyId: string; // seeded contact with consentSms = true and a phone

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

beforeEach(async () => {
  resetStoreForTests();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PHASE1);
  delete process.env.SMS_ENABLED;

  const admin = tokenFor("admin");
  const created = await request(app)
    .post("/comms/templates")
    .set("Authorization", bearer(admin))
    .send({ category: "register", channel: "sms", body: SMS_BODY });
  expect(created.status).toBe(201);
  templateId = created.body.id;

  const approved = await request(app)
    .post(`/comms/templates/${templateId}/approve`)
    .set("Authorization", bearer(admin))
    .send({ approve: true });
  expect(approved.status).toBe(200);

  const contacts = await request(app)
    .get("/contacts")
    .set("Authorization", bearer(admin));
  expect(contacts.status).toBe(200);
  averyId = contacts.body.find((c: { firstName: string }) => c.firstName === "Avery").id;
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.SMS_ENABLED;
});

describe("SMS send guard", () => {
  it("blocks a non-admin clerk from sending SMS (403 sms_admin_only)", async () => {
    // social_comms_clerk has comms.send (route allows) but not sms.send.
    const res = await request(app)
      .post("/comms/send")
      .set("Authorization", bearer(tokenFor("social_comms_clerk", "social-1")))
      .send({ templateId, recipient: "+13140000000", idempotencyKey: "k-scope" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sms_admin_only");
  });

  it("requires a step-up token even for admin (401 step_up_required)", async () => {
    const res = await request(app)
      .post("/comms/send")
      .set("Authorization", bearer(tokenFor("admin")))
      .send({ templateId, recipient: "+13140000000", idempotencyKey: "k-nostepup" });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("step_up_required");
  });

  it("honors the kill switch before anything else (503 sms_disabled)", async () => {
    process.env.SMS_ENABLED = "false";
    const res = await request(app)
      .post("/comms/send")
      .set("Authorization", bearer(tokenFor("admin")))
      .set("X-StepUp-Token", stepUpToken())
      .send({ templateId, recipient: "+13140000000", idempotencyKey: "k-killswitch" });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("sms_disabled");
  });

  it("blocks a raw SMS send that cannot verify consent (409 no_consent)", async () => {
    const res = await request(app)
      .post("/comms/send")
      .set("Authorization", bearer(tokenFor("admin")))
      .set("X-StepUp-Token", stepUpToken())
      .send({ templateId, recipient: "+13140000000", idempotencyKey: "k-raw" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("no_consent");
  });

  it("sends to a consenting contact through the full guard (200 sent)", async () => {
    const res = await request(app)
      .post("/comms/send-to-contact")
      .set("Authorization", bearer(tokenFor("admin")))
      .set("X-StepUp-Token", stepUpToken())
      .send({ templateId, contactId: averyId, idempotencyKey: "k-avery" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("sent");
  });

  it("rejects an idempotency key with unsafe characters (400)", async () => {
    const res = await request(app)
      .post("/comms/send")
      .set("Authorization", bearer(tokenFor("admin")))
      .send({ templateId, recipient: "+13140000000", idempotencyKey: "bad'key) | TRUE()" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_idempotency_key");
  });
});

describe("SMS quiet hours (TCPA)", () => {
  afterEach(() => {
    delete process.env.SMS_QUIET_ENABLED;
  });

  it("blocks an SMS send in the recipient's small hours (403 quiet_hours)", async () => {
    // 07:00Z on Jul 1 is 02:00 in America/Chicago — before the 8am window.
    vi.setSystemTime(new Date("2026-07-01T07:00:00Z"));
    const res = await request(app)
      .post("/comms/send-to-contact")
      .set("Authorization", bearer(tokenFor("admin")))
      .set("X-StepUp-Token", stepUpToken())
      .send({ templateId, contactId: averyId, idempotencyKey: "k-quiet" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("quiet_hours");
  });

  it("allows the same send once quiet hours are disabled", async () => {
    process.env.SMS_QUIET_ENABLED = "false";
    vi.setSystemTime(new Date("2026-07-01T07:00:00Z"));
    const res = await request(app)
      .post("/comms/send-to-contact")
      .set("Authorization", bearer(tokenFor("admin")))
      .set("X-StepUp-Token", stepUpToken())
      .send({ templateId, contactId: averyId, idempotencyKey: "k-quiet-off" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("sent");
  });
});

describe("seeded GOTV turnout templates", () => {
  it("ships turnout scripts, left unapproved for compliance", async () => {
    const res = await request(app)
      .get("/comms/templates")
      .set("Authorization", bearer(tokenFor("admin")));
    expect(res.status).toBe(200);
    const turnout = res.body.filter(
      (t: { category: string }) => t.category === "turnout"
    );
    expect(turnout.length).toBeGreaterThanOrEqual(3);
    // Seeded as drafts (must be approved before they can be sent) and carry the
    // STOP opt-out language the SMS guard requires.
    for (const t of turnout) {
      expect(t.complianceApprovalId).toBeNull();
      expect(t.hasOptOut).toBe(true);
    }
  });
});

describe("GOTV batch send-to-unvoted", () => {
  // Email register-category template (approved) — avoids the SMS step-up path so
  // the batch can exercise the contact-selection + per-send loop directly.
  const EMAIL_BODY =
    "Make your plan to vote. Paid for by Matt Grant for Congress. Reply STOP or unsubscribe to opt out.";
  async function approvedEmailTemplate() {
    const admin = bearer(tokenFor("admin"));
    const c = await request(app)
      .post("/comms/templates")
      .set("Authorization", admin)
      .send({ category: "register", channel: "email", body: EMAIL_BODY });
    expect(c.status).toBe(201);
    await request(app)
      .post(`/comms/templates/${c.body.id}/approve`)
      .set("Authorization", admin)
      .send({ approve: true });
    return c.body.id;
  }

  it("sends to not-yet-voted contacts and skips those who already voted", async () => {
    const id = await approvedEmailTemplate();
    const res = await request(app)
      .post("/comms/send-batch")
      .set("Authorization", bearer(tokenFor("admin")))
      .send({ templateId: id });
    expect(res.status).toBe(200);
    // Seed: Jordan (email, unknown → included) + Avery (early_voted → excluded).
    expect(res.body.attempted).toBe(1);
    expect(res.body.sent).toBe(1);
    expect(res.body.truncated).toBe(false);
  });

  it("404s for an unknown template", async () => {
    const res = await request(app)
      .post("/comms/send-batch")
      .set("Authorization", bearer(tokenFor("admin")))
      .send({ templateId: "does-not-exist" });
    expect(res.status).toBe(404);
  });

  it("requires comms.send scope", async () => {
    const id = await approvedEmailTemplate();
    const res = await request(app)
      .post("/comms/send-batch")
      .set("Authorization", bearer(tokenFor("registration_clerk", "reg-1")))
      .send({ templateId: id });
    expect(res.status).toBe(403);
  });
});

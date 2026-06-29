// Integration: the public, signature-protected Twilio inbound webhook. A bad
// signature is rejected; a valid STOP records the opt-out, flips the matching
// contact, and appends a tamper-evident audit entry.

import request from "supertest";
import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { getStore } from "../lib/store.js";
import { contactKeyFor } from "../lib/keys.js";
import { TEST_JWT_SECRET } from "./helpers.js";

const AUTH_TOKEN = "twilio-test-token";
const WEBHOOK_URL = "https://hook.example.com/twilio/inbound";

beforeAll(() => {
  process.env.TWILIO_AUTH_TOKEN = AUTH_TOKEN;
  process.env.TWILIO_WEBHOOK_URL = WEBHOOK_URL;
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

// Twilio signs (url + each POST param appended in key order) with HMAC-SHA1.
function sign(params: Record<string, string>): string {
  let data = WEBHOOK_URL;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return createHmac("sha1", AUTH_TOKEN).update(Buffer.from(data, "utf-8")).digest("base64");
}

describe("POST /twilio/inbound", () => {
  it("rejects a bad signature (403 invalid_signature)", async () => {
    const res = await request(app)
      .post("/twilio/inbound")
      .type("form")
      .set("X-Twilio-Signature", "not-the-right-signature")
      .send({ From: "+13140000000", Body: "STOP" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("invalid_signature");
  });

  it("records an opt-out for a valid STOP and flips the contact", async () => {
    // Avery (+13145550199) is seeded with optOut = false.
    const params = { From: "+13145550199", Body: "STOP" };
    const res = await request(app)
      .post("/twilio/inbound")
      .type("form")
      .set("X-Twilio-Signature", sign(params))
      .send(params);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/xml");

    const store = await getStore();
    const key = contactKeyFor("+13145550199");
    expect(await store.isOptedOut(key)).toBe(true);
    const contact = await store.findContactByKey(key);
    expect(contact?.optOut).toBe(true);
    const audit = await store.readAudit();
    expect(audit.some((a) => a.action === "optout.sms_stop")).toBe(true);
  });
});

import { Router } from "express";
import { getConfig } from "../config.js";
import { validateTwilioSignature } from "../lib/sms.js";
import { contactKeyFor } from "../lib/keys.js";
import { getStore } from "../lib/store.js";

// Unauthenticated (Twilio calls it) but protected by X-Twilio-Signature. Records
// inbound STOP messages into our opt-out list so the carrier opt-out and our own
// stay in sync. Mount before the auth gate; uses urlencoded body parsing.
export const twilioRouter = Router();

const STOP_WORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

twilioRouter.post("/inbound", async (req, res) => {
  const authToken = await getConfig("TWILIO_AUTH_TOKEN");
  const webhookUrl = await getConfig("TWILIO_WEBHOOK_URL");
  if (!authToken || !webhookUrl) {
    res.status(503).json({ error: "twilio_webhook_not_configured" });
    return;
  }

  const signature = req.header("x-twilio-signature") ?? "";
  const params = req.body as Record<string, string>;
  if (!validateTwilioSignature(authToken, webhookUrl, params, signature)) {
    res.status(403).json({ error: "invalid_signature" });
    return;
  }

  const from = String(params.From ?? "");
  const body = String(params.Body ?? "").trim().toUpperCase();
  if (from && STOP_WORDS.has(body)) {
    const store = await getStore();
    const key = contactKeyFor(from);
    await store.addOptOut(key);
    const existing = await store.findContactByKey(key);
    if (existing && !existing.optOut) {
      await store.putContact({ ...existing, optOut: true, updatedAt: new Date().toISOString() });
    }
    await store.appendAudit({
      id: `${Date.now()}`,
      ts: new Date().toISOString(),
      clerkId: "twilio:inbound",
      action: "optout.sms_stop",
      entity: "optout",
      entityId: key,
    });
  }

  // Twilio expects a 200 with TwiML (empty = no auto-reply; Advanced Opt-Out
  // handles the STOP confirmation at the carrier level).
  res.set("Content-Type", "text/xml").send("<Response></Response>");
});

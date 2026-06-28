// SMS integration. Port + two adapters, same pattern as the mailer.
//   noop   (default): "sends" succeed without a provider, so the consent/gate
//                     logic stays testable offline.
//   twilio (flag):    sends via your Messaging Service (sender pool handles the
//                     toll-free number). SMS_DRIVER=twilio with credentials in
//                     SSM/env. The Auth Token is a SECRET — SSM SecureString only.
//
// Also exports validateTwilioSignature for the inbound STOP webhook.

import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../config.js";

export interface OutboundSms {
  to: string;
  body: string;
}

export interface SmsPort {
  send(msg: OutboundSms): Promise<{ ok: boolean; providerId?: string }>;
}

function maskPhone(to: string): string {
  // Show only the last 2 digits, e.g. +1314*****23
  const digits = to.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${to.slice(0, 2)}***${digits.slice(-2)}`;
}

class NoopSms implements SmsPort {
  async send(msg: OutboundSms): Promise<{ ok: boolean; providerId: string }> {
    // PII-safe: never log the number or message body.
    console.log("[sms:noop] queued to", maskPhone(msg.to));
    return { ok: true, providerId: `noop-${Date.now()}` };
  }
}

class TwilioSms implements SmsPort {
  constructor(
    private accountSid: string,
    private authToken: string,
    private messagingServiceSid: string
  ) {}

  async send(msg: OutboundSms): Promise<{ ok: boolean; providerId?: string }> {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const form = new URLSearchParams({
      MessagingServiceSid: this.messagingServiceSid, // sender pool picks the number
      To: msg.to,
      Body: msg.body,
    });
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { sid?: string };
    return { ok: true, providerId: json.sid };
  }
}

let singleton: SmsPort | null = null;

export async function getSms(): Promise<SmsPort> {
  if (singleton) return singleton;
  const driver = process.env.SMS_DRIVER ?? "noop";
  if (driver === "twilio") {
    const accountSid = await getConfig("TWILIO_ACCOUNT_SID");
    const authToken = await getConfig("TWILIO_AUTH_TOKEN");
    const msgSid = await getConfig("TWILIO_MESSAGING_SERVICE_SID");
    if (accountSid && authToken && msgSid) {
      singleton = new TwilioSms(accountSid, authToken, msgSid);
      return singleton;
    }
    console.warn("[sms] twilio driver selected but credentials missing; using noop");
  }
  singleton = new NoopSms();
  return singleton;
}

/**
 * Validate Twilio's X-Twilio-Signature for an inbound webhook. Twilio signs
 * (full URL + each POST param appended in key order) with the Auth Token via
 * HMAC-SHA1, base64-encoded.
 */
export function validateTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];
  const expected = createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && timingSafeEqual(a, b);
}

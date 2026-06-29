// Twilio inbound-webhook signature validation. Uses Twilio's own published
// example vector so we know we match their HMAC-SHA1 scheme, then proves
// tampering with any input fails the check.

import { validateTwilioSignature } from "../lib/sms.js";

// From Twilio's security docs.
const AUTH_TOKEN = "12345";
const URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const PARAMS = {
  CallSid: "CA1234567890ABCDE",
  Caller: "+14158675309",
  Digits: "1234",
  From: "+14158675309",
  To: "+18005551212",
};
const VALID_SIGNATURE = "RSOYDt4T1cUTdK1PDd93/VVr8B8=";

describe("validateTwilioSignature", () => {
  it("accepts Twilio's documented example signature", () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, VALID_SIGNATURE)).toBe(true);
  });

  it("rejects when a param value is tampered", () => {
    const tampered = { ...PARAMS, Digits: "9999" };
    expect(validateTwilioSignature(AUTH_TOKEN, URL, tampered, VALID_SIGNATURE)).toBe(false);
  });

  it("rejects a wrong/forged signature", () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, "deadbeef=")).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, "")).toBe(false);
  });

  it("rejects when signed with the wrong auth token", () => {
    expect(validateTwilioSignature("wrong-token", URL, PARAMS, VALID_SIGNATURE)).toBe(false);
  });
});

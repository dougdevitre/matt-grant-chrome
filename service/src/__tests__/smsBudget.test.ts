// SMS operational safeguards: global kill switch + daily cap. Each test pins a
// distinct system day so the module-level counter resets at its first call,
// keeping the tests independent of one another's ordering.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canSendSms, recordSmsSent } from "../lib/smsBudget.js";

const ENV_KEYS = ["SMS_ENABLED", "SMS_DAILY_CAP"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("canSendSms", () => {
  it("blocks everything when the kill switch is off", () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    process.env.SMS_ENABLED = "false";
    expect(canSendSms()).toEqual({ ok: false, reason: "sms_disabled" });
  });

  it("allows sends under the daily cap", () => {
    vi.setSystemTime(new Date("2026-07-02T12:00:00Z"));
    delete process.env.SMS_ENABLED;
    expect(canSendSms()).toEqual({ ok: true });
  });

  it("blocks once the daily cap is reached", () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00Z"));
    process.env.SMS_DAILY_CAP = "2";
    expect(canSendSms().ok).toBe(true);
    recordSmsSent();
    recordSmsSent();
    expect(canSendSms()).toEqual({ ok: false, reason: "sms_cap_reached" });
  });

  it("resets the counter on a new calendar day", () => {
    process.env.SMS_DAILY_CAP = "2";
    vi.setSystemTime(new Date("2026-07-04T23:59:00Z"));
    recordSmsSent();
    recordSmsSent();
    expect(canSendSms()).toEqual({ ok: false, reason: "sms_cap_reached" });
    // Next day: cap resets.
    vi.setSystemTime(new Date("2026-07-05T00:01:00Z"));
    expect(canSendSms()).toEqual({ ok: true });
  });
});

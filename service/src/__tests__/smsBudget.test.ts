// SMS kill switch + daily cap, now backed by the shared counter. The counter is
// reset per test; a distinct system day is pinned so the per-day key is fresh.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canSendSms, recordSmsSent } from "../lib/smsBudget.js";
import { resetCounterForTests } from "../lib/counter.js";

const ENV_KEYS = ["SMS_ENABLED", "SMS_DAILY_CAP", "REDIS_URL", "COUNTER_DRIVER"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  delete process.env.REDIS_URL; // force the memory counter
  delete process.env.COUNTER_DRIVER;
  resetCounterForTests();
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
  it("blocks everything when the kill switch is off", async () => {
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    process.env.SMS_ENABLED = "false";
    expect(await canSendSms()).toEqual({ ok: false, reason: "sms_disabled" });
  });

  it("allows sends under the daily cap", async () => {
    vi.setSystemTime(new Date("2026-07-02T12:00:00Z"));
    delete process.env.SMS_ENABLED;
    expect(await canSendSms()).toEqual({ ok: true });
  });

  it("blocks once the daily cap is reached", async () => {
    vi.setSystemTime(new Date("2026-07-03T12:00:00Z"));
    process.env.SMS_DAILY_CAP = "2";
    expect((await canSendSms()).ok).toBe(true);
    await recordSmsSent();
    await recordSmsSent();
    expect(await canSendSms()).toEqual({ ok: false, reason: "sms_cap_reached" });
  });

  it("resets the counter on a new calendar day", async () => {
    process.env.SMS_DAILY_CAP = "2";
    vi.setSystemTime(new Date("2026-07-04T23:59:00Z"));
    await recordSmsSent();
    await recordSmsSent();
    expect(await canSendSms()).toEqual({ ok: false, reason: "sms_cap_reached" });
    vi.setSystemTime(new Date("2026-07-05T00:01:00Z")); // new day → fresh key
    expect(await canSendSms()).toEqual({ ok: true });
  });
});

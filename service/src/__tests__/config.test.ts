// Refuse-to-boot guard. In production, assertSecureStartup() must flag every
// insecure default. NODE_ENV / ALLOWED_ORIGIN are captured at module load, so
// each scenario sets env first, then imports a fresh copy of the module.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOUCHED = [
  "NODE_ENV",
  "JWT_SECRET",
  "AUTH_DRIVER",
  "ALLOWED_ORIGIN",
  "SMS_DRIVER",
  "STORE_DRIVER",
  "AIRTABLE_PAT",
  "SSM_PREFIX",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_WEBHOOK_URL",
];
let snapshot: Record<string, string | undefined>;

beforeEach(() => {
  snapshot = {};
  for (const k of TOUCHED) snapshot[k] = process.env[k];
  // Never let a real SSM lookup happen in tests.
  delete process.env.SSM_PREFIX;
});

afterEach(() => {
  for (const k of TOUCHED) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k];
  }
  vi.resetModules();
});

async function runStartup(env: Record<string, string | undefined>): Promise<string[]> {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  const mod = await import("../config.js");
  return mod.assertSecureStartup();
}

const CLEAN = {
  NODE_ENV: "production",
  JWT_SECRET: "a-strong-production-secret",
  AUTH_DRIVER: "clerk",
  ALLOWED_ORIGIN: "https://app.example.com",
  SMS_DRIVER: "noop",
};

describe("assertSecureStartup", () => {
  it("passes a fully-locked-down production config", async () => {
    expect(await runStartup(CLEAN)).toEqual([]);
  });

  it("returns [] outside production regardless of config", async () => {
    expect(await runStartup({ ...CLEAN, NODE_ENV: "development", JWT_SECRET: undefined }))
      .toEqual([]);
  });

  it("flags a missing or default JWT_SECRET", async () => {
    const missing = await runStartup({ ...CLEAN, JWT_SECRET: undefined });
    expect(missing.some((p) => p.includes("JWT_SECRET"))).toBe(true);
    const def = await runStartup({ ...CLEAN, JWT_SECRET: "dev-only-change-me" });
    expect(def.some((p) => p.includes("JWT_SECRET"))).toBe(true);
  });

  it("flags a non-clerk auth driver", async () => {
    const problems = await runStartup({ ...CLEAN, AUTH_DRIVER: "dev" });
    expect(problems.some((p) => p.includes("AUTH_DRIVER"))).toBe(true);
  });

  it("flags a wildcard ALLOWED_ORIGIN", async () => {
    const problems = await runStartup({ ...CLEAN, ALLOWED_ORIGIN: "*" });
    expect(problems.some((p) => p.includes("ALLOWED_ORIGIN"))).toBe(true);
  });

  it("flags twilio driver with missing credentials", async () => {
    const problems = await runStartup({ ...CLEAN, SMS_DRIVER: "twilio" });
    for (const k of [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_MESSAGING_SERVICE_SID",
      "TWILIO_WEBHOOK_URL",
    ]) {
      expect(problems.some((p) => p.includes(k))).toBe(true);
    }
  });

  it("flags airtable store driver with a missing PAT", async () => {
    const problems = await runStartup({ ...CLEAN, STORE_DRIVER: "airtable" });
    expect(problems.some((p) => p.includes("AIRTABLE_PAT"))).toBe(true);
    // ...and passes once the PAT is present.
    const ok = await runStartup({ ...CLEAN, STORE_DRIVER: "airtable", AIRTABLE_PAT: "pat" });
    expect(ok).toEqual([]);
  });
});

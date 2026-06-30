// Baseline security headers are applied to every response, and Express's
// x-powered-by banner is suppressed.

import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "../index.js";

describe("security headers", () => {
  it("sets hardening headers and hides x-powered-by", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("request id + readiness", () => {
  it("generates an X-Request-Id when none is supplied", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-request-id"]).toMatch(/[0-9a-f-]{36}/);
  });

  it("echoes a supplied X-Request-Id", async () => {
    const res = await request(app).get("/health").set("X-Request-Id", "trace-abc");
    expect(res.headers["x-request-id"]).toBe("trace-abc");
  });

  it("reports ready when the store is constructable", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
  });
});

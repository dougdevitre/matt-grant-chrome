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

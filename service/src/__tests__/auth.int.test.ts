// Integration: the authenticate + requireScope middleware boundary. This is the
// real RBAC gate (client gating is cosmetic), so it must fail closed.

import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

describe("auth + RBAC middleware", () => {
  it("rejects a request with no token (401 missing_token)", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing_token");
  });

  it("rejects a malformed bearer token (401 invalid_token)", async () => {
    const res = await request(app).get("/me").set("Authorization", "Bearer not-a-jwt");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  it("rejects a valid token that lacks the route scope (403 forbidden)", async () => {
    // public role has only voter.read; /tasks requires task.read.
    const res = await request(app)
      .get("/tasks")
      .set("Authorization", bearer(tokenFor("public")));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("derives scopes server-side from the role, ignoring the client", async () => {
    const res = await request(app)
      .get("/me")
      .set("Authorization", bearer(tokenFor("admin")));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
    expect(res.body.scopes).toContain("sms.send");
  });
});

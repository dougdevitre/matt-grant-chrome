// GET /audit/verify recomputes the hash chain over the live store and is gated
// on audit.read (compliance/admin only).

import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index.js";
import { resetStoreForTests } from "../lib/store.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";
import type { Task } from "../lib/types.js";

const PHASE1 = new Date("2026-07-01T12:00:00Z");

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

beforeEach(() => {
  resetStoreForTests();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(PHASE1);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /audit/verify", () => {
  it("requires the audit.read scope", async () => {
    const res = await request(app)
      .get("/audit/verify")
      .set("Authorization", bearer(tokenFor("registration_clerk")));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });

  it("verifies the chain clean after real actions append audit entries", async () => {
    const admin = tokenFor("admin");
    // Generate audit entries by claiming a seeded task.
    const queue = (
      await request(app).get("/tasks").set("Authorization", bearer(admin))
    ).body as Task[];
    const call = queue.find((t) => t.kind === "call")!;
    await request(app)
      .post(`/tasks/${call.id}/claim`)
      .set("Authorization", bearer(admin))
      .send({});

    const res = await request(app).get("/audit/verify").set("Authorization", bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body.brokeAt).toBe(-1);
  });
});

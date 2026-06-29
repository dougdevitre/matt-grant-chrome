// Integration: task concurrency (optimistic version locking) and the phase
// deadline gate. Only the Date is faked so the in-process phase clock advances
// while supertest's real timers keep working.

import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index.js";
import { resetStoreForTests } from "../lib/store.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";
import type { Task } from "../lib/types.js";

const PHASE1 = new Date("2026-07-01T12:00:00Z"); // PHASE_1_REGISTER
const PHASE2 = new Date("2026-07-15T12:00:00Z"); // past the Jul 8 register deadline

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

async function queue(token: string): Promise<Task[]> {
  const res = await request(app).get("/tasks").set("Authorization", bearer(token));
  expect(res.status).toBe(200);
  return res.body as Task[];
}

function byKind(tasks: Task[], kind: string): Task {
  const t = tasks.find((x) => x.kind === kind);
  if (!t) throw new Error(`seed task of kind ${kind} not found`);
  return t;
}

describe("task claim — version locking", () => {
  it("rejects a claim with a stale version (409 version_conflict)", async () => {
    const admin = tokenFor("admin");
    const call = byKind(await queue(admin), "call");
    const res = await request(app)
      .post(`/tasks/${call.id}/claim`)
      .set("Authorization", bearer(admin))
      .send({ version: 999 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("version_conflict");
  });

  it("rejects a second clerk claiming an already-claimed task (409 already_claimed)", async () => {
    const a = tokenFor("admin", "clerk-a");
    const b = tokenFor("admin", "clerk-b");
    const call = byKind(await queue(a), "call");

    const first = await request(app)
      .post(`/tasks/${call.id}/claim`)
      .set("Authorization", bearer(a))
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/tasks/${call.id}/claim`)
      .set("Authorization", bearer(b))
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("already_claimed");
  });
});

describe("task complete — phase deadline", () => {
  it("blocks completing a registration task after the Jul 8 deadline (409 phase_closed)", async () => {
    const admin = tokenFor("admin");
    const reg = byKind(await queue(admin), "register_contact");

    // Claim while still in PHASE_1.
    const claim = await request(app)
      .post(`/tasks/${reg.id}/claim`)
      .set("Authorization", bearer(admin))
      .send({});
    expect(claim.status).toBe(200);

    // Advance past the deadline; the registration task's phase no longer matches.
    vi.setSystemTime(PHASE2);
    const complete = await request(app)
      .post(`/tasks/${reg.id}/complete`)
      .set("Authorization", bearer(admin))
      .send({});
    expect(complete.status).toBe(409);
    expect(complete.body.error).toBe("phase_closed");
  });
});

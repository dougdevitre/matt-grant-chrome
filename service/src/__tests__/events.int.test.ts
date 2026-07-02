// Integration: shift claiming enforces capacity, blocks double-claims, and
// honors optimistic version locking. The seeded drive is PHASE_1-only, so the
// clock is pinned there to make its shifts visible.

import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../index.js";
import { getStore, resetStoreForTests } from "../lib/store.js";
import { claimShift } from "../lib/scheduling.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";

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

// The "Table captain" shift has capacity 2.
async function tableCaptainShiftId(token: string): Promise<string> {
  const res = await request(app).get("/events").set("Authorization", bearer(token));
  expect(res.status).toBe(200);
  const shift = res.body
    .flatMap((e: { shifts: { id: string; role: string }[] }) => e.shifts)
    .find((s: { role: string }) => s.role === "Table captain");
  if (!shift) throw new Error("seed shift 'Table captain' not found");
  return shift.id as string;
}

function claim(shiftId: string, sub: string, body: object = {}) {
  return request(app)
    .post(`/events/shifts/${shiftId}/claim`)
    .set("Authorization", bearer(tokenFor("admin", sub)))
    .send(body);
}

describe("shift claim", () => {
  it("rejects claiming beyond capacity (409 full)", async () => {
    const id = await tableCaptainShiftId(tokenFor("admin", "c1"));
    expect((await claim(id, "c1")).status).toBe(200);
    expect((await claim(id, "c2")).status).toBe(200);
    const third = await claim(id, "c3");
    expect(third.status).toBe(409);
    expect(third.body.error).toBe("full");
  });

  it("rejects the same clerk claiming twice (409 already_claimed)", async () => {
    const id = await tableCaptainShiftId(tokenFor("admin", "c1"));
    expect((await claim(id, "c1")).status).toBe(200);
    const again = await claim(id, "c1");
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_claimed");
  });

  it("rejects a claim with a stale version (409 version_conflict)", async () => {
    const id = await tableCaptainShiftId(tokenFor("admin", "c1"));
    const res = await claim(id, "c1", { version: 999 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("version_conflict");
  });

  it("never over-fills a capacity-1 shift under concurrent claims (CAS)", async () => {
    // Two clerks race for the last seat. The compare-and-swap must let exactly
    // one win; the pre-fix check-then-write let both through past capacity.
    const store = await getStore();
    const event = await store.createEvent({
      title: "Race",
      kind: "canvass",
      county: "Franklin County",
      zip: null,
      venueName: null,
      startsAt: "2026-07-02T15:00:00Z",
      endsAt: "2026-07-02T17:00:00Z",
      phases: ["PHASE_1_REGISTER"],
      createdBy: "seed",
    });
    const shift = await store.createShift({
      eventId: event.id,
      role: "Solo",
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      capacity: 1,
    });

    const results = await Promise.all([
      claimShift(shift.id, "clerkA"),
      claimShift(shift.id, "clerkB"),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const after = await store.getShift(shift.id);
    expect(after?.claimedBy).toHaveLength(1);
  });

  it("forbids the voter-facing public role from claiming a shift (403)", async () => {
    const id = await tableCaptainShiftId(tokenFor("admin", "c1"));
    const res = await request(app)
      .post(`/events/shifts/${id}/claim`)
      .set("Authorization", bearer(tokenFor("public", "voter-1")))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });
});

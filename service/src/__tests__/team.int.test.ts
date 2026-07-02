// Integration: Team Captain view. A captain sees only their own roster and may
// only read a volunteer they manage; an admin sees/reads everyone. Gating is
// server-authoritative (team.read scope + per-team ownership check).

import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../index.js";
import { getStore, resetStoreForTests } from "../lib/store.js";
import type { NewTeamMember } from "../lib/store.js";
import { TEST_JWT_SECRET, tokenFor, bearer } from "./helpers.js";

const CAPTAIN = "cap-1";
const OTHER_CAPTAIN = "cap-2";

const member = (over: Partial<NewTeamMember>): NewTeamMember => ({
  clerkId: "vol-x",
  displayName: "Vol X",
  email: null,
  phone: null,
  teamId: "Team A",
  captainClerkId: CAPTAIN,
  active: true,
  ...over,
});

beforeAll(() => {
  process.env.JWT_SECRET = TEST_JWT_SECRET;
});

beforeEach(async () => {
  resetStoreForTests();
  const store = await getStore();
  await store.createTeamMember(member({ clerkId: "vol-1", displayName: "Val One", email: "v1@x.co" }));
  await store.createTeamMember(member({ clerkId: "vol-2", displayName: "Val Two" }));
  await store.createTeamMember(
    member({ clerkId: "vol-3", displayName: "Other Team", captainClerkId: OTHER_CAPTAIN })
  );
});

const captain = () => bearer(tokenFor("team_captain", CAPTAIN));
const admin = () => bearer(tokenFor("admin", "admin-1"));

describe("GET /team", () => {
  it("returns only the captain's own roster", async () => {
    const res = await request(app).get("/team").set("Authorization", captain());
    expect(res.status).toBe(200);
    const ids = res.body.map((m: { clerkId: string }) => m.clerkId).sort();
    expect(ids).toEqual(["vol-1", "vol-2"]);
    expect(res.body[0]).toHaveProperty("displayName"); // roster supplies names
  });

  it("lets an admin see the full roster (and filter by ?captainId)", async () => {
    const all = await request(app).get("/team").set("Authorization", admin());
    expect(all.body.length).toBe(3);
    const scoped = await request(app)
      .get(`/team?captainId=${OTHER_CAPTAIN}`)
      .set("Authorization", admin());
    expect(scoped.body.map((m: { clerkId: string }) => m.clerkId)).toEqual(["vol-3"]);
  });

  it("requires team.read (403 for a role without it, 401 with no token)", async () => {
    const forbidden = await request(app)
      .get("/team")
      .set("Authorization", bearer(tokenFor("voter_contact_clerk")));
    expect(forbidden.status).toBe(403);
    const anon = await request(app).get("/team");
    expect(anon.status).toBe(401);
  });
});

describe("GET /team/:clerkId/work", () => {
  it("returns a managed volunteer's tasks, shifts, and activity", async () => {
    // Assign an existing seeded task to vol-1 so the tasks filter is exercised.
    const store = await getStore();
    const tasks = await store.listTasks();
    await store.putTask({ ...tasks[0], assignedClerkId: "vol-1" });

    const res = await request(app).get("/team/vol-1/work").set("Authorization", captain());
    expect(res.status).toBe(200);
    expect(res.body.volunteer.displayName).toBe("Val One");
    expect(res.body.tasks.map((t: { id: string }) => t.id)).toContain(tasks[0].id);
    expect(Array.isArray(res.body.shifts)).toBe(true);
    expect(Array.isArray(res.body.recentActivity)).toBe(true);
  });

  it("403s for a volunteer on another captain's team", async () => {
    const res = await request(app).get("/team/vol-3/work").set("Authorization", captain());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("not_your_volunteer");
  });

  it("admin can read any volunteer; 404 for an unknown clerk", async () => {
    const ok = await request(app).get("/team/vol-3/work").set("Authorization", admin());
    expect(ok.status).toBe(200);
    const missing = await request(app).get("/team/nobody/work").set("Authorization", admin());
    expect(missing.status).toBe(404);
  });
});

describe("POST /team/:clerkId/assign-task", () => {
  // Make a broad-phase open task so the assign isn't blocked by the wall clock.
  async function openTaskId(): Promise<string> {
    const store = await getStore();
    const t = (await store.listTasks())[0];
    await store.putTask({
      ...t,
      status: "open",
      assignedClerkId: null,
      phases: ["PHASE_1_REGISTER", "PHASE_2_PLAN", "PHASE_3_TURNOUT"],
    });
    return t.id;
  }

  it("assigns a task to a managed volunteer", async () => {
    const taskId = await openTaskId();
    const res = await request(app)
      .post("/team/vol-1/assign-task")
      .set("Authorization", captain())
      .send({ taskId });
    expect(res.status).toBe(200);
    expect(res.body.assignedClerkId).toBe("vol-1");
    expect(res.body.status).toBe("claimed");
    // ...and it now shows up in that volunteer's work.
    const work = await request(app).get("/team/vol-1/work").set("Authorization", captain());
    expect(work.body.tasks.map((t: { id: string }) => t.id)).toContain(taskId);
  });

  it("403s assigning to another captain's volunteer; 400 without a taskId", async () => {
    const taskId = await openTaskId();
    const forbidden = await request(app)
      .post("/team/vol-3/assign-task")
      .set("Authorization", captain())
      .send({ taskId });
    expect(forbidden.status).toBe(403);
    const missing = await request(app)
      .post("/team/vol-1/assign-task")
      .set("Authorization", captain())
      .send({});
    expect(missing.status).toBe(400);
  });

  it("requires team.manage (403 for a role without it)", async () => {
    const res = await request(app)
      .post("/team/vol-1/assign-task")
      .set("Authorization", bearer(tokenFor("voter_contact_clerk")))
      .send({ taskId: "x" });
    expect(res.status).toBe(403);
  });
});

describe("POST /team/:clerkId/assign-shift", () => {
  async function capacityOneShift(): Promise<string> {
    const store = await getStore();
    const ev = await store.createEvent({
      title: "Drive",
      kind: "canvass",
      county: "Franklin County",
      zip: null,
      venueName: null,
      startsAt: "2026-07-02T15:00:00Z",
      endsAt: "2026-07-02T17:00:00Z",
      phases: ["PHASE_1_REGISTER"],
      createdBy: "seed",
    });
    const s = await store.createShift({
      eventId: ev.id,
      role: "Greeter",
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      capacity: 1,
    });
    return s.id;
  }

  it("assigns a shift, then rejects over-capacity (409 full)", async () => {
    const shiftId = await capacityOneShift();
    const ok = await request(app)
      .post("/team/vol-1/assign-shift")
      .set("Authorization", captain())
      .send({ shiftId });
    expect(ok.status).toBe(200);
    expect(ok.body.claimedBy).toContain("vol-1");

    const full = await request(app)
      .post("/team/vol-2/assign-shift")
      .set("Authorization", captain())
      .send({ shiftId });
    expect(full.status).toBe(409);
    expect(full.body.error).toBe("full");
  });
});

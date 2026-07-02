import { Router } from "express";
import type { Request } from "express";
import { requireScope, requirePhaseWritable } from "../auth.js";
import { pathParam, queryStr } from "../lib/http.js";
import { assignTask } from "../lib/tasks.js";
import { assignShiftTo } from "../lib/scheduling.js";
import {
  fullRoster,
  inviteVolunteer,
  managesVolunteer,
  nudgeVolunteer,
  removeVolunteer,
  rosterForCaptain,
  volunteerWork,
} from "../lib/team.js";

export const teamRouter = Router();

/** True when the caller may manage `targetClerkId` (their volunteer, or admin). */
async function mayManage(req: Request, targetClerkId: string): Promise<boolean> {
  return (
    req.clerk!.role === "admin" ||
    (await managesVolunteer(req.clerk!.clerkId, targetClerkId))
  );
}

// GET /team — the caller's roster. An admin sees the full roster, or a specific
// captain's via ?captainId=.
teamRouter.get("/", requireScope("team.read"), async (req, res) => {
  if (req.clerk!.role === "admin") {
    const captainId = queryStr(req, "captainId");
    res.json(captainId ? await rosterForCaptain(captainId) : await fullRoster());
    return;
  }
  res.json(await rosterForCaptain(req.clerk!.clerkId));
});

// GET /team/:clerkId/work — a volunteer's tasks / shifts / recent activity.
// Captain-gated: you may only view a volunteer you manage (admin bypasses).
teamRouter.get("/:clerkId/work", requireScope("team.read"), async (req, res) => {
  const target = pathParam(req, "clerkId");
  if (!(await mayManage(req, target))) {
    res.status(403).json({ error: "not_your_volunteer" });
    return;
  }
  const work = await volunteerWork(target);
  if (!work) {
    res.status(404).json({ error: "volunteer_not_found" });
    return;
  }
  res.json(work);
});

// POST /team/:clerkId/assign-task { taskId } — assign/reassign a task to a
// volunteer the caller manages.
teamRouter.post(
  "/:clerkId/assign-task",
  requireScope("team.manage"),
  requirePhaseWritable,
  async (req, res) => {
    const target = pathParam(req, "clerkId");
    if (!(await mayManage(req, target))) {
      res.status(403).json({ error: "not_your_volunteer" });
      return;
    }
    const taskId = typeof req.body?.taskId === "string" ? req.body.taskId : "";
    if (!taskId) {
      res.status(400).json({ error: "missing_taskId" });
      return;
    }
    const result = await assignTask(taskId, target, req.clerk!.clerkId);
    if (result.ok) {
      res.json(result.task);
      return;
    }
    res.status(result.code === "not_found" ? 404 : 409).json({ error: result.code });
  }
);

// POST /team/:clerkId/assign-shift { shiftId } — assign a shift to a volunteer
// the caller manages (respects capacity + optimistic concurrency).
teamRouter.post(
  "/:clerkId/assign-shift",
  requireScope("team.manage"),
  requirePhaseWritable,
  async (req, res) => {
    const target = pathParam(req, "clerkId");
    if (!(await mayManage(req, target))) {
      res.status(403).json({ error: "not_your_volunteer" });
      return;
    }
    const shiftId = typeof req.body?.shiftId === "string" ? req.body.shiftId : "";
    if (!shiftId) {
      res.status(400).json({ error: "missing_shiftId" });
      return;
    }
    const result = await assignShiftTo(shiftId, target, req.clerk!.clerkId);
    if (result.ok) {
      res.json(result.shift);
      return;
    }
    res.status(result.code === "not_found" ? 404 : 409).json({ error: result.code });
  }
);

// POST /team { displayName, email, phone?, teamId?, captainClerkId? } — invite a
// volunteer onto the caller's team (pending until they first sign in). An admin
// may target another captain via captainClerkId or add a bound clerkId directly.
teamRouter.post("/", requireScope("team.manage"), requirePhaseWritable, async (req, res) => {
  const b = req.body ?? {};
  const captainClerkId =
    req.clerk!.role === "admin" && typeof b.captainClerkId === "string"
      ? b.captainClerkId
      : req.clerk!.clerkId;
  const result = await inviteVolunteer(
    {
      displayName: typeof b.displayName === "string" ? b.displayName : "",
      email: typeof b.email === "string" ? b.email : "",
      phone: typeof b.phone === "string" ? b.phone : null,
      teamId: typeof b.teamId === "string" ? b.teamId : null,
      clerkId: req.clerk!.role === "admin" && typeof b.clerkId === "string" ? b.clerkId : null,
    },
    captainClerkId
  );
  if (result.ok) {
    res.status(201).json(result.member);
    return;
  }
  res.status(result.code === "duplicate" ? 409 : 400).json({ error: result.code });
});

// DELETE /team/:id — soft-remove a roster member (own team, or admin).
teamRouter.delete("/:id", requireScope("team.manage"), requirePhaseWritable, async (req, res) => {
  const result = await removeVolunteer(
    pathParam(req, "id"),
    req.clerk!.clerkId,
    req.clerk!.role === "admin"
  );
  if (result.ok) {
    res.json({ status: "removed" });
    return;
  }
  res.status(result.code === "not_found" ? 404 : 403).json({ error: result.code });
});

// POST /team/:clerkId/nudge { message } — email a volunteer you manage.
teamRouter.post(
  "/:clerkId/nudge",
  requireScope("team.manage"),
  requirePhaseWritable,
  async (req, res) => {
    const target = pathParam(req, "clerkId");
    if (!(await mayManage(req, target))) {
      res.status(403).json({ error: "not_your_volunteer" });
      return;
    }
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) {
      res.status(400).json({ error: "missing_message" });
      return;
    }
    res.json(await nudgeVolunteer(target, message, req.clerk!.clerkId));
  }
);

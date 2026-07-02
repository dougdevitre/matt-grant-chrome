import { Router } from "express";
import type { Request } from "express";
import { requireScope, requirePhaseWritable } from "../auth.js";
import { pathParam, queryStr } from "../lib/http.js";
import { assignTask } from "../lib/tasks.js";
import { assignShiftTo } from "../lib/scheduling.js";
import {
  fullRoster,
  managesVolunteer,
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

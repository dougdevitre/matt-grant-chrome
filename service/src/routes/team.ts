import { Router } from "express";
import { requireScope } from "../auth.js";
import { pathParam, queryStr } from "../lib/http.js";
import {
  fullRoster,
  managesVolunteer,
  rosterForCaptain,
  volunteerWork,
} from "../lib/team.js";

export const teamRouter = Router();

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
  if (
    req.clerk!.role !== "admin" &&
    !(await managesVolunteer(req.clerk!.clerkId, target))
  ) {
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

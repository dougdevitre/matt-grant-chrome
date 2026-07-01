import { Router } from "express";
import { requireScope } from "../auth.js";
import { listDueFollowUps, resolveFollowUp } from "../lib/followups.js";
import { getStore } from "../lib/store.js";
import { pathParam, queryStr } from "../lib/http.js";

export const followupsRouter = Router();

// GET /followups?due=now — pending reminders (all, or only those come due).
followupsRouter.get("/", requireScope("voter.read"), async (req, res) => {
  const store = await getStore();
  if (queryStr(req, "due") === "now") {
    res.json(await listDueFollowUps(new Date().toISOString()));
    return;
  }
  res.json(await store.listFollowUps({ status: "pending" }));
});

// POST /followups/:id/done — mark a reminder handled.
followupsRouter.post("/:id/done", requireScope("contact.log"), async (req, res) => {
  const f = await resolveFollowUp(pathParam(req, "id"), req.clerk!.clerkId, "done");
  if (!f) {
    res.status(404).json({ error: "followup_not_found" });
    return;
  }
  res.json(f);
});

// POST /followups/:id/cancel — drop a reminder.
followupsRouter.post("/:id/cancel", requireScope("contact.log"), async (req, res) => {
  const f = await resolveFollowUp(pathParam(req, "id"), req.clerk!.clerkId, "cancelled");
  if (!f) {
    res.status(404).json({ error: "followup_not_found" });
    return;
  }
  res.json(f);
});

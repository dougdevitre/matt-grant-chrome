import { Router } from "express";
import { requireScope } from "../auth.js";
import { gotvDashboard } from "../lib/gotv.js";
import { socialDashboard } from "../lib/socialDash.js";

export const dashboardRouter = Router();

// GET /dashboard/gotv — turnout progress (counts only, no PII).
dashboardRouter.get("/gotv", requireScope("voter.read"), async (_req, res) => {
  res.json(await gotvDashboard());
});

// GET /dashboard/social — amplification progress: shares, blasts, platforms.
// Counts only, no PII. Any signed-in clerk may view (everyone amplifies).
dashboardRouter.get("/social", async (_req, res) => {
  res.json(await socialDashboard());
});

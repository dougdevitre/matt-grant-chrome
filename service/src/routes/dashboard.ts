import { Router } from "express";
import { requireScope } from "../auth.js";
import { gotvDashboard } from "../lib/gotv.js";

export const dashboardRouter = Router();

// GET /dashboard/gotv — turnout progress (counts only, no PII).
dashboardRouter.get("/gotv", requireScope("voter.read"), async (_req, res) => {
  res.json(await gotvDashboard());
});

import { Router } from "express";
import { phaseConfig } from "../phase.js";

// Server-authoritative phase + countdown target. Clients must not trust their
// own clock for gating.
export const phaseRouter = Router();

phaseRouter.get("/", (_req, res) => {
  res.json(phaseConfig());
});

import { Router } from "express";

// Returns the authenticated clerk's identity + derived scopes.
export const meRouter = Router();

meRouter.get("/", (req, res) => {
  res.json(req.clerk);
});

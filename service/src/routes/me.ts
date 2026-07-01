import { Router } from "express";
import { isRole, scopesForRole } from "../rbac.js";

// Returns the authenticated clerk's identity + derived scopes.
//
// Admins may pass `?as=<role>` to PREVIEW another role's view: the response
// carries that role and its server-derived scopes (never trusting the client)
// plus `viewAs: true`. It's cosmetic — the caller's token is unchanged, so this
// can never escalate a non-admin: the param is ignored unless the real role is
// `admin`.
export const meRouter = Router();

meRouter.get("/", (req, res) => {
  const me = req.clerk;
  const as = req.query.as;
  if (me?.role === "admin" && isRole(as)) {
    res.json({ clerkId: me.clerkId, role: as, scopes: scopesForRole(as), viewAs: true });
    return;
  }
  res.json(me);
});

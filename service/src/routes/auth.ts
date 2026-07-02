import { Router } from "express";
import { getConfig } from "../config.js";
import { getVerifier, mintScopedToken, mintStepUpToken } from "../lib/identity.js";
import { rateLimit, clientIp } from "../lib/ratelimit.js";
import { bindPendingVolunteer } from "../lib/team.js";

// Unauthenticated: exchange a Clerk session (or a dev credential) for the
// short-lived scoped JWT used by every other route.
export const authRouter = Router();

// Blunt brute-force: cap token requests per source IP.
authRouter.use(
  rateLimit({ max: 20, windowMs: 60_000, keyOf: clientIp, scope: "auth" })
);

authRouter.post("/token", async (req, res) => {
  let verifier;
  try {
    verifier = await getVerifier();
  } catch {
    res.status(503).json({ error: "auth_unavailable" });
    return;
  }

  const identity = await verifier.verify(req.body);
  if (!identity) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }

  const secret = await getConfig("JWT_SECRET");
  if (!secret) {
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }

  const ttl = Number((await getConfig("TOKEN_TTL_SECONDS")) ?? "3600");
  const token = mintScopedToken(identity, secret, ttl);
  // If this signer was invited onto a team by email, bind their clerkId now that
  // they've authenticated (best-effort; never blocks sign-in).
  await bindPendingVolunteer(identity.email, identity.subject);
  res.json({ token, expiresIn: ttl, role: identity.role });
});

// Step-up for sensitive actions (SMS). Requires re-presenting the credential AND
// the admin role; returns a short-lived token consumed via X-StepUp-Token.
authRouter.post(
  "/step-up",
  rateLimit({ max: 10, windowMs: 60_000, keyOf: clientIp, scope: "stepup" }),
  async (req, res) => {
    let verifier;
    try {
      verifier = await getVerifier();
    } catch {
      res.status(503).json({ error: "auth_unavailable" });
      return;
    }
    const identity = await verifier.verify(req.body);
    if (!identity) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (identity.role !== "admin") {
      res.status(403).json({ error: "step_up_admin_only" });
      return;
    }
    const secret = await getConfig("JWT_SECRET");
    if (!secret) {
      res.status(500).json({ error: "server_misconfigured" });
      return;
    }
    const ttl = Number((await getConfig("STEPUP_TTL_SECONDS")) ?? "300");
    const stepUpToken = mintStepUpToken(identity, secret, ttl);
    res.json({ stepUpToken, expiresIn: ttl });
  }
);

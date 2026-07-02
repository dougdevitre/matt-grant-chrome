// Auth + RBAC middleware. Verifies the clerk JWT, attaches identity, and
// enforces scopes server-side. Client-side gating is cosmetic; this is the
// real boundary.

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getConfig } from "./config.js";
import { currentPhase } from "./phase.js";
import { hasScope, scopesForRole } from "./rbac.js";
import type { ClerkIdentity, Role, Scope } from "./lib/types.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      clerk?: ClerkIdentity;
    }
  }
}

interface ClerkJwtPayload {
  sub: string;
  role: Role;
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing_token" });
    return;
  }
  const token = header.slice("Bearer ".length);
  const secret = await getConfig("JWT_SECRET");
  if (!secret) {
    res.status(500).json({ error: "server_misconfigured" });
    return;
  }
  try {
    // Pin HS256 (the algorithm we mint with) so the verifier can never be
    // tricked into accepting a token signed with a different scheme.
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as ClerkJwtPayload;
    req.clerk = {
      clerkId: payload.sub,
      role: payload.role,
      // Scopes are derived server-side from role — never trusted from the token.
      scopes: scopesForRole(payload.role),
    };
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}

/** Require a specific scope on a route. */
export function requireScope(scope: Scope) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scopes = req.clerk?.scopes ?? [];
    if (!hasScope(scopes, scope)) {
      res.status(403).json({ error: "forbidden", needed: scope });
      return;
    }
    next();
  };
}

/** Require at least one of several scopes (e.g. any comms role may list templates). */
export function requireAnyScope(allowed: Scope[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scopes = req.clerk?.scopes ?? [];
    if (!allowed.some((s) => hasScope(scopes, s))) {
      res.status(403).json({ error: "forbidden", needed: allowed });
      return;
    }
    next();
  };
}

/**
 * Freeze mutating campaign activity once the election closes. The phase table
 * promises PHASE_CLOSED is read-only, but previously only task-claim and comms
 * re-checked phase — event/contact/import writes did not, so a stale client
 * could keep creating events and logging outreach after Aug 4. This is the
 * server-authoritative guard; the UI gate is cosmetic. Returns 409 so a client
 * still showing a write button gets a clear refusal.
 *
 * NOTE: opt-out / suppression writes are deliberately NOT gated with this —
 * honoring a "stop contacting me" must always work, including after close.
 */
export function requirePhaseWritable(req: Request, res: Response, next: NextFunction): void {
  if (currentPhase() === "PHASE_CLOSED") {
    res.status(409).json({ error: "phase_closed" });
    return;
  }
  next();
}

// Auth + RBAC middleware. Verifies the clerk JWT, attaches identity, and
// enforces scopes server-side. Client-side gating is cosmetic; this is the
// real boundary.

import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getConfig } from "./config.js";
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
    const payload = jwt.verify(token, secret) as ClerkJwtPayload;
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

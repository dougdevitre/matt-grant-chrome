// Rate limiting backed by the shared counter port (memory by default, Redis when
// REDIS_URL is set), so per-IP/clerk limits hold across instances. Used to blunt
// brute-force on auth and abuse of SMS sends.

import type { NextFunction, Request, Response } from "express";
import { getCounter } from "./counter.js";

/** Returns true if the action is allowed (and records the hit). */
export async function rateAllow(key: string, max: number, windowMs: number): Promise<boolean> {
  const counter = await getCounter();
  return counter.allowN(key, max, windowMs);
}

/** Express middleware: rate-limit by a key function (IP or clerk id). */
export function rateLimit(opts: {
  max: number;
  windowMs: number;
  keyOf: (req: Request) => string;
  scope: string;
}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = `${opts.scope}:${opts.keyOf(req)}`;
    if (!(await rateAllow(key, opts.max, opts.windowMs))) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}

export function clientIp(req: Request): string {
  // Use Express's req.ip, which honors the app's `trust proxy` setting. With
  // trust proxy off (the default) this is the socket address and X-Forwarded-For
  // is ignored, so a client can't forge it to rotate past the rate limit. Set
  // TRUST_PROXY to the real hop count/subnet behind an ALB/API Gateway.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

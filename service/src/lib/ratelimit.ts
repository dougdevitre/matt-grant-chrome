// Simple in-memory sliding-window rate limiter. Swap for Redis in production
// (multi-instance). Used to blunt brute-force on auth and abuse of SMS sends.

import type { NextFunction, Request, Response } from "express";

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

/** Returns true if the action is allowed (and records the hit). */
export function allow(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const b = buckets.get(key) ?? { hits: [] };
  b.hits = b.hits.filter((t) => now - t < windowMs);
  if (b.hits.length >= max) {
    buckets.set(key, b);
    return false;
  }
  b.hits.push(now);
  buckets.set(key, b);
  return true;
}

/** Express middleware: rate-limit by a key function (IP or clerk id). */
export function rateLimit(opts: {
  max: number;
  windowMs: number;
  keyOf: (req: Request) => string;
  scope: string;
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${opts.scope}:${opts.keyOf(req)}`;
    if (!allow(key, opts.max, opts.windowMs)) {
      res.status(429).json({ error: "rate_limited" });
      return;
    }
    next();
  };
}

export function clientIp(req: Request): string {
  return (
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

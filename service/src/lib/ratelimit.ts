// Simple in-memory sliding-window rate limiter. Swap for Redis in production
// (multi-instance). Used to blunt brute-force on auth and abuse of SMS sends.

import type { NextFunction, Request, Response } from "express";

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// Bound the map so a client churning distinct keys can't grow it without limit;
// when over the cap, evict buckets with no recent activity.
const BUCKET_CAP = 50_000;
const MAX_IDLE_MS = 600_000; // longest window we use

function sweep(now: number): void {
  if (buckets.size <= BUCKET_CAP) return;
  for (const [k, b] of buckets) {
    const last = b.hits[b.hits.length - 1] ?? 0;
    if (now - last > MAX_IDLE_MS) buckets.delete(k);
  }
}

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
  sweep(now);
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
  // Use Express's req.ip, which honors the app's `trust proxy` setting. With
  // trust proxy off (the default) this is the socket address and X-Forwarded-For
  // is ignored, so a client can't forge it to rotate past the rate limit. Set
  // TRUST_PROXY to the real hop count/subnet behind an ALB/API Gateway.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

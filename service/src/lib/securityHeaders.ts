// Baseline security headers for a JSON API. No external dependency (helmet) — a
// handful of static headers is all a token-authenticated API needs. HSTS is set
// only in production (it requires HTTPS, which dev/localhost is not).

import type { NextFunction, Request, Response } from "express";
import { NODE_ENV } from "../config.js";

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-DNS-Prefetch-Control", "off");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

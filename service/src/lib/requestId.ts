// Attach a request id to every request (honoring an inbound X-Request-Id from a
// trusted proxy/gateway, else generating one) and echo it back, so logs and
// clients can correlate a single request across the system.

import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const id = typeof incoming === "string" && incoming.length > 0 && incoming.length <= 200
    ? incoming
    : randomUUID();
  req.id = id;
  res.setHeader("X-Request-Id", id);
  next();
}

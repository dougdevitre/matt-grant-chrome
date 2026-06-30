import type { Request } from "express";

/**
 * Read a route `:param` as a single string.
 *
 * Express 5 (path-to-regexp v8) types `req.params[x]` as `string | string[]`
 * because wildcard/repeated params can be arrays. Our routes only declare
 * single params (`:id`, `:shiftId`), so the value is always a string at
 * runtime; this coerces safely and keeps `tsc` green across express 4 and 5.
 */
export function pathParam(req: Request, name: string): string {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

/**
 * Read a query value as a single string, or `null` when absent or repeated
 * (`?x=a&x=b` yields an array, which we treat as "not a usable single value").
 */
export function queryStr(req: Request, name: string): string | null {
  const v = (req.query as Record<string, unknown>)[name];
  return typeof v === "string" ? v : null;
}

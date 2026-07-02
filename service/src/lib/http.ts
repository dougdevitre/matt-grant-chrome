import type { Request } from "express";

/** Default hard timeout for outbound calls to third-party APIs. */
export const OUTBOUND_TIMEOUT_MS = 8000;

/**
 * `fetch` with a hard timeout via AbortController. Rejects (AbortError) if the
 * upstream doesn't respond within `timeoutMs`; callers keep their own error
 * handling and status mapping. Node's `fetch` has NO default timeout, so a hung
 * upstream (Airtable/Clerk/Twilio/Google) otherwise ties up an Express worker
 * indefinitely — the request never settles. A fast, catchable failure is far
 * better than a silent hang, so every server-to-server call goes through this.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  timeoutMs = OUTBOUND_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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

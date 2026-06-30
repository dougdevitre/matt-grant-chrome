import type { Request } from "express";

// Opt-in limit/offset pagination for list endpoints. To stay backward
// compatible with the extension (which consumes bare JSON arrays), a request
// with neither `limit` nor `offset` returns the full array unchanged; callers
// always set an `X-Total-Count` header so a paginating client can read the
// total separately from the (possibly sliced) body.

export interface PageParams {
  /** null means "no paging requested" → return the full list. */
  limit: number | null;
  offset: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** Parse `?limit=&offset=`. Absent both → {limit:null} (full list). When either
 *  is present, limit defaults to 100 and clamps to [1,500]; offset clamps to ≥0. */
export function parsePageParams(req: Request): PageParams {
  const q = req.query as Record<string, unknown>;
  const rawLimit = q.limit;
  const rawOffset = q.offset;
  const hasLimit = typeof rawLimit === "string";
  const hasOffset = typeof rawOffset === "string";
  if (!hasLimit && !hasOffset) return { limit: null, offset: 0 };

  let limit = DEFAULT_LIMIT;
  if (hasLimit) {
    const n = Number(rawLimit);
    if (Number.isFinite(n)) limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
  }
  let offset = 0;
  if (hasOffset) {
    const n = Number(rawOffset);
    if (Number.isFinite(n)) offset = Math.max(0, Math.floor(n));
  }
  return { limit, offset };
}

/** Slice a list per parsed params. `limit:null` returns the array unchanged. */
export function applyPage<T>(items: T[], params: PageParams): T[] {
  if (params.limit == null) return items;
  return items.slice(params.offset, params.offset + params.limit);
}

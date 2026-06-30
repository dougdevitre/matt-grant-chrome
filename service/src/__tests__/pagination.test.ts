import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { parsePageParams, applyPage } from "../lib/pagination.js";

const req = (query: Record<string, unknown>) => ({ query }) as unknown as Request;

describe("parsePageParams", () => {
  it("returns limit:null (full list) when neither param is present", () => {
    expect(parsePageParams(req({}))).toEqual({ limit: null, offset: 0 });
  });

  it("parses limit and offset", () => {
    expect(parsePageParams(req({ limit: "10", offset: "5" }))).toEqual({
      limit: 10,
      offset: 5,
    });
  });

  it("defaults limit to 100 when only offset is given", () => {
    expect(parsePageParams(req({ offset: "3" }))).toEqual({ limit: 100, offset: 3 });
  });

  it("clamps limit to [1,500] and offset to >=0", () => {
    expect(parsePageParams(req({ limit: "9999" })).limit).toBe(500);
    expect(parsePageParams(req({ limit: "0" })).limit).toBe(1);
    expect(parsePageParams(req({ limit: "10", offset: "-4" })).offset).toBe(0);
  });
});

describe("applyPage", () => {
  const items = [1, 2, 3, 4, 5];

  it("returns the full array when limit is null", () => {
    expect(applyPage(items, { limit: null, offset: 0 })).toEqual(items);
  });

  it("slices by offset + limit", () => {
    expect(applyPage(items, { limit: 2, offset: 1 })).toEqual([2, 3]);
  });

  it("returns an empty slice past the end", () => {
    expect(applyPage(items, { limit: 2, offset: 99 })).toEqual([]);
  });
});

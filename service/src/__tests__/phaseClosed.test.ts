// PHASE_CLOSED is server-authoritative read-only. Two guarantees:
//  1. requirePhaseWritable freezes mutating campaign-activity routes (409).
//  2. The Local tab still renders content after the polls close (a results card
//     + evergreen cards) rather than filtering every card out to a blank tab.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { requirePhaseWritable } from "../auth.js";
import { resolveLocalContext } from "../lib/locationResolver.js";
import type { Scope } from "../lib/types.js";

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe("requirePhaseWritable", () => {
  afterEach(() => vi.useRealTimers());

  it("blocks writes with 409 phase_closed after the election", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00Z"));
    const res = mockRes();
    let nexted = false;
    requirePhaseWritable({} as Request, res as unknown as Response, () => {
      nexted = true;
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: "phase_closed" });
  });

  it("allows writes while the election is open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T12:00:00Z"));
    const res = mockRes();
    let nexted = false;
    requirePhaseWritable({} as Request, res as unknown as Response, () => {
      nexted = true;
    });
    expect(nexted).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});

describe("resolveLocalContext in PHASE_CLOSED", () => {
  it("still returns cards (results + evergreen), not a blank tab", async () => {
    const closed = new Date("2026-08-10T12:00:00Z");
    const res = await resolveLocalContext(
      { county: "Franklin County", schoolDistrict: "Union R-XI", zip: "63084", address: undefined },
      ["voter.read"] as Scope[],
      closed
    );
    expect(res.phase).toBe("PHASE_CLOSED");
    expect(res.cards.length).toBeGreaterThan(0);
    expect(res.cards.some((c) => c.id === "vote.results")).toBe(true);
  });
});

// clientIp must not trust a raw X-Forwarded-For header (forgeable to rotate past
// the caps); it relies on Express's req.ip. rateAllow is backed by the shared
// counter (memory by default).

import { beforeEach, describe, expect, it } from "vitest";
import { clientIp, rateAllow } from "../lib/ratelimit.js";
import { resetCounterForTests } from "../lib/counter.js";
import type { Request } from "express";

function fakeReq(opts: { ip?: string; remote?: string; xff?: string }): Request {
  return {
    ip: opts.ip,
    socket: { remoteAddress: opts.remote },
    headers: opts.xff ? { "x-forwarded-for": opts.xff } : {},
  } as unknown as Request;
}

beforeEach(() => resetCounterForTests());

describe("clientIp", () => {
  it("ignores X-Forwarded-For and uses the socket address when req.ip is unset", () => {
    expect(clientIp(fakeReq({ remote: "10.0.0.5", xff: "1.2.3.4" }))).toBe("10.0.0.5");
  });

  it("uses req.ip when Express has resolved it (trust proxy configured)", () => {
    expect(clientIp(fakeReq({ ip: "203.0.113.9", remote: "10.0.0.5", xff: "1.2.3.4" }))).toBe(
      "203.0.113.9"
    );
  });
});

describe("rateAllow", () => {
  it("permits up to max in the window, then blocks", async () => {
    const key = "auth:1.2.3.4";
    expect(await rateAllow(key, 2, 60_000)).toBe(true);
    expect(await rateAllow(key, 2, 60_000)).toBe(true);
    expect(await rateAllow(key, 2, 60_000)).toBe(false);
  });
});

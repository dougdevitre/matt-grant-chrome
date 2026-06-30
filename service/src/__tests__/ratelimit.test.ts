// Rate-limit IP resolution must not trust a raw X-Forwarded-For header (a client
// could forge it to rotate past the per-IP caps); it relies on Express's req.ip.

import { describe, expect, it } from "vitest";
import { allow, clientIp } from "../lib/ratelimit.js";
import type { Request } from "express";

function fakeReq(opts: { ip?: string; remote?: string; xff?: string }): Request {
  return {
    ip: opts.ip,
    socket: { remoteAddress: opts.remote },
    headers: opts.xff ? { "x-forwarded-for": opts.xff } : {},
  } as unknown as Request;
}

describe("clientIp", () => {
  it("ignores X-Forwarded-For and uses the socket address when req.ip is unset", () => {
    // req.ip is undefined when trust proxy is off; XFF must not be trusted.
    expect(clientIp(fakeReq({ remote: "10.0.0.5", xff: "1.2.3.4" }))).toBe("10.0.0.5");
  });

  it("uses req.ip when Express has resolved it (trust proxy configured)", () => {
    expect(clientIp(fakeReq({ ip: "203.0.113.9", remote: "10.0.0.5", xff: "1.2.3.4" }))).toBe(
      "203.0.113.9"
    );
  });
});

describe("allow", () => {
  it("permits up to max within the window, then blocks", () => {
    const key = `test:${Math.random()}`;
    const now = 1_000_000;
    expect(allow(key, 2, 1000, now)).toBe(true);
    expect(allow(key, 2, 1000, now)).toBe(true);
    expect(allow(key, 2, 1000, now)).toBe(false); // cap reached
    // Window elapsed → allowed again.
    expect(allow(key, 2, 1000, now + 2000)).toBe(true);
  });
});

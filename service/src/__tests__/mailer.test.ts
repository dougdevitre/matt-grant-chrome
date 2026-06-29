// Gmail adapter: builds an RFC 2822 message (with From), base64url-encodes it,
// posts with a fetched access token, and surfaces API errors. Fetch is stubbed;
// the token provider is injected.

import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailAdapter } from "../lib/mailer.js";

afterEach(() => vi.unstubAllGlobals());

function decodeRaw(b64url: string): string {
  return Buffer.from(b64url.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

describe("GmailAdapter", () => {
  it("includes From/To/Subject and posts base64url with the access token", async () => {
    let auth: string | undefined;
    let body: { raw: string } = { raw: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { headers: Record<string, string>; body: string }) => {
        auth = init.headers.Authorization;
        body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ id: "msg1" }), text: async () => "" };
      })
    );

    const adapter = new GmailAdapter(async () => "at-token", "Campaign <noreply@grant.org>");
    const r = await adapter.send({ to: "voter@example.com", subject: "Register today", body: "Hi" });

    expect(r).toEqual({ ok: true, providerId: "msg1" });
    expect(auth).toBe("Bearer at-token");
    const raw = decodeRaw(body.raw);
    expect(raw).toContain("From: Campaign <noreply@grant.org>");
    expect(raw).toContain("To: voter@example.com");
    expect(raw).toContain("Subject: Register today");
  });

  it("omits the From header when none is configured", async () => {
    let body: { raw: string } = { raw: "" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: string, init: { body: string }) => {
        body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ id: "m" }), text: async () => "" };
      })
    );
    const adapter = new GmailAdapter(async () => "t");
    await adapter.send({ to: "x@example.com", subject: null, body: "b" });
    expect(decodeRaw(body.raw)).not.toContain("From:");
  });

  it("surfaces the API error body", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => '{"error":"bad_request"}',
    }));
    const adapter = new GmailAdapter(async () => "t", "a@b.co");
    const r = await adapter.send({ to: "x@example.com", subject: "s", body: "b" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/gmail_400.*bad_request/);
  });
});

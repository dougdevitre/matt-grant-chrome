// Google Calendar adapter: posts an event using a fetched access token, emails
// the invite when an attendee is resolvable, and surfaces API errors. Fetch is
// stubbed; the token provider is injected.

import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleCalendarAdapter } from "../lib/calendar.js";

afterEach(() => vi.unstubAllGlobals());

const INVITE = {
  summary: "Florissant Registration Drive",
  startsAt: "2026-07-02T10:00:00-05:00",
  endsAt: "2026-07-02T12:00:00-05:00",
  location: "Florissant Valley Library",
};

describe("GoogleCalendarAdapter", () => {
  it("posts attendees + sendUpdates=all with the access token", async () => {
    let url = "";
    let auth: string | undefined;
    let body: { attendees?: { email: string }[] } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init: { headers: Record<string, string>; body: string }) => {
        url = u;
        auth = init.headers.Authorization;
        body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ id: "evt1" }), text: async () => "" };
      })
    );

    const adapter = new GoogleCalendarAdapter(async () => "at-token", "primary");
    const r = await adapter.createInvite({ ...INVITE, attendeeEmail: "clerk@grant.org" });

    expect(r).toEqual({ ok: true, id: "evt1" });
    expect(url).toContain("/calendars/primary/events?sendUpdates=all");
    expect(auth).toBe("Bearer at-token");
    expect(body.attendees).toEqual([{ email: "clerk@grant.org" }]);
  });

  it("omits attendees when the key is not an email", async () => {
    let url = "";
    let body: { attendees?: unknown } = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string, init: { body: string }) => {
        url = u;
        body = JSON.parse(init.body);
        return { ok: true, status: 200, json: async () => ({ id: "e" }), text: async () => "" };
      })
    );
    const adapter = new GoogleCalendarAdapter(async () => "t", "primary");
    await adapter.createInvite({ ...INVITE, attendeeKey: "clerk-123" });
    expect(url).not.toContain("sendUpdates");
    expect(body.attendees).toBeUndefined();
  });

  it("surfaces the API error body", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => '{"error":"forbidden"}',
    }));
    const adapter = new GoogleCalendarAdapter(async () => "t", "primary");
    const r = await adapter.createInvite(INVITE);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/calendar_403.*forbidden/);
  });
});

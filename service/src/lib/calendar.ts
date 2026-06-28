// Calendar integration (Phase 2). Port + two adapters. Default no-op records to
// the audit log so the loop is observable without credentials. Set
// CALENDAR_DRIVER=google (with GOOGLE_CALENDAR_TOKEN + GOOGLE_CALENDAR_ID in
// SSM/env) to push real invites/reminders.

import { getConfig } from "../config.js";

export interface CalendarInvite {
  summary: string;
  description?: string;
  startsAt: string; // ISO8601
  endsAt: string; // ISO8601
  attendeeKey?: string; // opaque clerk id; resolve to email server-side if needed
  location?: string | null;
}

export interface CalendarPort {
  createInvite(invite: CalendarInvite): Promise<{ ok: boolean; id?: string }>;
}

class NoopCalendar implements CalendarPort {
  async createInvite(invite: CalendarInvite): Promise<{ ok: boolean }> {
    // Visible in logs so the integration point is observable in dev.
    console.log("[calendar:noop] would invite:", invite.summary, invite.startsAt);
    return { ok: true };
  }
}

class GoogleCalendarAdapter implements CalendarPort {
  constructor(
    private token: string,
    private calendarId: string
  ) {}

  async createInvite(
    invite: CalendarInvite
  ): Promise<{ ok: boolean; id?: string }> {
    // TODO: production should use a service account / OAuth, not a personal token.
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      this.calendarId
    )}/events`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: invite.summary,
        description: invite.description,
        location: invite.location ?? undefined,
        start: { dateTime: invite.startsAt },
        end: { dateTime: invite.endsAt },
      }),
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  }
}

let singleton: CalendarPort | null = null;

export async function getCalendar(): Promise<CalendarPort> {
  if (singleton) return singleton;
  const driver = process.env.CALENDAR_DRIVER ?? "noop";
  if (driver === "google") {
    const token = await getConfig("GOOGLE_CALENDAR_TOKEN");
    const calendarId = (await getConfig("GOOGLE_CALENDAR_ID")) ?? "primary";
    if (token) {
      singleton = new GoogleCalendarAdapter(token, calendarId);
      return singleton;
    }
    console.warn("[calendar] google driver selected but no token; using noop");
  }
  singleton = new NoopCalendar();
  return singleton;
}

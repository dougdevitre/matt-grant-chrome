// Calendar integration (Phase 2). Port + two adapters. Default no-op records to
// the audit log so the loop is observable without credentials. Set
// CALENDAR_DRIVER=google to push real invites; auth is a Google service account
// (see googleAuth.ts), with a legacy GOOGLE_CALENDAR_TOKEN bearer as fallback.

import { getConfig } from "../config.js";
import { fetchWithTimeout } from "./http.js";
import {
  hasServiceAccount,
  makeGoogleTokenProvider,
  type GoogleTokenProvider,
} from "./googleAuth.js";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

export interface CalendarInvite {
  summary: string;
  description?: string;
  startsAt: string; // ISO8601
  endsAt: string; // ISO8601
  attendeeKey?: string; // opaque clerk id; resolve to email server-side if needed
  attendeeEmail?: string; // explicit attendee address (preferred over attendeeKey)
  location?: string | null;
}

export interface CalendarPort {
  createInvite(invite: CalendarInvite): Promise<{ ok: boolean; id?: string; error?: string }>;
}

function asEmail(value?: string): string | undefined {
  return value && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : undefined;
}

class NoopCalendar implements CalendarPort {
  async createInvite(invite: CalendarInvite): Promise<{ ok: boolean }> {
    // Visible in logs so the integration point is observable in dev.
    console.log("[calendar:noop] would invite:", invite.summary, invite.startsAt);
    return { ok: true };
  }
}

export class GoogleCalendarAdapter implements CalendarPort {
  constructor(
    private token: GoogleTokenProvider,
    private calendarId: string
  ) {}

  async createInvite(
    invite: CalendarInvite
  ): Promise<{ ok: boolean; id?: string; error?: string }> {
    // Prefer an explicit attendee email; otherwise use attendeeKey if it is one.
    const attendeeEmail = asEmail(invite.attendeeEmail) ?? asEmail(invite.attendeeKey);
    // sendUpdates=all makes Google email the invite so the clerk is notified.
    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(this.calendarId)}/events` +
      (attendeeEmail ? "?sendUpdates=all" : "");

    let accessToken: string;
    try {
      accessToken = await this.token();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "token_error" };
    }

    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: invite.summary,
        description: invite.description,
        location: invite.location ?? undefined,
        start: { dateTime: invite.startsAt },
        end: { dateTime: invite.endsAt },
        ...(attendeeEmail ? { attendees: [{ email: attendeeEmail }] } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `calendar_${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, id: json.id };
  }
}

let singleton: CalendarPort | null = null;

export async function getCalendar(): Promise<CalendarPort> {
  if (singleton) return singleton;
  const driver = process.env.CALENDAR_DRIVER ?? "noop";
  if (driver === "google") {
    const calendarId = (await getConfig("GOOGLE_CALENDAR_ID")) ?? "primary";
    if (await hasServiceAccount()) {
      const subject = await getConfig("GOOGLE_CALENDAR_SUBJECT");
      singleton = new GoogleCalendarAdapter(
        makeGoogleTokenProvider([CALENDAR_SCOPE], subject ?? undefined),
        calendarId
      );
      return singleton;
    }
    // Back-compat: a legacy static bearer token still works (no refresh).
    const legacy = await getConfig("GOOGLE_CALENDAR_TOKEN");
    if (legacy) {
      singleton = new GoogleCalendarAdapter(async () => legacy, calendarId);
      return singleton;
    }
    console.warn("[calendar] google driver selected but no SA/token; using noop");
  }
  singleton = new NoopCalendar();
  return singleton;
}

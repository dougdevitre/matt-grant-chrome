// Mailer integration (Phase 3). Port + two adapters. Default no-op "sends"
// succeed without touching a provider (so the outbox + gating logic is testable
// offline). Set MAILER_DRIVER=gmail for real sends; auth is a Google service
// account (see googleAuth.ts), with a legacy GMAIL_TOKEN bearer as fallback.

import { getConfig } from "../config.js";
import { fetchWithTimeout } from "./http.js";
import {
  hasServiceAccount,
  makeGoogleTokenProvider,
  type GoogleTokenProvider,
} from "./googleAuth.js";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export interface OutboundMessage {
  to: string; // raw recipient address — never persisted; only the contactKey is
  subject: string | null;
  body: string;
}

export interface MailerPort {
  send(msg: OutboundMessage): Promise<{ ok: boolean; providerId?: string; error?: string }>;
}

class NoopMailer implements MailerPort {
  async send(msg: OutboundMessage): Promise<{ ok: boolean; providerId: string }> {
    console.log("[mailer:noop] would send:", msg.subject ?? "(no subject)");
    return { ok: true, providerId: `noop-${Date.now()}` };
  }
}

export class GmailAdapter implements MailerPort {
  constructor(
    private token: GoogleTokenProvider,
    private from?: string
  ) {}

  async send(
    msg: OutboundMessage
  ): Promise<{ ok: boolean; providerId?: string; error?: string }> {
    const headers = [
      ...(this.from ? [`From: ${this.from}`] : []),
      `To: ${msg.to}`,
      `Subject: ${msg.subject ?? ""}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      msg.body,
    ];
    const encoded = Buffer.from(headers.join("\r\n"))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    let accessToken: string;
    try {
      accessToken = await this.token();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "token_error" };
    }

    const res = await fetchWithTimeout(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encoded }),
      }
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `gmail_${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}` };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, providerId: json.id };
  }
}

let singleton: MailerPort | null = null;

export async function getMailer(): Promise<MailerPort> {
  if (singleton) return singleton;
  const driver = process.env.MAILER_DRIVER ?? "noop";
  if (driver === "gmail") {
    const from = (await getConfig("GMAIL_FROM")) ?? (await getConfig("GMAIL_SUBJECT")) ?? undefined;
    if (await hasServiceAccount()) {
      const subject = await getConfig("GMAIL_SUBJECT");
      singleton = new GmailAdapter(
        makeGoogleTokenProvider([GMAIL_SCOPE], subject ?? undefined),
        from
      );
      return singleton;
    }
    // Back-compat: a legacy static bearer token still works (no refresh).
    const legacy = await getConfig("GMAIL_TOKEN");
    if (legacy) {
      singleton = new GmailAdapter(async () => legacy, from);
      return singleton;
    }
    console.warn("[mailer] gmail driver selected but no SA/token; using noop");
  }
  singleton = new NoopMailer();
  return singleton;
}

// Mailer integration (Phase 3). Port + two adapters. Default no-op "sends"
// succeed without touching a provider (so the outbox + gating logic is testable
// offline). Set MAILER_DRIVER=gmail (with GMAIL_TOKEN in SSM/env) for real sends.

import { getConfig } from "../config.js";

export interface OutboundMessage {
  to: string; // raw recipient address — never persisted; only the contactKey is
  subject: string | null;
  body: string;
}

export interface MailerPort {
  send(msg: OutboundMessage): Promise<{ ok: boolean; providerId?: string }>;
}

class NoopMailer implements MailerPort {
  async send(msg: OutboundMessage): Promise<{ ok: boolean; providerId: string }> {
    console.log("[mailer:noop] would send:", msg.subject ?? "(no subject)");
    return { ok: true, providerId: `noop-${Date.now()}` };
  }
}

class GmailAdapter implements MailerPort {
  constructor(private token: string) {}
  async send(
    msg: OutboundMessage
  ): Promise<{ ok: boolean; providerId?: string }> {
    // TODO: production should use a service account / OAuth, not a personal token.
    const raw = [
      `To: ${msg.to}`,
      `Subject: ${msg.subject ?? ""}`,
      "Content-Type: text/plain; charset=UTF-8",
      "",
      msg.body,
    ].join("\r\n");
    const encoded = Buffer.from(raw)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const res = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encoded }),
      }
    );
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { id?: string };
    return { ok: true, providerId: json.id };
  }
}

let singleton: MailerPort | null = null;

export async function getMailer(): Promise<MailerPort> {
  if (singleton) return singleton;
  const driver = process.env.MAILER_DRIVER ?? "noop";
  if (driver === "gmail") {
    const token = await getConfig("GMAIL_TOKEN");
    if (token) {
      singleton = new GmailAdapter(token);
      return singleton;
    }
    console.warn("[mailer] gmail driver selected but no token; using noop");
  }
  singleton = new NoopMailer();
  return singleton;
}

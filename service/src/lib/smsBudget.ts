// SMS operational safeguards: a global kill switch and a daily send cap so a
// bug or abuse can't drain the Twilio balance. Counts reset per calendar day.

let day = "";
let count = 0;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function smsEnabled(): boolean {
  // Default ON; set SMS_ENABLED=false to hard-disable all SMS instantly.
  return (process.env.SMS_ENABLED ?? "true").toLowerCase() !== "false";
}

function dailyCap(): number {
  const n = Number(process.env.SMS_DAILY_CAP ?? "250");
  return Number.isFinite(n) && n > 0 ? n : 250;
}

/** Check whether another SMS may be sent right now. */
export function canSendSms(): { ok: boolean; reason?: "sms_disabled" | "sms_cap_reached" } {
  if (!smsEnabled()) return { ok: false, reason: "sms_disabled" };
  if (today() !== day) {
    day = today();
    count = 0;
  }
  if (count >= dailyCap()) return { ok: false, reason: "sms_cap_reached" };
  return { ok: true };
}

/** Record a successful send against the daily cap. */
export function recordSmsSent(): void {
  if (today() !== day) {
    day = today();
    count = 0;
  }
  count++;
}

export function smsBudgetStatus(): { day: string; sent: number; cap: number; enabled: boolean } {
  if (today() !== day) {
    day = today();
    count = 0;
  }
  return { day, sent: count, cap: dailyCap(), enabled: smsEnabled() };
}

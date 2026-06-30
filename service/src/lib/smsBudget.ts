// SMS operational safeguards: a global kill switch and a daily send cap so a bug
// or abuse can't drain the Twilio balance. The cap is backed by the shared
// counter (memory by default, Redis when REDIS_URL is set) so it holds across
// instances — otherwise N instances would each allow up to the cap.

import { getCounter } from "./counter.js";

const SMS_COUNTER_KEY = "sms";

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
export async function canSendSms(): Promise<{
  ok: boolean;
  reason?: "sms_disabled" | "sms_cap_reached";
}> {
  if (!smsEnabled()) return { ok: false, reason: "sms_disabled" };
  const counter = await getCounter();
  const sent = await counter.dailyCount(SMS_COUNTER_KEY, today());
  if (sent >= dailyCap()) return { ok: false, reason: "sms_cap_reached" };
  return { ok: true };
}

/** Record a successful send against the daily cap. */
export async function recordSmsSent(): Promise<void> {
  const counter = await getCounter();
  await counter.dailyIncr(SMS_COUNTER_KEY, today());
}

export async function smsBudgetStatus(): Promise<{
  day: string;
  sent: number;
  cap: number;
  enabled: boolean;
}> {
  const counter = await getCounter();
  const day = today();
  return {
    day,
    sent: await counter.dailyCount(SMS_COUNTER_KEY, day),
    cap: dailyCap(),
    enabled: smsEnabled(),
  };
}

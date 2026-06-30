// TCPA quiet-hours enforcement for SMS. The TCPA bars telemarketing texts/calls
// before 8am or after 9pm in the *recipient's* local time. We enforce a
// configurable window (default 08:00–21:00) in a configurable timezone
// (default America/Chicago — all of MO-02 is Central). Recipient-local time is
// inferred from the contact's zip where possible; absent a contact we fall back
// to the campaign timezone.
//
// No date library is used: Node's built-in Intl resolves IANA timezones.

import type { Contact } from "./types.js";

export interface QuietHoursConfig {
  enabled: boolean;
  startHour: number; // inclusive lower bound of the *allowed* window [0, 24)
  endHour: number; // exclusive upper bound of the *allowed* window (0, 24]
  tz: string; // default IANA timezone
}

function intInRange(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi) return fallback;
  return n;
}

/** Read quiet-hours config from env. Enforcement is ON by default (compliance
 *  first); set SMS_QUIET_ENABLED=false to disable. */
export function quietHoursConfig(): QuietHoursConfig {
  return {
    enabled: (process.env.SMS_QUIET_ENABLED ?? "true").toLowerCase() !== "false",
    startHour: intInRange(process.env.SMS_QUIET_START, 8, 0, 23),
    endHour: intInRange(process.env.SMS_QUIET_END, 21, 1, 24),
    tz: process.env.SMS_QUIET_TZ || "America/Chicago",
  };
}

// US zip prefixes that are NOT Central time. MO-02 is entirely Central, so this
// is a best-effort refinement for stray out-of-district numbers only — anything
// not matched here uses the configured default tz. Kept deliberately small and
// honest rather than shipping a bad full zip→tz guess.
const ZIP_PREFIX_TZ: Array<{ test: (zip3: number) => boolean; tz: string }> = [
  // Eastern (very roughly 005–349 + 374-ish); we only list clearly-Eastern bands.
  { test: (z) => z >= 0 && z <= 299, tz: "America/New_York" },
  // Mountain (Denver/Salt Lake/Phoenix bands ~800–864). Phoenix doesn't observe
  // DST, but Intl handles that for the IANA zone we pick (we use Denver here as a
  // conservative DST-observing default).
  { test: (z) => z >= 800 && z <= 880, tz: "America/Denver" },
  // Pacific (~889–961).
  { test: (z) => z >= 889 && z <= 961, tz: "America/Los_Angeles" },
  // Alaska / Hawaii.
  { test: (z) => z >= 995 && z <= 999, tz: "America/Anchorage" },
  { test: (z) => z >= 967 && z <= 968, tz: "Pacific/Honolulu" },
];

/** Best-effort recipient timezone from a contact's zip; falls back to the
 *  configured default. */
export function tzForContact(contact: Contact | undefined, fallbackTz: string): string {
  const zip = contact?.zip;
  if (zip && /^\d{5}/.test(zip)) {
    const zip3 = Number(zip.slice(0, 3));
    for (const band of ZIP_PREFIX_TZ) if (band.test(zip3)) return band.tz;
  }
  return fallbackTz;
}

/** The local clock hour (0–23) for `now` in the given IANA timezone. */
export function hourInTz(now: Date, tz: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    hour12: false,
  });
  // "24" can appear for midnight in some environments; normalize to 0.
  const h = Number(fmt.format(now));
  return Number.isFinite(h) ? h % 24 : 0;
}

/** True when `now` (in tz) is OUTSIDE the allowed [startHour, endHour) window. */
export function isQuietHours(
  now: Date,
  tz: string,
  startHour: number,
  endHour: number
): boolean {
  const h = hourInTz(now, tz);
  return h < startHour || h >= endHour;
}

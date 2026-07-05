// Config loader. Local dev reads process.env; deployed envs prefer AWS SSM
// SecureString. Never hardcode secrets. Least-privilege IAM: grant the runtime
// role read-only ssm:GetParameter on the SSM_PREFIX path only.

import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

const ssm = new SSMClient({});

const cache = new Map<string, string>();

async function fromSsm(name: string): Promise<string | undefined> {
  const prefix = process.env.SSM_PREFIX;
  if (!prefix) return undefined;
  const key = `${prefix}/${name}`;
  if (cache.has(key)) return cache.get(key);
  try {
    const out = await ssm.send(
      new GetParameterCommand({ Name: key, WithDecryption: true })
    );
    const value = out.Parameter?.Value;
    if (value) cache.set(key, value);
    return value;
  } catch {
    // In local dev (no AWS creds) this is expected; fall back to env.
    return undefined;
  }
}

/** Resolve a secret/config value: SSM SecureString first, then env var. */
export async function getConfig(
  name: string,
  fallback?: string
): Promise<string | undefined> {
  return (await fromSsm(name)) ?? process.env[name] ?? fallback;
}

export const PORT = Number(process.env.PORT ?? 8787);
export const NODE_ENV = process.env.NODE_ENV ?? "development";
export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

// FEC-required disclaimer: the exact registered name of the authorized principal
// campaign committee. Every outbound template's "Paid for by …" line is validated
// to contain this, not just the bare phrase. Override with COMMITTEE_NAME if the
// registered name differs (e.g. "Friends of Matt Grant"). VERIFY against the FEC
// registration before launch — a wrong name here is a compliance defect.
export const COMMITTEE_NAME = process.env.COMMITTEE_NAME ?? "Matt Grant for Congress";

// WinRed contribute page used as the donate link on shareable "donate" posts.
// NOT a payment integration or secret — just an outbound URL volunteers share to
// their own channels. VERIFY the real committee WinRed slug before launch; a
// wrong link routes donations to the wrong place. Override with DONATE_URL.
export const DONATE_URL =
  process.env.DONATE_URL ?? "https://secure.winred.com/matt-grant-for-congress/donate-today";

/**
 * Whether to enforce the hardened production behavior (boot gate, no dev auth,
 * HSTS, …). We fail SAFE: the relaxed local mode is *opt-in* via an explicit
 * NODE_ENV of "development" or "test" (the vitest suite). ANY other value —
 * "production", "staging", a typo, or an UNSET NODE_ENV on a real deploy — is
 * treated as production-like. Previously every gate hinged on
 * `NODE_ENV === "production"`, so forgetting to set it on App Runner silently
 * disabled all of them and the default dev secret could mint an admin token.
 */
const RELAXED_ENVS = new Set(["development", "test"]);
export const IS_PRODUCTION_LIKE = !RELAXED_ENVS.has(process.env.NODE_ENV ?? "");

/**
 * Production safety gate. Returns a list of fatal misconfigurations; the server
 * refuses to boot if any are present. In relaxed local mode it returns [] (dev
 * conveniences allowed) but callers may still log warnings.
 */
export async function assertSecureStartup(): Promise<string[]> {
  if (!IS_PRODUCTION_LIKE) return [];
  const problems: string[] = [];

  const jwt = await getConfig("JWT_SECRET");
  if (!jwt || jwt === "dev-only-change-me") {
    problems.push("JWT_SECRET is missing or the default value");
  }
  if ((process.env.AUTH_DRIVER ?? "dev") !== "clerk") {
    problems.push("AUTH_DRIVER must be 'clerk' in production (dev auth is forbidden)");
  }
  if (ALLOWED_ORIGIN === "*") {
    problems.push("ALLOWED_ORIGIN must be pinned (not '*') in production");
  }
  if ((process.env.SMS_DRIVER ?? "noop") === "twilio") {
    for (const k of [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_MESSAGING_SERVICE_SID",
      "TWILIO_WEBHOOK_URL",
    ]) {
      if (!(await getConfig(k))) problems.push(`SMS_DRIVER=twilio but ${k} is missing`);
    }
    // TCPA quiet hours: a typo that silently disables the window is a compliance
    // risk, so when SMS is live and enforcement is on the bounds must parse and
    // be ordered (0 <= start < end <= 24).
    if ((process.env.SMS_QUIET_ENABLED ?? "true").toLowerCase() !== "false") {
      const start = Number(process.env.SMS_QUIET_START ?? "8");
      const end = Number(process.env.SMS_QUIET_END ?? "21");
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end > 24 ||
        start >= end
      ) {
        problems.push("SMS_QUIET_START/SMS_QUIET_END must be integers with 0 <= start < end <= 24");
      }
    }
  }
  if ((process.env.STORE_DRIVER ?? "memory") === "airtable") {
    if (!(await getConfig("AIRTABLE_PAT"))) {
      problems.push("STORE_DRIVER=airtable but AIRTABLE_PAT is missing");
    }
    // Contact opt-out/outbox keys are derived from phone/email. Without a salt
    // they are a bare SHA-256 (tiny keyspace, offline-reversible), so a leaked
    // Airtable table would expose real voter PII. Require the keyed-HMAC salt
    // once contacts persist to an external store. (lib/keys.ts consumes it.)
    if (!(await getConfig("CONTACT_KEY_SALT"))) {
      problems.push(
        "STORE_DRIVER=airtable but CONTACT_KEY_SALT is missing (contact keys would be offline-reversible to PII)"
      );
    }
  }
  // Google providers need either a service account or a legacy bearer token.
  // (Checked inline rather than importing googleAuth to avoid an import cycle.)
  const hasGoogleSa =
    !!(await getConfig("GOOGLE_SA_JSON")) ||
    (!!(await getConfig("GOOGLE_SA_CLIENT_EMAIL")) && !!(await getConfig("GOOGLE_SA_PRIVATE_KEY")));
  if ((process.env.CALENDAR_DRIVER ?? "noop") === "google") {
    if (!hasGoogleSa && !(await getConfig("GOOGLE_CALENDAR_TOKEN"))) {
      problems.push(
        "CALENDAR_DRIVER=google but no service account (GOOGLE_SA_*) or GOOGLE_CALENDAR_TOKEN"
      );
    }
  }
  if ((process.env.MAILER_DRIVER ?? "noop") === "gmail") {
    if (!hasGoogleSa && !(await getConfig("GMAIL_TOKEN"))) {
      problems.push("MAILER_DRIVER=gmail but no service account (GOOGLE_SA_*) or GMAIL_TOKEN");
    }
  }
  // Multi-instance deploys must share the rate-limit/SMS-cap counters, else the
  // SMS daily cap multiplies per instance. Opt in to enforce a shared backend.
  if (process.env.REQUIRE_SHARED_STATE === "true" && !(await getConfig("REDIS_URL"))) {
    problems.push("REQUIRE_SHARED_STATE=true but REDIS_URL is missing (counters would be per-instance)");
  }
  return problems;
}

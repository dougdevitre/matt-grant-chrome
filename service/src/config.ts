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

/**
 * Production safety gate. Returns a list of fatal misconfigurations; the server
 * refuses to boot if any are present. In non-production it returns [] (dev
 * conveniences allowed) but callers may still log warnings.
 */
export async function assertSecureStartup(): Promise<string[]> {
  if (NODE_ENV !== "production") return [];
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

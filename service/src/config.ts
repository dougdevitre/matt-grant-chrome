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
  }
  return problems;
}

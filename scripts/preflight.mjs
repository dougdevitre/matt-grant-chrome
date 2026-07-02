#!/usr/bin/env node
// Pre-deploy config check + live readiness probe for the clerk-tool service.
//
// Two independent modes (run either or both):
//
//   1. Config check (default) — evaluates the SAME production safety gate the
//      service enforces at boot (service/src/config.ts `assertSecureStartup`),
//      but as a FRIENDLY pre-check you can run before you deploy. It reads the
//      driver selections + secrets from the environment, so run it with the
//      exact env you're about to hand App Runner:
//
//        NODE_ENV=production AUTH_DRIVER=clerk STORE_DRIVER=airtable \
//          ALLOWED_ORIGIN=chrome-extension://<id> JWT_SECRET=... AIRTABLE_PAT=... \
//          node scripts/preflight.mjs
//
//      The service refuses to boot on any of these problems — catching them here
//      turns a failed deploy into a 2-second local check.
//
//   2. Live probe — hits a deployed service's /health and /ready endpoints:
//
//        node scripts/preflight.mjs --url https://<app-runner-domain>
//
//      /health 200 = process up; /ready 200 = the configured store constructed
//      (503 = bad/missing Airtable PAT, wrong base id, or PAT lacks base access).
//
// Exit code is non-zero if any check fails, so this is CI/shell friendly.
//
// NOTE: keep the checks below in sync with service/src/config.ts
// `assertSecureStartup`. This script deliberately re-implements them (rather
// than importing the built service) so it runs dependency-free against raw env,
// including before `npm run build:service`.

const args = process.argv.slice(2);
const urlArg = (() => {
  const i = args.indexOf("--url");
  return i >= 0 ? args[i + 1] : undefined;
})();
const skipConfig = args.includes("--no-config");

let failures = 0;
const problems = [];

function ok(msg) {
  console.log(`  ✓ ${msg}`);
}
function bad(msg) {
  console.log(`  ✗ ${msg}`);
  problems.push(msg);
  failures++;
}
function note(msg) {
  console.log(`  · ${msg}`);
}

// --- Mode 1: config gate (mirrors assertSecureStartup) ----------------------

function checkConfig() {
  const env = process.env;
  const nodeEnv = env.NODE_ENV ?? "development";
  console.log(`\nConfig gate (NODE_ENV=${nodeEnv})`);

  if (nodeEnv !== "production") {
    note(
      "NODE_ENV is not 'production' — the boot gate is a no-op in dev. Re-run with " +
        "NODE_ENV=production (plus the drivers/secrets you'll deploy) to exercise it."
    );
    return;
  }

  const jwt = env.JWT_SECRET;
  if (!jwt || jwt === "dev-only-change-me") bad("JWT_SECRET is missing or the default value");
  else ok("JWT_SECRET is set");

  const authDriver = env.AUTH_DRIVER ?? "dev";
  if (authDriver !== "clerk") bad("AUTH_DRIVER must be 'clerk' in production (dev auth is forbidden)");
  else ok("AUTH_DRIVER=clerk");

  const origin = env.ALLOWED_ORIGIN ?? "*";
  if (origin === "*") bad("ALLOWED_ORIGIN must be pinned (not '*') in production");
  else ok(`ALLOWED_ORIGIN pinned (${origin})`);

  const smsDriver = env.SMS_DRIVER ?? "noop";
  if (smsDriver === "twilio") {
    for (const k of [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_MESSAGING_SERVICE_SID",
      "TWILIO_WEBHOOK_URL",
    ]) {
      if (!env[k]) bad(`SMS_DRIVER=twilio but ${k} is missing`);
      else ok(`${k} is set`);
    }
    if ((env.SMS_QUIET_ENABLED ?? "true").toLowerCase() !== "false") {
      const start = Number(env.SMS_QUIET_START ?? "8");
      const end = Number(env.SMS_QUIET_END ?? "21");
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start < 0 ||
        end > 24 ||
        start >= end
      ) {
        bad("SMS_QUIET_START/SMS_QUIET_END must be integers with 0 <= start < end <= 24");
      } else {
        ok(`TCPA quiet hours ${start}:00–${end}:00`);
      }
    }
  } else {
    note(`SMS_DRIVER=${smsDriver} (Twilio checks skipped)`);
  }

  const storeDriver = env.STORE_DRIVER ?? "memory";
  if (storeDriver === "airtable") {
    if (!env.AIRTABLE_PAT) bad("STORE_DRIVER=airtable but AIRTABLE_PAT is missing");
    else ok("AIRTABLE_PAT is set");
    // The boot gate now requires a contact-key salt when contacts persist to an
    // external store (else opt-out/outbox keys are offline-reversible to PII).
    if (!env.CONTACT_KEY_SALT)
      bad("STORE_DRIVER=airtable but CONTACT_KEY_SALT is missing (contact keys would be reversible to PII)");
    else ok("CONTACT_KEY_SALT is set");
  } else {
    note(`STORE_DRIVER=${storeDriver} (data resets on redeploy — set STORE_DRIVER=airtable to persist)`);
  }

  const hasGoogleSa =
    !!env.GOOGLE_SA_JSON ||
    (!!env.GOOGLE_SA_CLIENT_EMAIL && !!env.GOOGLE_SA_PRIVATE_KEY);
  const calDriver = env.CALENDAR_DRIVER ?? "noop";
  if (calDriver === "google") {
    if (!hasGoogleSa && !env.GOOGLE_CALENDAR_TOKEN)
      bad("CALENDAR_DRIVER=google but no service account (GOOGLE_SA_*) or GOOGLE_CALENDAR_TOKEN");
    else ok("Google Calendar credentials present");
  } else {
    note(`CALENDAR_DRIVER=${calDriver} (calendar invites disabled)`);
  }
  const mailerDriver = env.MAILER_DRIVER ?? "noop";
  if (mailerDriver === "gmail") {
    if (!hasGoogleSa && !env.GMAIL_TOKEN)
      bad("MAILER_DRIVER=gmail but no service account (GOOGLE_SA_*) or GMAIL_TOKEN");
    else ok("Gmail credentials present");
  } else {
    note(`MAILER_DRIVER=${mailerDriver} (email sending disabled)`);
  }

  if (env.REQUIRE_SHARED_STATE === "true" && !env.REDIS_URL) {
    bad("REQUIRE_SHARED_STATE=true but REDIS_URL is missing (counters would be per-instance)");
  } else if (env.REQUIRE_SHARED_STATE === "true") {
    ok("REDIS_URL set for shared state");
  }
}

// --- Mode 2: live probe -----------------------------------------------------

async function probe(base) {
  const root = base.replace(/\/$/, "");
  console.log(`\nLive probe (${root})`);

  async function hit(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${root}${path}`, { signal: controller.signal });
      let body = "";
      try {
        body = JSON.stringify(await res.json());
      } catch {
        body = "(non-JSON body)";
      }
      return { status: res.status, body };
    } catch (e) {
      return { status: 0, body: String(e?.message ?? e) };
    } finally {
      clearTimeout(timer);
    }
  }

  const health = await hit("/health");
  if (health.status === 200) ok(`/health 200 ${health.body}`);
  else bad(`/health returned ${health.status} ${health.body}`);

  const ready = await hit("/ready");
  if (ready.status === 200) ok(`/ready 200 ${ready.body}`);
  else if (ready.status === 503)
    bad(`/ready 503 ${ready.body} — store not ready (Airtable PAT/base id/access?)`);
  else bad(`/ready returned ${ready.status} ${ready.body}`);
}

// --- Run --------------------------------------------------------------------

if (!skipConfig) checkConfig();
if (urlArg) await probe(urlArg);

console.log("");
if (failures > 0) {
  console.log(`FAIL — ${failures} problem(s):`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
} else {
  console.log("OK — all checks passed.");
}

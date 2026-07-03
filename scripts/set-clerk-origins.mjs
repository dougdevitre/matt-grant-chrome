#!/usr/bin/env node
// Register the extension's origins on the Clerk instance's `allowed_origins`.
//
// Clerk's Frontend API rejects a Chrome-extension sign-in with
//   "only one of the 'Origin' and 'Authorization' headers should be provided"
// until the extension's `chrome-extension://<id>` origin is allow-listed on the
// instance (see docs/clerk-setup.md). Clerk exposes this only through the
// Backend API, so it used to mean hand-crafting a `curl` with the secret key on
// the command line — error-prone, and a good way to leak the key. This does it
// safely instead: secret from the env, idempotent, and previewable.
//
// Usage:
//   CLERK_SECRET_KEY=sk_live_xxx node scripts/set-clerk-origins.mjs           # add the defaults
//   CLERK_SECRET_KEY=sk_live_xxx node scripts/set-clerk-origins.mjs --list    # show current, no change
//   node scripts/set-clerk-origins.mjs --dry-run                              # preview, no key needed
//   CLERK_SECRET_KEY=sk_live_xxx node scripts/set-clerk-origins.mjs chrome-extension://abc...  # extra origins
//
// The secret key is read from the CLERK_SECRET_KEY env var only — never pass it
// on the command line or commit it. The set is a UNION with whatever is already
// there, so it never clobbers existing origins and re-running is a no-op.

const API_BASE = "https://api.clerk.com/v1";

// The two known extension identities: the side-loaded/downloaded build (from the
// committed manifest `key`) and the Chrome Web Store item. Keep in sync with
// docs/clerk-setup.md and the backend ALLOWED_ORIGIN.
const DEFAULT_ORIGINS = [
  "chrome-extension://abalnefilpmcfbabfaljnophamaegfgj",
  "chrome-extension://ofnchgiipoimjokjbacjhdcbmlnpaphg",
];

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function clerk(path, secret, init = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await res.text();
  let json;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = json?.errors?.[0]?.message || body || res.statusText;
    throw new Error(`Clerk API ${res.status} on ${path}: ${detail}`);
  }
  return json;
}

// A conservative origin check — enough to catch a fat-fingered value before it
// reaches Clerk, without trying to be a full URL validator.
function isPlausibleOrigin(o) {
  return /^chrome-extension:\/\/[a-p]{32}$/.test(o) || /^https?:\/\/[^/\s]+$/.test(o);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const listOnly = args.includes("--list");
  const extra = args.filter((a) => !a.startsWith("--"));

  const bad = extra.filter((o) => !isPlausibleOrigin(o));
  if (bad.length) {
    die(
      `not a valid origin: ${bad.join(", ")}\n` +
        `expected e.g. chrome-extension://<32 chars> or https://host`,
    );
  }

  const targets = [...new Set([...DEFAULT_ORIGINS, ...extra])];

  if (dryRun) {
    console.log("[dry-run] would ensure these origins are allow-listed:");
    for (const o of targets) console.log(`  ${o}`);
    return;
  }

  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret) {
    die("CLERK_SECRET_KEY env var is required (set it; do not commit it)");
  }

  const instance = await clerk("/instance", secret);
  const current = Array.isArray(instance?.allowed_origins)
    ? instance.allowed_origins
    : [];

  if (listOnly) {
    console.log(`current allowed_origins (${current.length}):`);
    for (const o of current) console.log(`  ${o}`);
    return;
  }

  const merged = [...new Set([...current, ...targets])];
  const added = merged.filter((o) => !current.includes(o));

  if (added.length === 0) {
    console.log("no change: all target origins are already allow-listed");
    for (const o of targets) console.log(`  ok ${o}`);
    return;
  }

  await clerk("/instance", secret, {
    method: "PATCH",
    body: JSON.stringify({ allowed_origins: merged }),
  });

  console.log(`added ${added.length} origin(s); allow_origins now has ${merged.length}:`);
  for (const o of merged) {
    console.log(`  ${added.includes(o) ? "+ " : "  "}${o}`);
  }
}

main().catch((e) => die(e.message));

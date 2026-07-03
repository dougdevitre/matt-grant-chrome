#!/usr/bin/env node
// Bulk-assign clerk roles in Clerk from a CSV.
//
// The backend reads each user's role from `publicMetadata.role` on the Clerk
// session token (service/src/lib/identity.ts) and maps it to scopes via
// service/src/rbac.ts. Setting that field for every clerk by hand in the Clerk
// dashboard is slow and error-prone, so this script does it from a CSV.
//
// Usage:
//   CLERK_SECRET_KEY=sk_live_xxx node scripts/set-clerk-roles.mjs clerks.csv
//   CLERK_SECRET_KEY=sk_live_xxx node scripts/set-clerk-roles.mjs clerks.csv --dry-run
//   # a single user without a CSV (e.g. to grant yourself admin):
//   CLERK_SECRET_KEY=sk_live_xxx node scripts/set-clerk-roles.mjs --email you@example.org --role admin
//
// CSV format (header required, case-insensitive): two columns `email,role`.
//   email,role
//   ada@example.org,registration_clerk
//   grace@example.org,admin
//
// The secret key is read from the CLERK_SECRET_KEY env var only — never pass it
// on the command line or commit it. Use --dry-run first to preview the changes.

import { readFileSync } from "node:fs";

const API_BASE = "https://api.clerk.com/v1";

// Must stay in sync with the keys of ROLE_SCOPES in service/src/rbac.ts.
const VALID_ROLES = new Set([
  "registration_clerk",
  "voter_contact_clerk",
  "list_data_clerk",
  "compliance_clerk",
  "events_clerk",
  "social_comms_clerk",
  "team_captain",
  "admin",
  "public",
]);

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

// Minimal CSV parser: two columns, no embedded commas/quotes expected in an
// email or a role slug, so a plain split is correct and keeps this dependency-free.
function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) die("CSV is empty");

  const header = lines[0].split(",").map((c) => c.trim().toLowerCase());
  const emailIdx = header.indexOf("email");
  const roleIdx = header.indexOf("role");
  if (emailIdx === -1 || roleIdx === -1) {
    die('CSV must have a header row with "email" and "role" columns');
  }

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim());
    const email = cols[emailIdx];
    const role = cols[roleIdx];
    if (!email || !role) {
      die(`row ${i + 1}: missing email or role ("${lines[i]}")`);
    }
    rows.push({ email, role, line: i + 1 });
  }
  return rows;
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

async function findUserByEmail(email, secret) {
  // Clerk's user list supports filtering by exact email address.
  const users = await clerk(
    `/users?email_address=${encodeURIComponent(email)}&limit=2`,
    secret,
  );
  if (!Array.isArray(users) || users.length === 0) return null;
  if (users.length > 1) {
    throw new Error(`more than one Clerk user matches ${email}`);
  }
  return users[0];
}

async function setRole(userId, role, secret) {
  await clerk(`/users/${userId}/metadata`, secret, {
    method: "PATCH",
    body: JSON.stringify({ public_metadata: { role } }),
  });
}

// Pull `--flag value` out of the args (returns the value or undefined).
function flag(args, name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const email = flag(args, "--email");
  const role = flag(args, "--role");
  // Anything positional that isn't a flag value is the CSV path.
  const flagValues = new Set([email, role].filter(Boolean));
  const csvPath = args.find(
    (a) => !a.startsWith("--") && !flagValues.has(a),
  );

  if ((email && !role) || (role && !email)) {
    die("--email and --role must be given together");
  }
  if (!email && !csvPath) {
    die(
      "usage: node scripts/set-clerk-roles.mjs <clerks.csv> [--dry-run]\n" +
        "   or: node scripts/set-clerk-roles.mjs --email you@example.org --role admin",
    );
  }
  const secret = process.env.CLERK_SECRET_KEY;
  if (!dryRun && !secret) {
    die("CLERK_SECRET_KEY env var is required (set it; do not commit it)");
  }

  // Inline single-user path skips the CSV entirely.
  let rows;
  if (email) {
    rows = [{ email, role, line: 1 }];
  } else {
    let text;
    try {
      text = readFileSync(csvPath, "utf8");
    } catch (e) {
      die(`cannot read CSV ${csvPath}: ${e.message}`);
    }
    rows = parseCsv(text);
  }

  // Validate every role up front so a typo never half-applies the batch.
  const bad = rows.filter((r) => !VALID_ROLES.has(r.role));
  if (bad.length) {
    const list = bad.map((r) => `  line ${r.line}: "${r.role}"`).join("\n");
    die(
      `invalid role(s):\n${list}\nvalid roles: ${[...VALID_ROLES].join(", ")}`,
    );
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}${rows.length} clerk role assignment(s)`,
  );

  let ok = 0;
  let failed = 0;
  for (const { email, role } of rows) {
    if (dryRun) {
      console.log(`  would set ${email} -> ${role}`);
      ok++;
      continue;
    }
    try {
      const user = await findUserByEmail(email, secret);
      if (!user) {
        console.error(`  SKIP ${email}: no Clerk user (have they signed in?)`);
        failed++;
        continue;
      }
      await setRole(user.id, role, secret);
      console.log(`  set ${email} -> ${role}`);
      ok++;
    } catch (e) {
      console.error(`  FAIL ${email}: ${e.message}`);
      failed++;
    }
  }

  console.log(`done: ${ok} applied, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => die(e.message));

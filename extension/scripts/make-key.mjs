#!/usr/bin/env node
// Pin the extension's identity so every "Load unpacked" install shares ONE id.
//
// Chrome derives an unpacked extension's id from the install path unless the
// manifest carries a `key` (the base64 SPKI DER of an RSA public key). With a
// committed `key`, all installs get the SAME id, which we can allow-list in
// Clerk and set as the backend's ALLOWED_ORIGIN once, for everyone.
//
// This script is idempotent: if manifest.json already has a `key`, it just
// recomputes and prints the id (so CI / re-runs never churn the committed key).
// On first run it generates an RSA keypair, writes the public `key` into the
// manifest, and saves the PRIVATE key to a gitignored file (kept out of the
// repo — needed only if you later sign a .crx / Web Store upload to reuse this
// same id). Run: `node extension/scripts/make-key.mjs`.

import { generateKeyPairSync, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = resolve(HERE, "../public/manifest.json");
const KEY_DIR = resolve(HERE, "../.keys");
const PRIV_PATH = resolve(KEY_DIR, "extension-private-key.pem");

// Chrome's app id: first 32 hex chars of SHA-256(pubkey DER), each nibble
// mapped 0-f -> a-p ("mpdecimal").
function extensionId(derBase64) {
  const der = Buffer.from(derBase64, "base64");
  const hash = createHash("sha256").update(der).digest("hex").slice(0, 32);
  let id = "";
  for (const ch of hash) id += String.fromCharCode(97 + parseInt(ch, 16));
  return id;
}

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));

let keyB64 = manifest.key;
if (keyB64) {
  console.log("manifest already has a key — reusing it (no regeneration)");
} else {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  // SPKI DER is exactly what Chrome expects for manifest `key`.
  keyB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  // Insert `key` as the first field for readability.
  const rebuilt = { manifest_version: manifest.manifest_version, key: keyB64 };
  for (const [k, v] of Object.entries(manifest)) {
    if (k !== "manifest_version") rebuilt[k] = v;
  }
  writeFileSync(MANIFEST, JSON.stringify(rebuilt, null, 2) + "\n");

  mkdirSync(KEY_DIR, { recursive: true });
  writeFileSync(
    PRIV_PATH,
    privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  console.log(`generated keypair; wrote public key into ${MANIFEST}`);
  console.log(`private key saved to ${PRIV_PATH} (gitignored — keep it safe)`);
}

const id = extensionId(keyB64);
console.log(`\nextension id: ${id}`);
console.log(`origin:       chrome-extension://${id}`);
if (existsSync(PRIV_PATH)) {
  console.log(
    "\nNOTE: the private key is only needed to reuse this id on the Chrome Web Store.",
  );
}

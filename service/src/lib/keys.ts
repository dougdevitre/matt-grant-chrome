// Shared, non-reversible key for a recipient so opt-out and outbox never store
// raw PII. Used by both the comms pipeline and the contacts layer so an opt-out
// recorded against an email matches a contact imported with that same email.

import { createHash, createHmac } from "node:crypto";

// A bare hash of a phone/email is offline-reversible (small keyspace). Set
// CONTACT_KEY_SALT to derive keys with a keyed HMAC instead, so leaked keys
// can't be brute-forced back to PII without the server-held salt. Unset keeps
// the plain-hash behavior (back-compat); the value must stay constant once set.
export function contactKeyFor(identifier: string): string {
  const norm = identifier.trim().toLowerCase();
  const salt = process.env.CONTACT_KEY_SALT;
  const digest = salt
    ? createHmac("sha256", salt).update(norm)
    : createHash("sha256").update(norm);
  return digest.digest("hex").slice(0, 24);
}

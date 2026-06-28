// Shared, non-reversible key for a recipient so opt-out and outbox never store
// raw PII. Used by both the comms pipeline and the contacts layer so an opt-out
// recorded against an email matches a contact imported with that same email.

import { createHash } from "node:crypto";

export function contactKeyFor(identifier: string): string {
  return createHash("sha256")
    .update(identifier.trim().toLowerCase())
    .digest("hex")
    .slice(0, 24);
}

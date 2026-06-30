// Shared audit hash-chain logic, used by every store adapter so the chain is
// built identically regardless of backend, and by the /audit/verify route so the
// chain is actually verified in production (not just in tests).
//
// Each entry's hash covers the previous hash + its own content (including seq),
// so any later edit, deletion, or reorder breaks the chain on verification.

import { createHash } from "node:crypto";
import type { AuditEvent } from "./types.js";

export function computeAuditHash(prevHash: string | null, evt: AuditEvent): string {
  const material =
    `${prevHash ?? ""}|${evt.seq ?? ""}|${evt.id}|${evt.ts}|${evt.clerkId}` +
    `|${evt.action}|${evt.entity}|${evt.entityId}`;
  return createHash("sha256").update(material).digest("hex");
}

/** Recompute the chain over events (in seq order) and report the first break. */
export function verifyAuditChain(events: AuditEvent[]): { ok: boolean; brokeAt: number } {
  let prev: string | null = null;
  for (let i = 0; i < events.length; i++) {
    if (events[i].hash !== computeAuditHash(prev, events[i])) {
      return { ok: false, brokeAt: i };
    }
    prev = events[i].hash ?? null;
  }
  return { ok: true, brokeAt: -1 };
}
